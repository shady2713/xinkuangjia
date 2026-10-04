package com.basicframework.module.infra.service.file;

import cn.hutool.crypto.digest.DigestUtil;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.module.infra.controller.admin.file.vo.file.FileCreateReqVO;
import com.basicframework.module.infra.controller.admin.file.vo.file.FilePageReqVO;
import com.basicframework.module.infra.controller.admin.file.vo.file.FilePresignedUrlRespVO;
import com.basicframework.module.infra.dal.dataobject.file.FileDO;
import com.basicframework.module.infra.dal.dataobject.file.FileUploadDO;
import com.basicframework.module.infra.dal.mysql.file.FileMapper;
import com.basicframework.module.infra.enums.ErrorCodeConstants;
import com.basicframework.module.infra.framework.file.config.FileUploadProperties;
import com.basicframework.module.infra.framework.file.core.utils.FilePathUtils;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.mock.web.MockHttpServletRequest;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证文件服务在元数据查询、服务端上传校验、身份归属与读取委派上的实际契约。
 *
 * <p>服务端上传路径必须先按内容与文件名双重校验再落对象，任何一步放行都可能让伪装文件进入
 * 对象存储；上传身份只能来自登录上下文，缺少身份时内部调用与外部调用必须走不同分支；读取
 * 入口不得把未验证的暂存对象暴露出去。用例用替身隔离对象存储与数据库，断言真实抛出的错误码、
 * 传给存储与预约服务的参数，以及删除顺序。</p>
 *
 * @author shady2713
 */
class FileServiceImplUploadAndReadTest {

    /** 登录用户编号，用于断言上传归属。 */
    private static final Long LOGIN_USER_ID = 1024L;

    /** 被测服务。 */
    private FileServiceImpl service;
    /** 对象存储服务替身。 */
    private FileStorageService storage;
    /** 文件元数据 Mapper 替身。 */
    private FileMapper mapper;
    /** 上传预约与完成流程替身。 */
    private FileUploadLifecycle lifecycle;
    /** 上传大小上限配置。 */
    private FileUploadProperties limits;

    /** 为每个用例装配独立服务与替身。 */
    @BeforeEach
    void setUp() {
        service = new FileServiceImpl();
        storage = mock(FileStorageService.class);
        mapper = mock(FileMapper.class);
        lifecycle = mock(FileUploadLifecycle.class);
        limits = new FileUploadProperties();
        ReflectionTestUtils.setField(service, "fileStorageService", storage);
        ReflectionTestUtils.setField(service, "fileMapper", mapper);
        ReflectionTestUtils.setField(service, "uploadLifecycle", lifecycle);
        ReflectionTestUtils.setField(service, "uploadLimits", limits);
    }

    /** 清理登录身份与请求上下文，避免归属在用例之间泄漏。 */
    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
        RequestContextHolder.resetRequestAttributes();
    }

    /**
     * 分页查询必须原样下传查询条件并返回 Mapper 的分页结果。
     */
    @Test
    void getFilePageDelegatesToMapper() {
        FilePageReqVO pageReqVO = new FilePageReqVO();
        PageResult<FileDO> page = new PageResult<>(List.of(file(1L, "probe/20261004/a.png")), 3L);
        when(mapper.selectPage(pageReqVO)).thenReturn(page);

        assertThat(service.getFilePage(pageReqVO)).isSameAs(page);
    }

    /**
     * 空内容与超过上限的内容必须在任何路径生成或预约之前被拒绝。
     */
    @Test
    void createFileRejectsEmptyAndOversizedContent() {
        assertThatThrownBy(() -> service.createFile(null, "probe.png", null, null))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.FILE_IS_EMPTY.getCode());
        assertThatThrownBy(() -> service.createFile(new byte[0], "probe.png", null, null))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.FILE_IS_EMPTY.getCode());

        limits.setMaxBytes(4);
        assertThatThrownBy(() -> service.createFile(new byte[5], "probe.png", null, null))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.FILE_SIZE_EXCEEDED.getCode());
        verifyNoInteractions(storage, lifecycle);
    }

    /**
     * 合法上传必须补齐缺失后缀、生成日期目录对象键，并以内部系统身份预约与完成。
     */
    @Test
    void createFileCompletesUploadWithInternalOwner() throws Exception {
        byte[] content = pngContent();
        FileUploadDO upload = new FileUploadDO();
        upload.setStagingPath("upload-staging/probe");
        when(lifecycle.reserve(anyString(), anyString(), anyString(), anyLong(), anyBoolean())).thenReturn(upload);
        FileDO stored = file(7L, "probe");
        stored.setUrl("https://files.example.com/probe.png");
        when(lifecycle.complete(anyString(), anyString(), any())).thenReturn(stored);

        String url = service.createFile(content, "C:\\fakepath\\头像", "profile", null);

        ArgumentCaptor<String> path = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> name = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Long> size = ArgumentCaptor.forClass(Long.class);
        verify(lifecycle).reserve(eq("internal:system"), path.capture(), name.capture(), size.capture(), eq(false));
        assertThat(name.getValue()).as("缺少后缀时必须按探测结果补齐").endsWith(".png");
        assertThat(name.getValue()).as("必须只保留最后一级文件名").doesNotContain("fakepath", "\\");
        assertThat(path.getValue()).matches("profile/\\d{8}/头像_[0-9a-f]{32}\\.png");
        assertThat(size.getValue()).isEqualTo((long) content.length);
        assertThat(url).isEqualTo("https://files.example.com/probe.png");
        verify(lifecycle).complete(path.getValue(), "internal:system", content);
    }

    /**
     * 未提供文件名时必须使用内容摘要生成稳定名称并补齐后缀。
     */
    @Test
    void createFileDerivesNameFromContentDigest() throws Exception {
        byte[] content = pngContent();
        FileDO stored = file(7L, "probe");
        stored.setUrl("https://files.example.com/digest.png");
        when(lifecycle.reserve(anyString(), anyString(), anyString(), anyLong(), anyBoolean()))
                .thenReturn(new FileUploadDO());
        when(lifecycle.complete(anyString(), anyString(), any())).thenReturn(stored);

        service.createFile(content, null, null, null);

        ArgumentCaptor<String> name = ArgumentCaptor.forClass(String.class);
        verify(lifecycle).reserve(anyString(), anyString(), name.capture(), anyLong(), anyBoolean());
        assertThat(name.getValue()).isEqualTo(DigestUtil.sha256Hex(content) + ".png");
    }

    /**
     * 文件名或内容类型不满足白名单时必须在预约前拒绝，避免脏对象键与伪装文件。
     */
    @Test
    void createFileRejectsInvalidNameAndDisallowedType() throws Exception {
        byte[] content = pngContent();
        String overlongName = "a".repeat(FilePathUtils.MAX_FILE_NAME_LENGTH + 1) + ".png";

        assertThatThrownBy(() -> service.createFile(content, overlongName, null, null))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.FILE_PATH_INVALID.getCode());
        assertThatThrownBy(() -> service.createFile(content, "probe.exe", null, null))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.FILE_TYPE_NOT_ALLOWED.getCode());
        verifyNoInteractions(storage, lifecycle);
    }

    /**
     * 目录合法但拼接后的完整对象键超过列容量时，必须在返回路径前拒绝。
     */
    @Test
    void generateUploadPathRejectsOverlongObjectKey() {
        assertThatThrownBy(() -> service.generateUploadPath("avatar.png", "d".repeat(500)))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.FILE_PATH_INVALID.getCode());
    }

    /**
     * 无后缀文件名同样必须获得唯一后缀标识，不能生成以点号结尾的对象键。
     */
    @Test
    void generateUploadPathAppendsUniqueSuffixWithoutExtension() {
        String path = service.generateUploadPath("avatar", null);

        assertThat(path).doesNotEndWith(".").doesNotContain("avatar_avatar");
        assertThat(path).matches("\\d{8}/avatar_[0-9a-f]{32}");
        assertThat(FilePathUtils.isObjectPathValid(path)).isTrue();
    }

    /**
     * 读取地址必须原样委派给存储服务，有效期参数不得被吞掉。
     */
    @Test
    void presignGetUrlDelegatesToStorage() {
        when(storage.presignGetUrl("probe/20261004/a.png", 600)).thenReturn("https://files.example.com/signed");

        assertThat(service.presignGetUrl("probe/20261004/a.png", 600))
                .isEqualTo("https://files.example.com/signed");
    }

    /**
     * 完成直传预约必须校验对象键并以上传者身份登记，返回文件编号。
     */
    @Test
    void createFileFromReservationUsesLoginOwner() throws Exception {
        bindLoginUser(LOGIN_USER_ID);
        FileCreateReqVO reqVO = new FileCreateReqVO();
        reqVO.setPath("probe/20261004/a.png");
        FileDO stored = file(9L, reqVO.getPath());
        when(lifecycle.complete(reqVO.getPath(), "2:" + LOGIN_USER_ID, null)).thenReturn(stored);

        assertThat(service.createFile(reqVO)).isEqualTo(9L);
    }

    /**
     * 预约路径不合法时必须在登记前拒绝，不得触碰预约流程。
     */
    @Test
    void createFileFromReservationRejectsInvalidPath() {
        bindLoginUser(LOGIN_USER_ID);
        FileCreateReqVO reqVO = new FileCreateReqVO();
        reqVO.setPath("../another-user/a.png");

        assertThatThrownBy(() -> service.createFile(reqVO))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.FILE_PATH_INVALID.getCode());
        verifyNoInteractions(lifecycle);
    }

    /**
     * 直传预约缺少登录身份时必须拒绝，即使存在请求上下文也不能降级为内部身份。
     */
    @Test
    void createFileRejectsDirectUploadWithoutLoginUser() {
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        FileCreateReqVO reqVO = new FileCreateReqVO();
        reqVO.setPath("probe/20261004/a.png");

        assertThatThrownBy(() -> service.createFile(reqVO))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.FILE_UPLOAD_INVALID.getCode());
        verifyNoInteractions(lifecycle);
    }

    /**
     * 服务端内部上传在存在请求上下文但无登录身份时同样必须拒绝，防止匿名写入。
     */
    @Test
    void createFileRejectsServerUploadInsideRequestWithoutLoginUser() {
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));

        assertThatThrownBy(() -> service.createFile(pngContent(), "probe.png", null, null))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.FILE_UPLOAD_INVALID.getCode());
        verifyNoInteractions(lifecycle);
    }

    /**
     * 批量删除必须逐项先删对象再删元数据，全部成功时不残留记录。
     */
    @Test
    void deleteFileListDeletesObjectBeforeMetadata() throws Exception {
        FileDO first = file(1L, "probe/a.png");
        FileDO second = file(2L, "probe/b.png");
        when(mapper.selectByIds(List.of(1L, 2L))).thenReturn(List.of(first, second));

        service.deleteFileList(List.of(1L, 2L));

        InOrder order = inOrder(storage, mapper);
        order.verify(storage).delete("probe/a.png");
        order.verify(mapper).deleteById(1L);
        order.verify(storage).delete("probe/b.png");
        order.verify(mapper).deleteById(2L);
    }

    /**
     * 记录不存在时查询必须抛出稳定业务异常，删除也不得触碰对象存储。
     */
    @Test
    void missingFileIsRejectedOnQueryAndDelete() throws Exception {
        when(mapper.selectById(404L)).thenReturn(null);

        assertThatThrownBy(() -> service.getFile(404L))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.FILE_NOT_EXISTS.getCode());
        assertThatThrownBy(() -> service.deleteFile(404L))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.FILE_NOT_EXISTS.getCode());
        verify(storage, never()).delete(anyString());
    }

    /**
     * 合法对象路径的读取必须委派给存储服务，暂存与越界路径仍返回 null。
     */
    @Test
    void getFileContentDelegatesForValidPath() throws Exception {
        when(storage.getContent("probe/20261004/a.png")).thenReturn(new byte[]{1, 2, 3});

        assertThat(service.getFileContent("probe/20261004/a.png")).containsExactly(1, 2, 3);
        assertThat(service.getFileContent("upload-staging/a.png")).isNull();
    }

    /**
     * 生成一张真实 PNG 内容，供类型识别与白名单校验使用。
     *
     * @return PNG 字节内容
     * @throws Exception 编码失败时抛出
     */
    private static byte[] pngContent() throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB), "png", output);
        return output.toByteArray();
    }

    /**
     * 把指定编号的管理员绑定到安全上下文。
     *
     * @param userId 用户编号
     */
    private static void bindLoginUser(Long userId) {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(userId);
        loginUser.setUserType(2);
        SecurityContextHolder.setContext(SecurityContextHolder.createEmptyContext());
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(loginUser, null));
    }

    /**
     * 构造仅填充断言涉及字段的文件记录。
     *
     * @param id 文件编号
     * @param path 对象路径
     * @return 文件持久对象
     */
    private static FileDO file(Long id, String path) {
        FileDO file = new FileDO();
        file.setId(id);
        file.setPath(path);
        return file;
    }

}
