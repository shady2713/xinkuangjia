package com.basicframework.module.infra.controller.admin.file;

import com.basicframework.module.infra.controller.admin.file.vo.file.FileUploadReqVO;
import com.basicframework.module.infra.service.file.FileService;
import com.basicframework.module.infra.framework.file.config.FileUploadProperties;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证上传请求流在正常读取及读取失败时都被关闭。
 *
 * @author OpenAI Codex
 */
class FileControllerTest {

    /** 请求读取完成后关闭流，服务持有的是独立字节数组。 */
    @Test
    void uploadClosesInputStreamBeforeDelegating() throws Exception {
        InputStream input = spy(new ByteArrayInputStream(new byte[] {1, 2, 3}));
        FileService service = mock(FileService.class);
        when(service.createFile(any(byte[].class), any(), any(), any())).thenReturn("/file/result");
        FileController controller = controller(service);

        assertThat(controller.uploadFile(request(input)).getData()).isEqualTo("/file/result");

        verify(input).close();
    }

    /** 读取异常时关闭请求资源且不继续上传任何不完整内容。 */
    @Test
    void failedReadClosesInputStreamAndDoesNotUpload() throws Exception {
        AtomicBoolean closed = new AtomicBoolean();
        InputStream input = new InputStream() {
            /** 模拟请求体传输中断。 */
            @Override
            public int read() throws IOException {
                throw new IOException("测试请求体中断");
            }

            /** 记录失败路径是否确实回收了流。 */
            @Override
            public void close() {
                closed.set(true);
            }
        };
        FileService service = mock(FileService.class);
        FileController controller = controller(service);
        FileUploadReqVO request = request(input);

        assertThatThrownBy(() -> controller.uploadFile(request)).isInstanceOf(Exception.class);

        assertThat(closed).isTrue();
        verifyNoInteractions(service);
    }

    /** multipart 元数据虚报较小大小时，实际流仍受读取上限保护。 */
    @Test
    void actualStreamCannotExceedLimitEvenIfDeclaredSizeIsSmaller() throws Exception {
        FileService service = mock(FileService.class);
        FileController controller = controller(service);
        FileUploadProperties limits = new FileUploadProperties();
        limits.setMaxBytes(2);
        ReflectionTestUtils.setField(controller, "uploadLimits", limits);
        InputStream input = spy(new ByteArrayInputStream(new byte[] {1, 2, 3}));
        assertThatThrownBy(() -> controller.uploadFile(request(input))).isInstanceOf(RuntimeException.class);
        verify(input).close();
        verifyNoInteractions(service);
    }

    /** 注入独立文件服务，测试只观察 Controller 的资源生命周期。 */
    private FileController controller(FileService service) {
        FileController controller = new FileController();
        ReflectionTestUtils.setField(controller, "fileService", service);
        ReflectionTestUtils.setField(controller, "uploadLimits", new FileUploadProperties());
        return controller;
    }

    /** 构造携带指定真实输入流的 multipart 请求。 */
    private FileUploadReqVO request(InputStream input) throws IOException {
        MultipartFile part = mock(MultipartFile.class);
        when(part.getInputStream()).thenReturn(input);
        FileUploadReqVO request = new FileUploadReqVO();
        request.setFile(part);
        return request;
    }
}
