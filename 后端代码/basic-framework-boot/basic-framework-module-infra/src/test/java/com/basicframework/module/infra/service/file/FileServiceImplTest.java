package com.basicframework.module.infra.service.file;

import cn.hutool.crypto.digest.DigestUtil;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.module.infra.controller.admin.file.vo.file.FileCreateReqVO;
import com.basicframework.module.infra.controller.admin.file.vo.file.FilePresignedUrlRespVO;
import com.basicframework.module.infra.dal.dataobject.file.FileDO;
import com.basicframework.module.infra.dal.mysql.file.FileMapper;
import com.basicframework.module.infra.framework.file.core.client.FileObjectStat;
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

import java.time.Duration;

import static com.basicframework.module.infra.enums.ErrorCodeConstants.FILE_NOT_EXISTS;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.FILE_PATH_EXISTS;
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
        when(fileStorageService.presignGetUrl(any(), eq(null))).thenReturn("https://minio.local/files/a.png");
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
        when(fileStorageService.presignGetUrl(any(), eq(null))).thenReturn("https://minio.local/files/a.png");

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
        when(fileStorageService.presignGetUrl(any(), eq(null))).thenReturn("https://minio.local/files/r.png");

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
