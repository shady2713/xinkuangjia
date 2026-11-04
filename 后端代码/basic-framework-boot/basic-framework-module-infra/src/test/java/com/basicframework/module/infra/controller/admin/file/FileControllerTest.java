package com.basicframework.module.infra.controller.admin.file;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.module.infra.controller.admin.file.vo.file.FileUploadReqVO;
import com.basicframework.module.infra.service.file.FileService;
import org.junit.jupiter.api.Test;
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

}
