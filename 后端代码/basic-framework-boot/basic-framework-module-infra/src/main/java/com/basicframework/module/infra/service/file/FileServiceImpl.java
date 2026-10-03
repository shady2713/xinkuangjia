package com.basicframework.module.infra.service.file;

import cn.hutool.core.date.LocalDateTimeUtil;
import cn.hutool.core.io.FileUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.crypto.digest.DigestUtil;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import org.springframework.web.context.request.RequestContextHolder;
import com.basicframework.module.infra.controller.admin.file.vo.file.FileCreateReqVO;
import com.basicframework.module.infra.controller.admin.file.vo.file.FilePageReqVO;
import com.basicframework.module.infra.controller.admin.file.vo.file.FilePresignedUrlRespVO;
import com.basicframework.module.infra.dal.dataobject.file.FileDO;
import com.basicframework.module.infra.dal.mysql.file.FileMapper;
import com.basicframework.module.infra.enums.ErrorCodeConstants;
import com.basicframework.module.infra.framework.file.config.FileUploadProperties;
import com.basicframework.module.infra.framework.file.core.utils.FilePathUtils;
import com.basicframework.module.infra.framework.file.core.utils.FileTypeUtils;
import com.google.common.annotations.VisibleForTesting;
import jakarta.annotation.Resource;
import lombok.SneakyThrows;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;
import java.util.Map;

import static cn.hutool.core.date.DatePattern.PURE_DATE_PATTERN;
import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;

/**
 * 文件 Service 实现类
 *
 * <p>统一处理对象路径、上传类型、稳定访问 URL 与文件元数据写入。</p>
 *
 * @author 李杰
 */
@Service
public class FileServiceImpl implements FileService {

    /**
     * 上传文件的前缀，是否包含日期（yyyyMMdd）。
     *
     * 目的：按照日期分目录，便于后续定位和归档。
     */
    private static final boolean PATH_PREFIX_DATE_ENABLE = true;
    /** 统一对象存储服务。 */
    @Resource
    private FileStorageService fileStorageService;

    /** 上传预约、事务提交和故障补偿。 */
    @Resource
    private FileUploadLifecycle uploadLifecycle;

    /** 内部文件 API 也在内容识别之前遵守统一大小上限。 */
    @Resource
    private FileUploadProperties uploadLimits;

    /** 文件元数据 Mapper。 */
    @Resource
    private FileMapper fileMapper;

    /**
     * 分页查询文件元数据。
     *
     * @param pageReqVO 分页查询条件
     * @return 文件分页结果
     */
    @Override
    public PageResult<FileDO> getFilePage(FilePageReqVO pageReqVO) {
        return fileMapper.selectPage(pageReqVO);
    }

    /**
     * 校验文件内容和类型后上传对象，并登记元数据。
     *
     * @param content 文件内容
     * @param name 原始文件名；为空时按内容摘要生成
     * @param directory 业务目录；为空时只使用日期目录
     * @param type 调用方声明的 MIME；为空时自动探测
     * @return 文件长期访问地址
     */
    @Override
    @SneakyThrows
    public String createFile(byte[] content, String name, String directory, String type) {
        // 先拦截空内容，避免后续 MIME 识别、摘要计算和长度访问时出现空指针。
        if (content == null || content.length == 0) {
            throw exception(ErrorCodeConstants.FILE_IS_EMPTY);
        }
        if (content.length > uploadLimits.getMaxBytes()) {
            throw exception(ErrorCodeConstants.FILE_SIZE_EXCEEDED);
        }
        // 浏览器可能上送本地完整路径，只保留最后一级名称，避免调用方改变业务目录。
        name = FilePathUtils.normalizeFileName(name);
        // 先探测真实 MIME，后续既要用于补齐后缀，也要用于类型白名单校验。
        String detectedType = FileTypeUtils.getMineType(content, name);
        // 调用方未显式传入类型时，回退为探测结果。
        if (StrUtil.isEmpty(type)) {
            type = detectedType;
        }
        // 未传入文件名时，使用内容摘要生成稳定名称。
        if (StrUtil.isEmpty(name)) {
            name = DigestUtil.sha256Hex(content);
        }
        if (StrUtil.isEmpty(FileUtil.extName(name))) {
            // 文件名缺少后缀时，优先根据探测结果补齐，避免白名单校验误判。
            String extension = FileTypeUtils.getExtension(StrUtil.emptyToDefault(detectedType, type));
            if (StrUtil.isNotEmpty(extension)) {
                name = name + extension;
            }
        }
        if (!FilePathUtils.isFileNameValid(name)) {
            throw exception(ErrorCodeConstants.FILE_PATH_INVALID);
        }
        // 只有后缀和探测类型都在允许范围内时才允许上传，防止伪装可执行文件。
        if (!FileTypeUtils.isAllowedUploadType(content, name)) {
            throw exception(ErrorCodeConstants.FILE_TYPE_NOT_ALLOWED);
        }
        // 重新结合最终文件名计算 MIME，确保上传到存储客户端的类型与文件名一致。
        type = FileTypeUtils.getMineType(content, name);
        if (!FilePathUtils.isMimeTypeValid(type)) {
            throw exception(ErrorCodeConstants.FILE_METADATA_INVALID);
        }

        // 生成唯一上传路径，避免不同目录/同名文件互相覆盖。
        String path = generateUploadPath(name, directory);
        String owner = currentOwner(false);
        uploadLifecycle.reserve(owner, path, name, content.length, false);
        return uploadLifecycle.complete(path, owner, content).getUrl();
    }

    /**
     * 生成唯一对象路径。
     *
     * <p>目录与文件名会再次校验，确保模块内部调用也不能绕过 Controller 参数约束。</p>
     *
     * @param name 文件名
     * @param directory 可选业务目录
     * @return 带日期和随机标识的对象路径；同名并发上传不复用对象键
     */
    @VisibleForTesting
    String generateUploadPath(String name, String directory) {
        name = FilePathUtils.normalizeFileName(name);
        if (!FilePathUtils.isFileNameValid(name) || !FilePathUtils.isDirectoryValid(directory)
                || "upload-staging".equals(directory)
                || (directory != null && directory.startsWith("upload-staging/"))) {
            throw exception(ErrorCodeConstants.FILE_PATH_INVALID);
        }
        // 日期仅用于归档；唯一性由独立随机标识保证，不依赖实例时钟或请求间隔。
        String prefix = null;
        if (PATH_PREFIX_DATE_ENABLE) {
            prefix = LocalDateTimeUtil.format(LocalDateTimeUtil.now(), PURE_DATE_PATTERN);
        }
        String suffix = UUID.randomUUID().toString().replace("-", "");
        String ext = FileUtil.extName(name);
        if (StrUtil.isNotEmpty(ext)) {
            name = FileUtil.mainName(name) + StrUtil.C_UNDERLINE + suffix + StrUtil.DOT + ext;
        } else {
            name = name + StrUtil.C_UNDERLINE + suffix;
        }
        // 再拼接日期前缀，按天分目录。
        if (StrUtil.isNotEmpty(prefix)) {
            name = prefix + StrUtil.SLASH + name;
        }
        // 最后拼接业务目录，保持调用方传入的目录层级。
        if (StrUtil.isNotEmpty(directory)) {
            name = directory + StrUtil.SLASH + name;
        }
        if (!FilePathUtils.isObjectPathValid(name)) {
            throw exception(ErrorCodeConstants.FILE_PATH_INVALID);
        }
        return name;
    }

    /**
     * 生成前端直传所需的上传地址和稳定访问地址。
     *
     * @param name 文件名
     * @param directory 可选业务目录
     * @param size 文件精确字节数，用于签名及预约预算
     * @return 预签名上传信息
     */
    @Override
    @SneakyThrows
    public FilePresignedUrlRespVO presignPutUrl(String name, String directory, long size) {
        name = FilePathUtils.normalizeFileName(name);
        String path = generateUploadPath(name, directory);
        var upload = uploadLifecycle.reserve(currentOwner(true), path, name, size, true);
        FilePresignedUrlRespVO response = new FilePresignedUrlRespVO();
        response.setPath(path);
        response.setUploadUrl(fileStorageService.presignPutUrl(upload.getStagingPath(), size));
        response.setUrl(fileStorageService.presignGetUrl(path, null));
        response.setHeaders(Map.of("Content-Type", "application/octet-stream", "Content-Disposition", "attachment"));
        return response;
    }

    /**
     * 生成对象读取地址。
     *
     * @param url 对象路径或完整访问地址
     * @param expirationSeconds 私有存储有效期，单位秒；公开存储时忽略
     * @return 文件读取地址
     */
    @Override
    public String presignGetUrl(String url, Integer expirationSeconds) {
        return fileStorageService.presignGetUrl(url, expirationSeconds);
    }

    /**
     * 完成本身份的上传预约；原名称、大小和类型以预约及实际对象内容为准。
     * @param createReqVO 客户端持有的预约路径，其他兼容字段不作为真实性依据
     * @return 文件编号；同一预约重复完成返回原编号
     */
    @Override
    @SneakyThrows
    public Long createFile(FileCreateReqVO createReqVO) {
        if (!FilePathUtils.isObjectPathValid(createReqVO.getPath())) {
            throw exception(ErrorCodeConstants.FILE_PATH_INVALID);
        }
        return uploadLifecycle.complete(createReqVO.getPath(), currentOwner(true), null).getId();
    }

    /**
     * 从可信登录上下文取得预约身份，不接受请求参数指定所有者。
     * @param requireUser 直传预约及完成必须有登录用户；内部文件 API 可使用独立系统预算
     * @return 带身份域的所有者键
     */
    private String currentOwner(boolean requireUser) {
        var user = SecurityFrameworkUtils.getLoginUser();
        if (user != null && user.getId() != null && user.getUserType() != null) {
            return user.getUserType() + ":" + user.getId();
        }
        if (requireUser || RequestContextHolder.getRequestAttributes() != null) {
            throw exception(ErrorCodeConstants.FILE_UPLOAD_INVALID);
        }
        return "internal:system";
    }

    /**
     * 查询并校验文件存在。
     *
     * @param id 文件记录编号
     * @return 文件元数据
     */
    @Override
    public FileDO getFile(Long id) {
        return validateFileExists(id);
    }

    /**
     * 先删除对象存储内容，再删除文件元数据。
     *
     * @param id 文件记录编号
     * @throws Exception 对象存储删除失败时抛出，数据库记录会保留以便重试
     */
    @Override
    public void deleteFile(Long id) throws Exception {
        // 先校验记录存在，避免存储删除和数据库删除状态不一致。
        FileDO file = validateFileExists(id);

        // 先删存储中的文件，再删数据库记录，避免外部资源残留。
        fileStorageService.delete(file.getPath());

        fileMapper.deleteById(id);
    }

    /**
     * 批量删除对象存储内容和文件元数据。
     *
     * @param ids 文件记录编号列表
     * @throws Exception 任一存储或元数据删除失败时停止，已完成项保留删除结果，其他项可重试
     */
    @Override
    @SneakyThrows
    public void deleteFileList(List<Long> ids) {
        // 逐项完成存储和元数据删除，后续失败不留下已删除对象的旧元数据。
        List<FileDO> files = fileMapper.selectByIds(ids);
        for (FileDO file : files) {
            fileStorageService.delete(file.getPath());
            fileMapper.deleteById(file.getId());
        }
    }

    /**
     * 查询文件元数据，不存在时抛出稳定业务异常。
     *
     * @param id 文件记录编号
     * @return 文件元数据
     */
    private FileDO validateFileExists(Long id) {
        FileDO fileDO = fileMapper.selectById(id);
        if (fileDO == null) {
            throw exception(ErrorCodeConstants.FILE_NOT_EXISTS);
        }
        return fileDO;
    }

    /**
     * 从对象存储读取文件内容。
     *
     * @param path 对象路径
     * @return 文件字节内容
     * @throws Exception 对象存储读取失败时抛出
     */
    @Override
    public byte[] getFileContent(String path) throws Exception {
        // 暂存对象尚未完成内容验证，不得通过应用同源下载入口重新以 inline 类型输出。
        if (!FilePathUtils.isObjectPathValid(path) || path.startsWith("upload-staging/")) {
            return null;
        }
        return fileStorageService.getContent(path);
    }

}
