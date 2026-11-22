package com.basicframework.module.infra.service.file;

import cn.hutool.crypto.digest.DigestUtil;
import com.basicframework.framework.common.biz.system.permission.PermissionCommonApi;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.module.infra.controller.admin.file.vo.file.FileCreateReqVO;
import com.basicframework.module.infra.controller.admin.file.vo.file.FilePresignedUrlRespVO;
import com.basicframework.module.infra.dal.dataobject.file.FileDO;
import com.basicframework.module.infra.dal.mysql.file.FileMapper;
import com.basicframework.module.infra.framework.file.config.FileStorageProperties;
import com.basicframework.module.infra.framework.file.core.client.FileContentStream;
import com.basicframework.module.infra.framework.file.core.client.FileObjectStat;
import com.basicframework.module.infra.framework.file.core.client.s3.S3FileClient;
import com.basicframework.module.infra.framework.file.core.client.s3.S3FileClientConfig;
import com.basicframework.module.infra.framework.file.core.utils.FilePathUtils;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

import java.io.ByteArrayInputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

import static com.basicframework.module.infra.enums.ErrorCodeConstants.FILE_ACCESS_DENIED;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.FILE_NOT_EXISTS;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.FILE_PATH_EXISTS;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.FILE_PRESIGN_EXPIRATION_INVALID;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.FILE_PRESIGN_TICKET_INVALID;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.FILE_TOO_LARGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证 {@link FileServiceImpl} 的预签名一次性凭证、服务端 HEAD 实际大小校验与超限清理逻辑。
 *
 * @author shady2713
 */
@ExtendWith(MockitoExtension.class)
class FileServiceImplTest {

    @Mock
    private FileStorageService fileStorageService;
    @Mock
    private FileMapper fileMapper;

    @InjectMocks
    private FileServiceImpl fileService;

    /** 清理线程级登录上下文，避免用例间串扰。 */
    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    /** 验证预签名直传登记采信存储端真实大小、消费一次性凭证，并在重放时拒绝。 */
    @Test
    void createFileUsesAuthoritativeObjectSizeAndConsumesTicket() {
        setLoginUser(10L);
        when(fileStorageService.isPublicAccess()).thenReturn(true);
        when(fileStorageService.presignPutUrl(any(), eq("image/png"))).thenReturn("https://minio.local/put");
        when(fileStorageService.presignGetUrl(any(), eq(null))).thenReturn("https://minio.local/files/a.png");

        FilePresignedUrlRespVO presigned = fileService.presignPutUrl("demo.png", "avatar");
        FileCreateReqVO reqVO = buildCreateReqVO(presigned.getPath(), "demo.png", "image/png", 12L);
        when(fileMapper.selectByPath(presigned.getPath())).thenReturn(null);
        when(fileStorageService.statObject(presigned.getPath())).thenReturn(new FileObjectStat(4096L, "image/png"));
        doAnswer(inv -> {
            inv.<FileDO>getArgument(0).setId(88L);
            return 1;
        }).when(fileMapper).insert(any(FileDO.class));

        Long fileId = fileService.createFile(reqVO);

        assertThat(fileId).isEqualTo(88L);
        ArgumentCaptor<FileDO> captor = ArgumentCaptor.forClass(FileDO.class);
        verify(fileMapper).insert(captor.capture());
        assertThat(captor.getValue().getSize()).isEqualTo(4096L);
        assertThat(captor.getValue().getUrl()).isEqualTo("https://minio.local/files/a.png");
        assertThatThrownBy(() -> fileService.createFile(reqVO))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(FILE_PRESIGN_TICKET_INVALID.getCode()));
    }

    /** 验证伪造未申请预签名的路径以及跨用户重放凭证都会在登记阶段被拦截。 */
    @Test
    void createFileRejectsUnissuedOrCrossUserTicket() {
        FileCreateReqVO forged = buildCreateReqVO("20261119/forged.png", "forged.png", "image/png", 100L);
        assertThatThrownBy(() -> fileService.createFile(forged))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(FILE_PRESIGN_TICKET_INVALID.getCode()));

        setLoginUser(10L);
        when(fileStorageService.presignPutUrl(any(), eq("image/png"))).thenReturn("https://minio.local/put");
        FilePresignedUrlRespVO presigned = fileService.presignPutUrl("demo.png", null);

        setLoginUser(20L);
        FileCreateReqVO crossUserReq = buildCreateReqVO(presigned.getPath(), "demo.png", "image/png", 100L);
        assertThatThrownBy(() -> fileService.createFile(crossUserReq))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(FILE_PRESIGN_TICKET_INVALID.getCode()));
        verify(fileMapper, never()).insert(any(FileDO.class));
    }

    /** 验证对象尚未上传（HEAD 返回空）、路径重复以及对象超限清理删除分支。 */
    @Test
    void createFileValidatesObjectExistenceDuplicatePathAndOversizeCleanup() throws Exception {
        setLoginUser(10L);
        when(fileStorageService.presignPutUrl(any(), eq("image/png"))).thenReturn("https://minio.local/put");

        FilePresignedUrlRespVO missingPresign = fileService.presignPutUrl("missing.png", null);
        when(fileStorageService.statObject(missingPresign.getPath())).thenReturn(null);
        assertThatThrownBy(() -> fileService.createFile(
                buildCreateReqVO(missingPresign.getPath(), "missing.png", "image/png", 100L)))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(FILE_NOT_EXISTS.getCode()));

        FilePresignedUrlRespVO dupPresign = fileService.presignPutUrl("dup.png", null);
        when(fileMapper.selectByPath(dupPresign.getPath())).thenReturn(new FileDO());
        assertThatThrownBy(() -> fileService.createFile(
                buildCreateReqVO(dupPresign.getPath(), "dup.png", "image/png", 100L)))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(FILE_PATH_EXISTS.getCode()));

        FilePresignedUrlRespVO oversizePresign = fileService.presignPutUrl("big.png", null);
        when(fileMapper.selectByPath(oversizePresign.getPath())).thenReturn(null);
        when(fileStorageService.statObject(oversizePresign.getPath()))
                .thenReturn(new FileObjectStat(FilePathUtils.MAX_UPLOAD_BYTES + 1L, "image/png"));
        assertThatThrownBy(() -> fileService.createFile(
                buildCreateReqVO(oversizePresign.getPath(), "big.png", "image/png", 100L)))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(FILE_TOO_LARGE.getCode()));
        verify(fileStorageService).delete(oversizePresign.getPath());
        verify(fileMapper, never()).insert(any(FileDO.class));
    }

    /** 验证启用 Redis 时使用 15 分钟 TTL 写入并原子消费一次性预签名凭证。 */
    @Test
    @SuppressWarnings("unchecked")
    void presignAndCreateFileUsesRedisOneTimeTicketWhenAvailable() {
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        ValueOperations<String, String> valueOps = mock(ValueOperations.class);
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        ReflectionTestUtils.setField(fileService, "stringRedisTemplate", redisTemplate);
        setLoginUser(10L);
        when(fileStorageService.presignPutUrl(any(), eq("image/png"))).thenReturn("https://minio.local/put");

        FilePresignedUrlRespVO presigned = fileService.presignPutUrl("redis.png", null);
        String ticketKey = "infra:file:presign:ticket:" + DigestUtil.sha256Hex(presigned.getPath());
        verify(valueOps).set(ticketKey, "10|image/png", Duration.ofMinutes(15));

        when(valueOps.getAndDelete(ticketKey)).thenReturn("10|image/png");
        when(fileStorageService.statObject(presigned.getPath())).thenReturn(new FileObjectStat(512L, "image/png"));
        doAnswer(inv -> {
            inv.<FileDO>getArgument(0).setId(99L);
            return 1;
        }).when(fileMapper).insert(any(FileDO.class));

        Long id = fileService.createFile(buildCreateReqVO(presigned.getPath(), "redis.png", "image/png", 1L));
        assertThat(id).isEqualTo(99L);
        verify(valueOps).getAndDelete(ticketKey);
    }

    /** 验证私有附件统一对象级授权（上传人本人与 infra:file:query 放行，未登录/越权拒绝）及临时地址 60~3600 秒有效期契约。 */
    @Test
    void privateAttachmentEnforcesUnifiedAuthorizationAndBoundedPresignTtl() throws Exception {
        FileDO privateFile = new FileDO();
        privateFile.setId(501L);
        privateFile.setPath("private/20261121/contract.pdf");
        privateFile.setCreator("10");
        privateFile.setSize(12L);
        when(fileMapper.selectById(501L)).thenReturn(privateFile);
        when(fileStorageService.isPublicAccess()).thenReturn(true);

        // 匿名公开下载入口拒绝 private/ 前缀对象；未登录无法获取私有临时地址。
        assertThatThrownBy(() -> fileService.openFileContent("private/20261121/contract.pdf"))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(FILE_ACCESS_DENIED.getCode()));
        assertThatThrownBy(() -> fileService.presignPrivateGetUrl(501L, 300))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(FILE_ACCESS_DENIED.getCode()));

        // 非上传人且无 infra:file:query 权限被拒绝；具备 infra:file:query 权限放行。
        PermissionCommonApi permissionApi = mock(PermissionCommonApi.class);
        ReflectionTestUtils.setField(fileService, "permissionCommonApi", permissionApi);
        setLoginUser(20L);
        when(permissionApi.hasAnyPermissions(20L, "infra:file:query")).thenReturn(false);
        assertThatThrownBy(() -> fileService.openPrivateFileContent(501L))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(FILE_ACCESS_DENIED.getCode()));

        when(permissionApi.hasAnyPermissions(20L, "infra:file:query")).thenReturn(true);
        when(fileStorageService.presignPrivateGetUrl(privateFile.getPath(), 900)).thenReturn("https://signed/900");
        assertThat(fileService.presignPrivateGetUrl(501L, null)).isEqualTo("https://signed/900");

        // 上传人本人放行流式下载，但越界 TTL（<60 或 >3600）按契约拒绝。
        setLoginUser(10L);
        when(fileStorageService.openContent(privateFile.getPath()))
                .thenReturn(new FileContentStream(new ByteArrayInputStream("pdf".getBytes(StandardCharsets.UTF_8)), 3L));
        try (FileContentStream stream = fileService.openPrivateFileContent(501L)) {
            assertThat(stream.contentLength()).isEqualTo(3L);
        }
        assertThatThrownBy(() -> fileService.presignPrivateGetUrl(501L, 59))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(FILE_PRESIGN_EXPIRATION_INVALID.getCode()));
        assertThatThrownBy(() -> fileService.presignPrivateGetUrl(501L, 3601))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(FILE_PRESIGN_EXPIRATION_INVALID.getCode()));

        // FileStorageProperties 默认使用 local，阿里云 OSS 默认私有访问且支持切换。
        FileStorageProperties props = buildOssProperties();
        assertThat(props.toAliyunOssClientConfig().getEnablePublicAccess()).isFalse();
        props.getOss().setPublicAccess(true);
        assertThat(props.toAliyunOssClientConfig().getEnablePublicAccess()).isTrue();
        assertThat(FilePathUtils.isPrivateObjectPath("private")).isTrue();
        assertThat(FilePathUtils.isPrivateObjectPath("PRIVATE ")).isTrue();
        assertThat(FilePathUtils.isPrivateObjectPath("pRiVaTe copy/a.pdf")).isTrue();
        assertThat(FilePathUtils.isPrivateObjectPath(" avatar/a.png")).isTrue();
        assertThat(FilePathUtils.isPrivateObjectPath("private-assets/a.png")).isFalse();
        assertThat(FilePathUtils.isPrivateObjectPath("public/private/a.png")).isFalse();
        assertThat(FilePathUtils.isPrivateObjectPath("Private/a.pdf")).isTrue();
        assertThat(FilePathUtils.isPrivateObjectPath("avatar/a.png")).isFalse();
    }

    /** 验证私有附件上传入库时持久化空 URL，不落库短期预签名凭据。 */
    @Test
    void createPrivateFileShouldNotPersistSignedUrl() throws Exception {
        byte[] content = "private-report".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        when(fileStorageService.isPublicAccess()).thenReturn(true);
        when(fileStorageService.upload(eq(content), any(), eq("text/plain")))
                .thenReturn("https://oss.example.test/private/a.txt?X-Amz-Signature=deadbeef");

        String returnedUrl = fileService.createFile(content, "report.txt", "private/hr", "text/plain");

        assertThat(returnedUrl).isEmpty();
        org.mockito.ArgumentCaptor<FileDO> captor = org.mockito.ArgumentCaptor.forClass(FileDO.class);
        verify(fileMapper).insert(captor.capture());
        assertThat(captor.getValue().getPath()).startsWith("private/hr/");
        assertThat(captor.getValue().getUrl()).isEmpty();
    }

    /** 验证 S3 预签名客户端在配置对外域名与显式签名根地址时的解析行为。 */
    @Test
    void s3PresignerShouldUseConfiguredRootSigningEndpoint() {
        FileStorageProperties props = buildOssProperties();
        URI internal = URI.create("https://oss-cn-hangzhou.aliyuncs.com");
        assertThat(props.isProviderValid()).isTrue();
        assertThat(props.isAliyunOssConfigComplete()).isTrue();

        props.getOss().setSigningEndpoint(" https://files.example.test:8443/ ");
        S3FileClientConfig cfg = props.toAliyunOssClientConfig();
        assertThat(cfg.isSigningEndpointValid()).isTrue();
        URI resolved = ReflectionTestUtils.invokeMethod(new S3FileClient(2L, cfg),
                "resolvePresignerEndpoint", internal);
        assertThat(resolved).isEqualTo(URI.create("https://files.example.test:8443"));

        props.getOss().setSigningEndpoint("https://files.example.test/basic-framework");
        S3FileClientConfig invalidCfg = props.toAliyunOssClientConfig();
        assertThat(invalidCfg.isSigningEndpointValid()).isFalse();
        assertThatThrownBy(() -> ReflectionTestUtils.invokeMethod(new S3FileClient(3L, invalidCfg),
                "resolvePresignerEndpoint", internal))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(S3FileClientConfig.isRootHttpOrigin("https://user@files.example.test")).isFalse();
        assertThat(S3FileClientConfig.isRootHttpOrigin("https://files.example.test?a=b")).isFalse();
    }

    /** 核对签名保留存储原始键、网关 Host 及路径式桶名。 */
    @Test
    void s3PrivateGetShouldSignExactRawObjectKey() {
        FileStorageProperties props = buildOssProperties();
        props.getOss().setPublicAccess(false);
        props.getOss().setSigningEndpoint("https://files.example.test");
        S3FileClientConfig cfg = props.toAliyunOssClientConfig();
        cfg.setEnablePathStyleAccess(true);
        S3FileClient client = new S3FileClient(4L, cfg);
        URI signingEndpoint = ReflectionTestUtils.invokeMethod(client,
                "resolvePresignerEndpoint", URI.create(cfg.getEndpoint()));
        try (S3Presigner presigner = S3Presigner.builder()
                .region(Region.of(cfg.getRegion()))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(cfg.getAccessKey(), cfg.getAccessSecret())))
                .endpointOverride(signingEndpoint)
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
                .build()) {
            ReflectionTestUtils.setField(client, "presigner", presigner);

            URI signed = URI.create(client.presignPrivateGetUrl("private/a%20b#c+d.pdf", 300));

            assertThat(signed.getScheme()).isEqualTo("https");
            assertThat(signed.getRawAuthority()).isEqualTo("files.example.test");
            assertThat(signed.getRawPath()).isEqualTo("/basic-framework/private/a%2520b%23c%2Bd.pdf");
            assertThat(signed.getRawQuery().contains("X-Amz-Signature=")).isTrue();
            URI viaRawKey = URI.create(client.presignGetUrl("private/a%20b#c+d.pdf", 300));
            assertThat(viaRawKey.getRawPath()).isEqualTo(signed.getRawPath());
        }
    }

    /** 验证私有预签名直传不提前返回临时 GET URL，且公开 URL 对特殊字符分段编码并可还原原始键。 */
    @Test
    void privatePresignPutReturnsEmptyVisitUrlAndPublicUrlEncodesSegments() {
        setLoginUser(10L);
        when(fileStorageService.presignPutUrl(
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString()))
                .thenReturn("https://upload.local/put");
        when(fileStorageService.isPublicAccess()).thenReturn(true);

        var resp = fileService.presignPutUrl("report.pdf", "private/hr");
        assertThat(resp.getUrl()).isEmpty();
        verify(fileStorageService, never()).presignGetUrl(org.mockito.ArgumentMatchers.anyString(), any());

        FileStorageProperties props = buildOssProperties();
        props.getOss().setPublicAccess(true);
        S3FileClientConfig cfg = props.toAliyunOssClientConfig();
        S3FileClient publicClient = new S3FileClient(5L, cfg);
        String publicUrl = publicClient.presignGetUrl("public/100%report#1?v=2 a+b.pdf", null);
        assertThat(publicUrl).isEqualTo(
                cfg.getDomain() + "/public/100%25report%231%3Fv=2%20a+b.pdf");
        String extracted = ReflectionTestUtils.invokeMethod(publicClient, "extractObjectPath", publicUrl);
        assertThat(extracted).isEqualTo("public/100%report#1?v=2 a+b.pdf");
    }

    /** Builds synthetic Aliyun OSS properties for presigner tests. */
    private static FileStorageProperties buildOssProperties() {
        FileStorageProperties props = new FileStorageProperties();
        props.setProvider(FileStorageProperties.PROVIDER_ALIYUN_OSS);
        props.getOss().setEndpoint("https://oss-cn-hangzhou.aliyuncs.com");
        props.getOss().setAccessKey("ak");
        props.getOss().setSecretKey("sk");
        props.getOss().setBucket("basic-framework");
        props.getOss().setRegion("oss-cn-hangzhou");
        props.getOss().setPublicUrl("https://basic-framework.oss-cn-hangzhou.aliyuncs.com");
        props.getOss().setPublicAccess(false);
        return props;
    }

    /** 构造文件登记请求对象。 */
    private static FileCreateReqVO buildCreateReqVO(String path, String name, String type, Long size) {
        FileCreateReqVO reqVO = new FileCreateReqVO();
        reqVO.setPath(path);
        reqVO.setName(name);
        reqVO.setType(type);
        reqVO.setUrl("https://client-spoofed.invalid/ignored");
        reqVO.setSize(size);
        return reqVO;
    }

    /** 设置当前线程登录用户编号。 */
    private static void setLoginUser(Long userId) {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(userId);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(loginUser, null));
    }
}
