package com.basicframework.module.infra.controller.admin.file;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.module.infra.controller.admin.file.vo.file.FileUploadReqVO;
import com.basicframework.module.infra.framework.file.config.FileUploadProperties;
import com.basicframework.module.infra.service.file.FileService;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证文件入口的边界保护：上传大小上限与下载路径校验。
 *
 * <p>上传入口有两道大小保护：请求声明的大小超限时必须立刻拒绝且不读流、不落库，
 * 否则攻击者可以用超大文件消耗带宽与存储；声明与实际不一致的情况由读取上限兜底
 * （已有用例覆盖）。下载入口按 URI 中的 {@code /content/} 之后的部分取对象路径，
 * 路径缺失时必须明确拒绝而不是拿空路径去存储查询；对象不存在时必须返回 404 且不写响应体，
 * 否则浏览器会拿到一个空文件并误以为下载成功。</p>
 *
 * @author shady2713
 */
class FileControllerContentGuardTest {

    /** 被测控制器。 */
    private final FileController controller = new FileController();

    /** 文件服务替身。 */
    private final FileService fileService = mock(FileService.class);

    /** 声明大小超限时必须立刻拒绝，且不访问文件服务。 */
    @Test
    void uploadRejectsDeclaredOversizeBeforeReadingStream() throws Exception {
        FileUploadProperties limits = new FileUploadProperties();
        limits.setMaxBytes(2);
        ReflectionTestUtils.setField(controller, "fileService", fileService);
        ReflectionTestUtils.setField(controller, "uploadLimits", limits);
        FileUploadReqVO reqVO = new FileUploadReqVO();
        reqVO.setFile(new MockMultipartFile("file", "big.txt", "text/plain", new byte[] {1, 2, 3}));

        assertThatThrownBy(() -> controller.uploadFile(reqVO))
                .isInstanceOf(ServiceException.class)
                .hasMessage("文件大小无效或超过上传限制");
        verifyNoInteractions(fileService);
    }

    /** 下载路径缺少 /content/ 段时必须明确拒绝，不能拿空路径查询存储。 */
    @Test
    void downloadRejectsRequestWithoutContentPath() {
        ReflectionTestUtils.setField(controller, "fileService", fileService);
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/infra/file/download");
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThatThrownBy(() -> controller.getFileContent(request, response))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("结尾的 path 路径必须传递");
        verifyNoInteractions(fileService);
    }

    /** 对象不存在时必须返回 404 且不写响应体，避免下载到空文件。 */
    @Test
    void downloadMissingObjectReturnsNotFoundWithoutBody() throws Exception {
        ReflectionTestUtils.setField(controller, "fileService", fileService);
        when(fileService.getFileContent(anyString())).thenReturn(null);
        MockHttpServletRequest request = new MockHttpServletRequest("GET",
                "/admin-api/infra/file/content/demo/absent.txt");
        MockHttpServletResponse response = new MockHttpServletResponse();

        controller.getFileContent(request, response);

        assertThat(response.getStatus()).isEqualTo(HttpStatus.NOT_FOUND.value());
        assertThat(response.getContentAsByteArray()).as("对象不存在时不得写出任何内容").isEmpty();
    }

    /** 对象存在时按附件写出内容，文件名参与响应头编码。 */
    @Test
    void downloadExistingObjectWritesAttachment() throws Exception {
        ReflectionTestUtils.setField(controller, "fileService", fileService);
        when(fileService.getFileContent("demo/a.txt")).thenReturn("hello".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        MockHttpServletRequest request = new MockHttpServletRequest("GET",
                "/admin-api/infra/file/content/demo/a.txt");
        MockHttpServletResponse response = new MockHttpServletResponse();

        controller.getFileContent(request, response);

        assertThat(response.getStatus()).isEqualTo(HttpStatus.OK.value());
        assertThat(response.getContentAsByteArray())
                .isEqualTo("hello".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertThat(response.getHeader("Content-Disposition")).contains("attachment");
    }

}
