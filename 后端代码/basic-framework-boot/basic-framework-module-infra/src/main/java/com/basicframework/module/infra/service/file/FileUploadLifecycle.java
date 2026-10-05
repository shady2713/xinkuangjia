package com.basicframework.module.infra.service.file;

import com.basicframework.module.infra.dal.dataobject.file.FileDO;
import com.basicframework.module.infra.dal.dataobject.file.FileUploadDO;
import com.basicframework.module.infra.dal.mysql.file.FileMapper;
import com.basicframework.module.infra.dal.mysql.file.FileUploadMapper;
import com.basicframework.module.infra.framework.file.config.FileUploadProperties;
import com.basicframework.module.infra.framework.file.core.utils.FilePathUtils;
import com.basicframework.module.infra.framework.file.core.utils.FileTypeUtils;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.*;

/**
 * 将上传预约先行提交，并以同一行锁协调完成和补偿，防止未知提交结果导致误删。
 *
 * <p>对象写入不参与数据库原子事务。预约和终态记录提供故障后的重试依据；
 * 外层业务回滚不回滚已提交文件，调用方应在业务替换成功后按文件管理契约删除旧文件。</p>
 *
 * @author shady2713
 */
@Service
@Slf4j
public class FileUploadLifecycle {

    /** 上传会话状态：已预占配额，等待内容落库。 */
    private static final String STATUS_PENDING = "PENDING";

    /** 上传会话状态：内容已落库。 */
    private static final String STATUS_COMPLETE = "COMPLETE";

    /** 上传会话状态：已取消，等待清理暂存内容。 */
    private static final String STATUS_CANCELLED = "CANCELLED";

    /** 配额预占成功的返回行数。 */
    private static final int QUOTA_CONSUMED = 1;

    @Resource
    private FileUploadMapper uploads;
    @Resource
    private FileMapper files;
    @Resource
    private FileStorageService storage;
    @Resource
    private FileUploadProperties limits;

    /**
     * 在任何对象写入或签发上传 URL 之前持久化预约及日预算。
     * @param owner 服务端解析的身份域和用户编号
     * @param path 不复用的最终对象键
     * @param name 已规范化的文件名
     * @param size 文件精确大小，字节
     * @param direct 是否需要浏览器直传暂存路径
     * @return 已提交预约；大小、预算或数据库失败时不允许写对象
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW, rollbackFor = Exception.class)
    public FileUploadDO reserve(String owner, String path, String name, long size, boolean direct) {
        if (size < 1 || size > limits.getMaxBytes()) {
            throw exception(FILE_SIZE_EXCEEDED);
        }
        if (!FilePathUtils.isFileNameValid(name) || !FilePathUtils.isObjectPathValid(path)) {
            throw exception(FILE_PATH_INVALID);
        }
        uploads.initializeQuota(owner);
        if (uploads.consumeQuota(owner, size, limits.getDailyBytes(), limits.getDailyRequests()) != QUOTA_CONSUMED) {
            throw exception(FILE_UPLOAD_QUOTA_EXCEEDED);
        }
        FileUploadDO upload = new FileUploadDO();
        upload.setOwnerKey(owner);
        upload.setName(name);
        upload.setPath(path);
        upload.setSize(size);
        upload.setStatus(STATUS_PENDING);
        if (direct) {
            upload.setStagingPath("upload-staging/" + UUID.randomUUID().toString().replace("-", ""));
        }
        uploads.insert(upload);
        uploads.initializeExpiry(upload.getId());
        return upload;
    }

    /**
     * 验证实际字节后写入最终对象，并原子提交元数据与完成状态。
     * @param path 本身份持有的预约路径
     * @param owner 服务端解析的当前身份
     * @param serverContent 后端上传内容；直传完成传 null，由服务端有界读取暂存对象
     * @return 已登记文件；同一预约重试返回原记录，已删除或过期预约拒绝复用
     * @throws Exception 存储或数据库失败；持久化预约保留给重试与清理，调用方不得立即删除对象
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW, rollbackFor = Exception.class)
    public FileDO complete(String path, String owner, byte[] serverContent) throws Exception {
        FileUploadDO upload = uploads.lockByPath(path);
        if (upload == null || !owner.equals(upload.getOwnerKey())) {
            throw exception(FILE_UPLOAD_INVALID);
        }
        if (STATUS_COMPLETE.equals(upload.getStatus())) {
            FileDO file = files.selectById(upload.getFileId());
            if (file == null) {
                throw exception(FILE_UPLOAD_INVALID);
            }
            return file;
        }
        if (!STATUS_PENDING.equals(upload.getStatus()) || uploads.countExpired(upload.getId()) != 0) {
            throw exception(FILE_UPLOAD_INVALID);
        }
        byte[] content = serverContent;
        if (upload.getStagingPath() != null) {
            if (serverContent != null) {
                throw exception(FILE_UPLOAD_INVALID);
            }
            content = storage.getContent(upload.getStagingPath(), Math.toIntExact(upload.getSize()));
        }
        if (content == null || content.length != upload.getSize() || content.length > limits.getMaxBytes()) {
            throw exception(FILE_SIZE_EXCEEDED);
        }
        if (!FileTypeUtils.isAllowedUploadType(content, upload.getName())) {
            throw exception(FILE_TYPE_NOT_ALLOWED);
        }
        String type = FileTypeUtils.getMineType(content, upload.getName());
        if (!FilePathUtils.isMimeTypeValid(type)) {
            throw exception(FILE_METADATA_INVALID);
        }
        // 直传 URL 只能覆盖暂存键。最终对象只接收本次已经验证的字节，消除验证后被覆盖的窗口。
        String url = storage.upload(content, path, type);
        if (!FilePathUtils.isFileUrlValid(url)) {
            throw exception(FILE_METADATA_INVALID);
        }
        FileDO file = new FileDO();
        file.setName(upload.getName());
        file.setPath(path);
        file.setUrl(url);
        file.setSize((long) content.length);
        file.setType(type);
        files.insert(file);
        uploads.complete(upload.getId(), file.getId());
        return file;
    }

    /**
     * 在预约行锁内清理到期对象；完成记录始终保留最终对象，取消记录定期重试迟到写入。
     * @param id 有界扫描得到的预约编号
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW, rollbackFor = Exception.class)
    public void reconcile(Long id) {
        FileUploadDO upload = uploads.lockById(id);
        if (upload == null || uploads.countCleanupDue(id) == 0) {
            return;
        }
        if (STATUS_PENDING.equals(upload.getStatus())) {
            if (uploads.countExpired(id) == 0) {
                return;
            }
            uploads.cancel(id);
            upload.setStatus(STATUS_CANCELLED);
        }
        try {
            if (STATUS_CANCELLED.equals(upload.getStatus())) {
                storage.delete(upload.getPath());
            }
            if (upload.getStagingPath() != null) {
                storage.delete(upload.getStagingPath());
            }
            uploads.scheduleNextCleanup(id);
        } catch (Exception failure) {
            // 先提交取消状态；失败保留重试时间，避免故障对象被重新登记或阻塞整个扫描队列。
            uploads.scheduleRetry(id);
            log.warn("文件补偿暂未完成，预约编号={}，失败类型={}", id, failure.getClass().getSimpleName());
        }
    }
}
