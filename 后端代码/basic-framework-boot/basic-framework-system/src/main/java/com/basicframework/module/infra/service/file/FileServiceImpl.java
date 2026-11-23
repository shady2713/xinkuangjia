package com.basicframework.module.infra.service.file;

import cn.hutool.core.date.LocalDateTimeUtil;
import cn.hutool.core.io.FileUtil;
import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.crypto.digest.DigestUtil;
import com.basicframework.framework.common.biz.system.permission.PermissionCommonApi;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.basicframework.module.infra.controller.admin.file.vo.file.FileCreateReqVO;
import com.basicframework.module.infra.controller.admin.file.vo.file.FilePageReqVO;
import com.basicframework.module.infra.controller.admin.file.vo.file.FilePresignedUrlRespVO;
import com.basicframework.module.infra.dal.dataobject.file.FileDO;
import com.basicframework.module.infra.dal.mysql.file.FileMapper;
import com.basicframework.module.infra.enums.ErrorCodeConstants;
import com.basicframework.module.infra.framework.file.core.client.FileContentStream;
import com.basicframework.module.infra.framework.file.core.client.FileObjectStat;
import com.basicframework.module.infra.framework.file.core.utils.FilePathUtils;
import com.basicframework.module.infra.framework.file.core.utils.FileTypeUtils;
import com.google.common.annotations.VisibleForTesting;
import jakarta.annotation.Resource;
import lombok.SneakyThrows;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;

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

    /** 本地文件系统常见的单个文件名 UTF-8 字节上限。 */
    private static final int MAX_OBJECT_NAME_BYTES = 255;
    /** 预签名直传凭证有效期，与 S3 预签名上传有效期一致。 */
    private static final Duration PRESIGN_TICKET_TTL = Duration.ofMinutes(15);
    /** 无 Redis 环境下的本地预签名凭证缓存上限。 */
    private static final int MAX_LOCAL_PRESIGN_TICKETS = 10_000;
    /** Redis 预签名一次性凭证键前缀。 */
    private static final String PRESIGN_TICKET_KEY_PREFIX = "infra:file:presign:ticket:";

    /** 统一对象存储服务。 */
    @Resource
    private FileStorageService fileStorageService;

    /** 文件元数据 Mapper。 */
    @Resource
    private FileMapper fileMapper;

    /** Redis 模板（未配置 Redis 时按单机有界内存凭证表降级）。 */
    @Autowired(required = false)
    private StringRedisTemplate stringRedisTemplate;

    /** 权限校验公共 API，用于私有附件统一对象级授权（上传人本人或具备 {@code infra:file:query} 权限）。 */
    @Autowired(required = false)
    private PermissionCommonApi permissionCommonApi;

    /** 无 Redis 时的有界本地一次性直传凭证表，键为对象路径。 */
    private final ConcurrentHashMap<String, PresignTicket> localPresignTickets = new ConcurrentHashMap<>();

    /**
     * 预签名直传一次性凭证载荷。
     *
     * @param userId         申请人编号（未登录或无上下文时为 {@code null}）
     * @param contentType    预签名绑定的预期 MIME 类型
     * @param expireAtMillis 本地缓存过期时间戳（毫秒）
     */
    private record PresignTicket(Long userId, String contentType, long expireAtMillis) {

        /**
         * 判断当前凭证是否已过期。
         *
         * @param nowMillis 当前毫秒时间戳
         * @return 过期返回 true
         */
        boolean isExpired(long nowMillis) {
            return nowMillis >= expireAtMillis;
        }
    }

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
        String uploadedUrl = fileStorageService.upload(content, path, type);
        boolean privateObject = isPrivateObject(path);
        // 私有附件不向数据库持久化带临时签名的短期地址，须通过 /infra/file/private/* 按需授权获取。
        String persistedUrl = privateObject ? "" : uploadedUrl;
        if (!privateObject && !FilePathUtils.isFileUrlValid(persistedUrl)) {
            // 对象已经上传但元数据无法入库时立即补偿删除，避免留下无法管理的孤立对象。
            var metadataException = exception(ErrorCodeConstants.FILE_METADATA_INVALID);
            deleteUnregisteredObject(path, metadataException);
            throw metadataException;
        }

        // 上传成功后持久化文件元数据，便于后续查询、预签名和删除。
        FileDO file = new FileDO();
        file.setName(name);
        file.setPath(path);
        file.setUrl(persistedUrl);
        file.setType(type);
        file.setSize((long) content.length);
        try {
            fileMapper.insert(file);
        } catch (RuntimeException ex) {
            // 元数据写入失败时补偿删除本次以独立键写入的对象，避免留下孤立对象。
            deleteUnregisteredObject(path, ex);
            throw ex;
        }
        return persistedUrl;
    }

    /**
     * 生成唯一对象路径。
     *
     * <p>目录与文件名会再次校验，确保模块内部调用也不能绕过 Controller 参数约束。</p>
     *
     * @param name 文件名
     * @param directory 可选业务目录
     * @return 保留扩展名、带日期和独立对象标识的对象路径
     */
    @VisibleForTesting
    String generateUploadPath(String name, String directory) {
        name = FilePathUtils.normalizeFileName(name);
        if (!FilePathUtils.isFileNameValid(name) || !FilePathUtils.isDirectoryValid(directory)) {
            throw exception(ErrorCodeConstants.FILE_PATH_INVALID);
        }
        String dateDirectory = LocalDateTimeUtil.format(LocalDateTimeUtil.now(), PURE_DATE_PATTERN) + StrUtil.SLASH;
        String prefix = StrUtil.isEmpty(directory) ? dateDirectory : directory + StrUtil.SLASH + dateDirectory;
        String extension = FileUtil.extName(name);
        String suffix = StrUtil.UNDERLINE + IdUtil.fastSimpleUUID()
                + (StrUtil.isEmpty(extension) ? "" : StrUtil.DOT + extension);
        int characterBudget = FilePathUtils.MAX_OBJECT_PATH_LENGTH - prefix.length() - suffix.length();
        int byteBudget = MAX_OBJECT_NAME_BYTES - suffix.getBytes(StandardCharsets.UTF_8).length;
        if (characterBudget < 0 || byteBudget < 0) {
            throw exception(ErrorCodeConstants.FILE_PATH_INVALID);
        }

        // 仅缩短新对象键中的主文件名，展示名称和历史对象键均由原有元数据提供。
        String path = prefix + trimObjectName(FileUtil.mainName(name), characterBudget, byteBudget) + suffix;
        if (!FilePathUtils.isObjectPathValid(path)) {
            throw exception(ErrorCodeConstants.FILE_PATH_INVALID);
        }
        return path;
    }

    /**
     * 截取同时适合存储文件名和数据库路径的 UTF-8 前缀，避免切断多字节字符。
     *
     * @param name 主文件名
     * @param characterBudget 剩余路径字符数
     * @param byteBudget 剩余文件名 UTF-8 字节数
     * @return 完整字符组成的主文件名前缀
     */
    private static String trimObjectName(String name, int characterBudget, int byteBudget) {
        int end = Math.min(name.length(), characterBudget);
        if (end > 0 && end < name.length() && Character.isHighSurrogate(name.charAt(end - 1))) {
            end--;
        }
        CharBuffer characters = CharBuffer.wrap(name, 0, end);
        StandardCharsets.UTF_8.newEncoder().encode(characters, ByteBuffer.allocate(byteBudget), true);
        return name.substring(0, characters.position());
    }

    /**
     * 生成前端直传所需的上传地址和稳定访问地址。
     *
     * @param name 文件名
     * @param directory 可选业务目录
     * @return 预签名上传信息
     */
    @Override
    @SneakyThrows
    public FilePresignedUrlRespVO presignPutUrl(String name, String directory) {
        String normalizedName = FilePathUtils.normalizeFileName(name);
        if (!FilePathUtils.isFileNameValid(normalizedName)) {
            throw exception(ErrorCodeConstants.FILE_PATH_INVALID);
        }
        // 预签名直传前置校验扩展名白名单，阻止向对象存储申请 .html/.svg 等可执行后缀的直传签名。
        if (!FileTypeUtils.isAllowedUploadFileName(normalizedName)) {
            throw exception(ErrorCodeConstants.FILE_TYPE_NOT_ALLOWED);
        }
        String path = generateUploadPath(normalizedName, directory);

        // 同时返回上传地址和公开访问地址；私有对象不预签发未上传对象的限时 GET 链接，避免前端误将短期签名落库。
        String expectedContentType = FileTypeUtils.getMineType(normalizedName);
        String uploadUrl = fileStorageService.presignPutUrl(path, expectedContentType);
        String visitUrl = isPrivateObject(path) ? "" : fileStorageService.presignGetUrl(path, null);
        issuePresignTicket(path, expectedContentType);
        FilePresignedUrlRespVO response = new FilePresignedUrlRespVO();
        response.setPath(path);
        response.setUploadUrl(uploadUrl);
        response.setUrl(visitUrl);
        response.setContentType(expectedContentType);
        return response;
    }

    /**
     * 生成对象读取地址。
     *
     * @param url 对象路径或完整访问地址
     * @param expirationSeconds 私有存储有效期，单位秒（受 60~3600 秒约束）；公开存储时忽略
     * @return 文件读取地址
     */
    @Override
    public String presignGetUrl(String url, Integer expirationSeconds) {
        if (expirationSeconds != null) {
            resolveContractExpirationSeconds(expirationSeconds);
        }
        return fileStorageService.presignGetUrl(url, expirationSeconds);
    }

    /**
     * 登记已经通过预签名地址上传的文件。
     *
     * <p>校验一次性预签名凭证、对象存储真实元信息及大小上限后才写入数据库；
     * 访问 URL 与实际文件大小均以服务端查询结果为准，不采信客户端提交值。</p>
     *
     * @param createReqVO 文件登记请求
     * @return 文件记录编号
     */
    @Override
    public Long createFile(FileCreateReqVO createReqVO) {
        if (!FilePathUtils.isObjectPathValid(createReqVO.getPath())
                || !FilePathUtils.isFileNameValid(createReqVO.getName())) {
            throw exception(ErrorCodeConstants.FILE_PATH_INVALID);
        }
        String pathExt = FileTypeUtils.getFileExtension(createReqVO.getPath());
        String nameExt = FileTypeUtils.getFileExtension(createReqVO.getName());
        // 校验对象路径后缀与原始文件名后缀一致且符合上传类型白名单，防止预签名阶段与登记阶段掉包路径后缀。
        if (!StrUtil.equals(pathExt, nameExt)
                || !FileTypeUtils.isAllowedUploadMetadata(createReqVO.getName(), createReqVO.getType())) {
            throw exception(ErrorCodeConstants.FILE_TYPE_NOT_ALLOWED);
        }
        if (!FilePathUtils.isMimeTypeValid(createReqVO.getType())) {
            throw exception(ErrorCodeConstants.FILE_METADATA_INVALID);
        }
        PresignTicket ticket = consumePresignTicket(createReqVO.getPath());
        if (fileMapper.selectByPath(createReqVO.getPath()) != null) {
            throw exception(ErrorCodeConstants.FILE_PATH_EXISTS);
        }
        FileObjectStat stat = verifyUploadedObjectStat(createReqVO.getPath());

        FileDO file = BeanUtils.toBean(createReqVO, FileDO.class);
        file.setSize(stat.size());
        if (StrUtil.isBlank(file.getType())) {
            file.setType(StrUtil.blankToDefault(ticket.contentType(), FileTypeUtils.getMineType(createReqVO.getName())));
        }
        // 公开资源持久化稳定访问 URL；私有附件留空，避免将短期预签名凭据落库。
        if (isPrivateObject(file.getPath())) {
            file.setUrl("");
        } else {
            file.setUrl(fileStorageService.presignGetUrl(file.getPath(), null));
            if (!FilePathUtils.isFileUrlValid(file.getUrl())) {
                throw exception(ErrorCodeConstants.FILE_METADATA_INVALID);
            }
        }
        try {
            fileMapper.insert(file);
        } catch (DuplicateKeyException ex) {
            throw exception(ErrorCodeConstants.FILE_PATH_EXISTS);
        }
        return file.getId();
    }

    /**
     * 为预签名上传路径签发 15 分钟有效的一次性登记凭证，并绑定申请用户与预期 MIME 类型。
     *
     * @param path                对象存储相对路径
     * @param expectedContentType 预签名绑定的预期 MIME 类型
     */
    private void issuePresignTicket(String path, String expectedContentType) {
        Long operatorId = SecurityFrameworkUtils.getLoginUserId();
        String safeContentType = StrUtil.emptyToDefault(expectedContentType, "");
        if (stringRedisTemplate != null) {
            String payload = (operatorId != null ? operatorId : "") + "|" + safeContentType;
            stringRedisTemplate.opsForValue().set(buildPresignTicketKey(path), payload, PRESIGN_TICKET_TTL);
            return;
        }
        long now = System.currentTimeMillis();
        if (localPresignTickets.size() >= MAX_LOCAL_PRESIGN_TICKETS) {
            localPresignTickets.entrySet().removeIf(entry -> entry.getValue().isExpired(now));
            if (localPresignTickets.size() >= MAX_LOCAL_PRESIGN_TICKETS) {
                localPresignTickets.entrySet().stream()
                        .min(Comparator.comparingLong(entry -> entry.getValue().expireAtMillis()))
                        .map(Map.Entry::getKey)
                        .ifPresent(localPresignTickets::remove);
            }
        }
        localPresignTickets.put(path, new PresignTicket(
                operatorId, safeContentType, now + PRESIGN_TICKET_TTL.toMillis()));
    }

    /**
     * 原子消费预签名直传凭证并校验持有人归属，防止伪造路径、过期复用或并发重复登记。
     *
     * @param path 对象存储相对路径
     * @return 已通过校验并消费的一次性凭证
     */
    private PresignTicket consumePresignTicket(String path) {
        PresignTicket ticket;
        if (stringRedisTemplate != null) {
            String raw = stringRedisTemplate.opsForValue().getAndDelete(buildPresignTicketKey(path));
            ticket = parseRedisTicket(raw);
        } else {
            PresignTicket localTicket = localPresignTickets.remove(path);
            ticket = (localTicket != null && !localTicket.isExpired(System.currentTimeMillis()))
                    ? localTicket : null;
        }
        if (ticket == null) {
            throw exception(ErrorCodeConstants.FILE_PRESIGN_TICKET_INVALID);
        }
        if (ticket.userId() != null && !Objects.equals(ticket.userId(), SecurityFrameworkUtils.getLoginUserId())) {
            throw exception(ErrorCodeConstants.FILE_PRESIGN_TICKET_INVALID);
        }
        return ticket;
    }

    /**
     * 解析 Redis 中保存的预签名凭证字符串；格式非法时返回 {@code null} 按无效凭证拒绝。
     *
     * @param raw Redis 中的原始文本
     * @return 解析后的凭证；为空或格式错误返回 {@code null}
     */
    private PresignTicket parseRedisTicket(String raw) {
        if (StrUtil.isBlank(raw)) {
            return null;
        }
        int sep = raw.indexOf('|');
        if (sep < 0) {
            return null;
        }
        String userPart = raw.substring(0, sep);
        String contentType = raw.substring(sep + 1);
        Long userId = null;
        if (!userPart.isEmpty()) {
            try {
                userId = Long.parseLong(userPart);
            } catch (NumberFormatException ex) {
                return null;
            }
        }
        return new PresignTicket(userId, contentType, 0L);
    }

    /**
     * 生成绑定对象路径哈希的 Redis 预签名凭证键名。
     *
     * @param path 对象相对路径
     * @return Redis 键名
     */
    private static String buildPresignTicketKey(String path) {
        return PRESIGN_TICKET_KEY_PREFIX + DigestUtil.sha256Hex(path);
    }

    /**
     * 通过对象存储 HEAD 查询验证已上传对象的存在性与真实大小；超限或空对象会被立即清理并拒绝登记。
     *
     * @param path 对象相对路径
     * @return 存储端实测对象元数据
     */
    private FileObjectStat verifyUploadedObjectStat(String path) {
        FileObjectStat stat = fileStorageService.statObject(path);
        if (stat == null) {
            throw exception(ErrorCodeConstants.FILE_NOT_EXISTS);
        }
        if (stat.size() <= 0 || stat.size() > FilePathUtils.MAX_UPLOAD_BYTES) {
            var sizeException = exception(stat.size() <= 0
                    ? ErrorCodeConstants.FILE_IS_EMPTY : ErrorCodeConstants.FILE_TOO_LARGE);
            try {
                fileStorageService.delete(path);
            } catch (Exception cleanupException) {
                sizeException.addSuppressed(cleanupException);
            }
            throw sizeException;
        }
        return stat;
    }

    /**
     * 元数据未能登记时补偿删除本次写入的对象；已存在同路径记录或无法确认归属时保留对象，避免误删他人文件。
     *
     * @param path 本次写入的对象路径
     * @param failure 触发补偿的原始异常，清理异常作为其 suppressed 附加
     */
    private void deleteUnregisteredObject(String path, RuntimeException failure) {
        try {
            if (fileMapper.selectByPath(path) == null) {
                fileStorageService.delete(path);
            }
        } catch (Exception cleanupException) {
            failure.addSuppressed(cleanupException);
        }
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
     * @throws Exception 任一对象删除失败时抛出，数据库批量删除不会执行
     */
    @Override
    @SneakyThrows
    public void deleteFileList(List<Long> ids) {
        // 批量删除时先遍历存储，再统一删除数据库记录，保持数据一致性。
        List<FileDO> files = fileMapper.selectByIds(ids);
        for (FileDO file : files) {
            fileStorageService.delete(file.getPath());
        }

        fileMapper.deleteByIds(ids);
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
     * 先校验公开访问契约与元数据未软删除，再流式打开公开资源内容并补齐字节长度。
     *
     * @param path 对象路径
     * @return 文件内容流与权威字节长度；记录不存在、已删除或存储对象缺失时返回 null
     * @throws Exception 读取存储失败时抛出
     */
    @Override
    public FileContentStream openFileContent(String path) throws Exception {
        if (isPrivateObject(path)) {
            throw exception(ErrorCodeConstants.FILE_ACCESS_DENIED);
        }
        FileDO file = fileMapper.selectByPath(path);
        if (file == null) {
            return null;
        }
        // 数据库排序规则和存储键的比较语义不同，打开对象前以持久化路径判定可见性。
        if (isPrivateObject(file.getPath())) {
            throw exception(ErrorCodeConstants.FILE_ACCESS_DENIED);
        }
        return openContentWithAuthoritativeSize(file);
    }

    /**
     * 判断对象路径是否按私有附件契约受保护（私有桶模式或命中 {@code private/} 目录前缀）。
     *
     * @param path 对象相对路径
     * @return 属于私有附件返回 true
     */
    @Override
    public boolean isPrivateObject(String path) {
        return !fileStorageService.isPublicAccess() || FilePathUtils.isPrivateObjectPath(path);
    }

    /**
     * 校验文件存在并执行统一私有附件对象级授权。
     *
     * @param id 文件记录编号
     * @return 已通过访问授权校验的文件元数据
     */
    @Override
    public FileDO getAuthorizedPrivateFile(Long id) {
        FileDO file = validateFileExists(id);
        assertCanAccessPrivateFile(file);
        return file;
    }

    /**
     * 执行统一对象级授权后，按 60~3600 秒契约生成私有附件的限时读取预签名地址。
     *
     * @param id 文件记录编号
     * @param expirationSeconds 有效期，单位秒；为空时默认 900 秒
     * @return 限时预签名读取地址
     */
    @Override
    public String presignPrivateGetUrl(Long id, Integer expirationSeconds) {
        int resolvedSeconds = resolveContractExpirationSeconds(expirationSeconds);
        FileDO file = getAuthorizedPrivateFile(id);
        return fileStorageService.presignPrivateGetUrl(file.getPath(), resolvedSeconds);
    }

    /**
     * 执行统一对象级授权后，以流式方式打开私有附件内容流。
     *
     * @param id 文件记录编号
     * @return 文件内容流与长度封装；存储对象缺失时返回 null
     * @throws Exception 读取存储失败时抛出
     */
    @Override
    public FileContentStream openPrivateFileContent(Long id) throws Exception {
        FileDO file = getAuthorizedPrivateFile(id);
        return openContentWithAuthoritativeSize(file);
    }

    /**
     * 对已通过对象级授权校验的私有附件直接打开内容流，避免控制器重复查库与鉴权。
     *
     * @param file 已授权校验的文件元数据
     * @return 文件内容流与长度封装；存储对象缺失时返回 null
     * @throws Exception 读取存储失败时抛出
     */
    @Override
    public FileContentStream openAuthorizedPrivateFileContent(FileDO file) throws Exception {
        return openContentWithAuthoritativeSize(file);
    }

    /** 按统一对象级授权规则校验当前登录用户是否有权读取私有附件（仅允许上传人本人或具备 infra:file:query 权限）。 */
    private void assertCanAccessPrivateFile(FileDO file) {
        Long loginUserId = SecurityFrameworkUtils.getLoginUserId();
        if (loginUserId == null) {
            throw exception(ErrorCodeConstants.FILE_ACCESS_DENIED);
        }
        if (StrUtil.isNotBlank(file.getCreator()) && Objects.equals(String.valueOf(loginUserId), file.getCreator())) {
            return;
        }
        if (permissionCommonApi != null && permissionCommonApi.hasAnyPermissions(loginUserId, "infra:file:query")) {
            return;
        }
        throw exception(ErrorCodeConstants.FILE_ACCESS_DENIED);
    }

    /** 按契约解析私有附件临时地址有效期，越界时抛出稳定业务异常。 */
    private static int resolveContractExpirationSeconds(Integer expirationSeconds) {
        try {
            return FilePathUtils.resolvePresignGetExpirationSeconds(expirationSeconds);
        } catch (IllegalArgumentException ex) {
            throw exception(ErrorCodeConstants.FILE_PRESIGN_EXPIRATION_INVALID);
        }
    }

    /** 打开底层存储对象流并优先保留存储端返回的权威字节长度。 */
    private FileContentStream openContentWithAuthoritativeSize(FileDO file) throws Exception {
        FileContentStream content = fileStorageService.openContent(file.getPath());
        if (content == null) {
            return null;
        }
        if (content.contentLength() != null || file.getSize() == null) {
            return content;
        }
        return new FileContentStream(content.inputStream(), file.getSize());
    }

}
