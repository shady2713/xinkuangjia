package com.basicframework.module.infra.controller.admin.file;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.module.infra.controller.admin.file.vo.file.FileUploadReqVO;
import com.basicframework.module.infra.dal.dataobject.file.FileDO;
import com.basicframework.module.infra.framework.file.core.client.FileContentStream;
import com.basicframework.module.infra.service.file.FileService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

import static com.basicframework.module.infra.enums.ErrorCodeConstants.FILE_TOO_LARGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证文件上传的流式读取上限和接口早拒绝行为。
 *
 * @author shady2713
 */
class FileControllerTest {

    /** 验证恰好达到上限的内容可以完整读取，边界内不误判。 */
    @Test
    void readBytesWithLimitAcceptsExactLimit() throws IOException {
        byte[] content = "1234567890".getBytes(StandardCharsets.UTF_8);

        byte[] actual = FileController.readBytesWithLimit(new ByteArrayInputStream(content), content.length);

        assertThat(actual).isEqualTo(content);
    }

    /** 验证实际字节数超过上限时立即失败，而不是继续读取并占用堆内存。 */
    @Test
    void readBytesWithLimitRejectsContentOverLimit() {
        byte[] content = "12345678901".getBytes(StandardCharsets.UTF_8);

        assertThatThrownBy(() -> FileController.readBytesWithLimit(
                new ByteArrayInputStream(content), content.length - 1L))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(FILE_TOO_LARGE.getCode()));
    }

    /** 验证调用方传入负数上限时明确拒绝，避免上限配置被误解为无限制。 */
    @Test
    void readBytesWithLimitRejectsNegativeLimit() {
        assertThatThrownBy(() -> FileController.readBytesWithLimit(
                new ByteArrayInputStream(new byte[0]), -1))
                .isInstanceOf(IllegalArgumentException.class);
    }

    /** 验证容器声明超限时直接失败，不读取内容也不调用存储服务。 */
    @Test
    void uploadFileRejectsDeclaredOversizeBeforeReading() throws Exception {
        FileService fileService = mock(FileService.class);
        FileController controller = new FileController();
        ReflectionTestUtils.setField(controller, "fileService", fileService);
        MultipartFile file = mock(MultipartFile.class);
        when(file.getSize()).thenReturn(FileController.MAX_UPLOAD_BYTES + 1);
        FileUploadReqVO reqVO = new FileUploadReqVO();
        reqVO.setFile(file);

        assertThatThrownBy(() -> controller.uploadFile(reqVO))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(FILE_TOO_LARGE.getCode()));
        verify(file, never()).getInputStream();
        verify(fileService, never()).createFile(any(), any(), any(), any());
    }

    /** 验证上限内文件按有界读取后交给存储服务登记。 */
    @Test
    void uploadFileDelegatesBoundedContentToFileService() throws Exception {
        FileService fileService = mock(FileService.class);
        FileController controller = new FileController();
        ReflectionTestUtils.setField(controller, "fileService", fileService);
        MultipartFile file = mock(MultipartFile.class);
        byte[] content = "demo".getBytes(StandardCharsets.UTF_8);
        when(file.getSize()).thenReturn((long) content.length);
        when(file.getInputStream()).thenReturn(new ByteArrayInputStream(content));
        when(file.getOriginalFilename()).thenReturn("demo.txt");
        when(file.getContentType()).thenReturn("text/plain");
        when(fileService.createFile(any(), any(), any(), any())).thenReturn("/files/demo.txt");
        FileUploadReqVO reqVO = new FileUploadReqVO();
        reqVO.setFile(file);

        CommonResult<String> result = controller.uploadFile(reqVO);

        assertThat(result.getData()).isEqualTo("/files/demo.txt");
        verify(fileService).createFile(content, "demo.txt", null, "text/plain");
    }

    /** 验证公开下载拒绝解码后的父目录片段，且不会把该路径交给对象存储。 */
    @Test
    void getFileContentRejectsParentPathWithoutReadingStorage() throws Exception {
        FileService fileService = mock(FileService.class);
        FileController controller = new FileController();
        ReflectionTestUtils.setField(controller, "fileService", fileService);
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse response = mock(HttpServletResponse.class);
        when(request.getRequestURI()).thenReturn("/admin-api/infra/file/content/2026/%2e%2e/secret");

        controller.getFileContent(request, response);

        verify(response).setStatus(HttpStatus.NOT_FOUND.value());
        verify(fileService, never()).openFileContent(any());
    }

    /** 验证流式完整下载会输出 Content-Length 与 Accept-Ranges: bytes 响应头。 */
    @Test
    void getFileContentSetsContentLengthAndAcceptRangesOnFullDownload() throws Exception {
        FileService fileService = mock(FileService.class);
        FileController controller = new FileController();
        ReflectionTestUtils.setField(controller, "fileService", fileService);
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getRequestURI()).thenReturn("/admin-api/infra/file/content/20261119/clip.mp4");
        byte[] data = "0123456789".getBytes(StandardCharsets.UTF_8);
        when(fileService.openFileContent("20261119/clip.mp4"))
                .thenReturn(new FileContentStream(new ByteArrayInputStream(data), 10L));
        MockHttpServletResponse response = new MockHttpServletResponse();

        controller.getFileContent(request, response);

        assertThat(response.getStatus()).isEqualTo(HttpStatus.OK.value());
        assertThat(response.getHeader("Accept-Ranges")).isEqualTo("bytes");
        assertThat(response.getContentLengthLong()).isEqualTo(10L);
        assertThat(response.getContentAsByteArray()).isEqualTo(data);
    }

    /** 验证单段 Range 请求返回 206 部分内容，越界 Range 返回 416 及总长度提示。 */
    @Test
    void getFileContentSupportsSingleRangeAndRejectsOutOfBoundsRange() throws Exception {
        FileService fileService = mock(FileService.class);
        FileController controller = new FileController();
        ReflectionTestUtils.setField(controller, "fileService", fileService);
        byte[] data = "0123456789".getBytes(StandardCharsets.UTF_8);

        HttpServletRequest partialReq = mock(HttpServletRequest.class);
        when(partialReq.getRequestURI()).thenReturn("/admin-api/infra/file/content/20261119/clip.mp4");
        when(partialReq.getHeader("Range")).thenReturn("bytes=2-5");
        when(fileService.openFileContent("20261119/clip.mp4"))
                .thenReturn(new FileContentStream(new ByteArrayInputStream(data), 10L))
                .thenReturn(new FileContentStream(new ByteArrayInputStream(data), 10L));

        MockHttpServletResponse partialResp = new MockHttpServletResponse();
        controller.getFileContent(partialReq, partialResp);
        assertThat(partialResp.getStatus()).isEqualTo(HttpStatus.PARTIAL_CONTENT.value());
        assertThat(partialResp.getHeader("Content-Range")).isEqualTo("bytes 2-5/10");
        assertThat(partialResp.getContentLengthLong()).isEqualTo(4L);
        assertThat(partialResp.getContentAsString()).isEqualTo("2345");

        HttpServletRequest badReq = mock(HttpServletRequest.class);
        when(badReq.getRequestURI()).thenReturn("/admin-api/infra/file/content/20261119/clip.mp4");
        when(badReq.getHeader("Range")).thenReturn("bytes=50-60");
        MockHttpServletResponse badResp = new MockHttpServletResponse();
        controller.getFileContent(badReq, badResp);
        assertThat(badResp.getStatus()).isEqualTo(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE.value());
        assertThat(badResp.getHeader("Content-Range")).isEqualTo("bytes */10");
        assertThat(badResp.getContentAsByteArray()).isEmpty();
    }

    /** 验证公开下载接口拦截私有附件返回 403，且私有下载与限时预签名接口正常委托服务层授权。 */
    @Test
    void publicEndpointRejectsPrivatePathAndPrivateEndpointsDelegateToFileService() throws Exception {
        FileService fileService = mock(FileService.class);
        FileController controller = new FileController();
        ReflectionTestUtils.setField(controller, "fileService", fileService);

        HttpServletRequest publicReq = mock(HttpServletRequest.class);
        HttpServletResponse publicResp = mock(HttpServletResponse.class);
        when(publicReq.getRequestURI()).thenReturn("/admin-api/infra/file/content/private/2026/a.pdf");
        when(fileService.isPrivateObject("private/2026/a.pdf")).thenReturn(true);
        controller.getFileContent(publicReq, publicResp);
        verify(publicResp).setStatus(HttpStatus.FORBIDDEN.value());
        verify(fileService, never()).openFileContent(any());

        when(fileService.presignPrivateGetUrl(7L, 600)).thenReturn("https://signed.local/7");
        assertThat(controller.getPrivateFilePresignedUrl(7L, 600).getData()).isEqualTo("https://signed.local/7");

        FileDO fileDO = new FileDO();
        fileDO.setId(7L);
        fileDO.setPath("private/2026/a.txt");
        when(fileService.getAuthorizedPrivateFile(7L)).thenReturn(fileDO);
        byte[] data = "secret-doc".getBytes(StandardCharsets.UTF_8);
        when(fileService.openAuthorizedPrivateFileContent(fileDO))
                .thenReturn(new FileContentStream(new ByteArrayInputStream(data), (long) data.length));
        MockHttpServletResponse privateResp = new MockHttpServletResponse();
        controller.getPrivateFileContent(7L, mock(HttpServletRequest.class), privateResp);
        assertThat(privateResp.getStatus()).isEqualTo(HttpStatus.OK.value());
        assertThat(privateResp.getContentAsByteArray()).isEqualTo(data);
        verify(fileService, never()).openPrivateFileContent(7L);

        HttpServletRequest emptyReq = mock(HttpServletRequest.class);
        MockHttpServletResponse emptyResp = new MockHttpServletResponse();
        when(emptyReq.getRequestURI()).thenReturn("/admin-api/infra/file/content/");
        controller.getFileContent(emptyReq, emptyResp);
        assertThat(emptyResp.getStatus()).isEqualTo(HttpStatus.NOT_FOUND.value());
    }

}
