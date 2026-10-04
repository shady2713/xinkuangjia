package com.basicframework.module.infra.api.file;

import com.basicframework.module.infra.service.file.FileService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证文件跨模块 API 的转发契约。
 *
 * <p>该实现类只做转发，因此契约集中在三点：文件内容、名称、目录与 MIME 必须原样传给文件服务
 * （元数据被改写会让对象存储中的文件与数据库记录不一致）；文件服务的返回值必须原样透出
 * （调用方按返回路径拼接访问地址）；失败必须原样传播（上传失败要按业务错误码返回，
 * 不能被包装成成功或通用错误）。</p>
 *
 * <p>可空参数（名称、目录、MIME、有效期）允许为 null，实现不得自行补默认值——
 * 目录与类型由文件服务按自身规则推导，提前填充会改变真实存储路径。</p>
 *
 * @author shady2713
 */
class FileApiImplTest {

    /** 被测 API 实现。 */
    private FileApiImpl fileApi;
    /** 下游文件服务替身，用于观察真实转发参数。 */
    private FileService fileService;

    /** 为每个用例创建独立 API 与下游替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        fileApi = new FileApiImpl();
        fileService = mock(FileService.class);
        ReflectionTestUtils.setField(fileApi, "fileService", fileService);
    }

    /** 创建文件必须把内容与全部元数据原样交给文件服务，并返回其真实访问路径。 */
    @Test
    void createFileDelegatesContentAndMetadataUnchanged() {
        byte[] content = "synthetic-content".getBytes(StandardCharsets.UTF_8);
        when(fileService.createFile(any(), anyString(), anyString(), anyString()))
                .thenReturn("https://files.example.test/notes/2026/10/note.txt");

        String url = fileApi.createFile(content, "note.txt", "notes", "text/plain");

        ArgumentCaptor<byte[]> contentCaptor = ArgumentCaptor.forClass(byte[].class);
        ArgumentCaptor<String> nameCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> directoryCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> typeCaptor = ArgumentCaptor.forClass(String.class);
        verify(fileService).createFile(contentCaptor.capture(), nameCaptor.capture(),
                directoryCaptor.capture(), typeCaptor.capture());
        assertThat(contentCaptor.getValue()).isEqualTo(content);
        assertThat(nameCaptor.getValue()).isEqualTo("note.txt");
        assertThat(directoryCaptor.getValue()).isEqualTo("notes");
        assertThat(typeCaptor.getValue()).isEqualTo("text/plain");
        assertThat(url).as("必须返回文件服务给出的真实访问路径").isEqualTo(
                "https://files.example.test/notes/2026/10/note.txt");
        verifyNoMoreInteractions(fileService);
    }

    /** 可空元数据必须原样传 null，由文件服务按自身规则推导，实现不得补默认值。 */
    @Test
    void createFilePassesNullMetadataThrough() {
        byte[] content = "synthetic-content".getBytes(StandardCharsets.UTF_8);
        when(fileService.createFile(any(), any(), any(), any())).thenReturn("path");

        fileApi.createFile(content, null, null, null);

        verify(fileService).createFile(any(byte[].class), org.mockito.ArgumentMatchers.isNull(),
                org.mockito.ArgumentMatchers.isNull(), org.mockito.ArgumentMatchers.isNull());
    }

    /** 生成预签名地址必须原样转发完整地址与有效期，并返回文件服务的签名结果。 */
    @Test
    void presignGetUrlDelegatesUrlAndExpiration() {
        when(fileService.presignGetUrl(anyString(), anyInt())).thenReturn("https://signed.example.test/x");

        String signed = fileApi.presignGetUrl("https://files.example.test/a/b.png", 600);

        verify(fileService).presignGetUrl("https://files.example.test/a/b.png", 600);
        assertThat(signed).isEqualTo("https://signed.example.test/x");
        verifyNoMoreInteractions(fileService);
    }

    /** 有效期允许为 null，表示由文件服务使用自身默认有效期。 */
    @Test
    void presignGetUrlPassesNullExpirationThrough() {
        when(fileService.presignGetUrl(anyString(), org.mockito.ArgumentMatchers.isNull())).thenReturn("signed");

        assertThat(fileApi.presignGetUrl("https://files.example.test/a/b.png", null)).isEqualTo("signed");

        verify(fileService).presignGetUrl("https://files.example.test/a/b.png", null);
    }

    /**
     * 文件服务失败必须原样传播，不能被包装或吞掉。
     *
     * <p>调用方依赖文件服务抛出的业务错误码区分“内容为空”“类型不允许”和“存储不可用”，
     * 包装异常会让上层只能返回通用失败。</p>
     */
    @Test
    void serviceFailurePropagatesUnchanged() {
        IllegalStateException failure = new IllegalStateException("synthetic-storage-failure");
        doThrow(failure).when(fileService).createFile(any(), any(), any(), any());

        assertThatThrownBy(() -> fileApi.createFile("x".getBytes(StandardCharsets.UTF_8), "n", "d", "t"))
                .isSameAs(failure);
    }

    /** 生成预签名地址失败时同样原样传播，不得返回未签名的原始地址冒充成功。 */
    @Test
    void presignFailurePropagatesUnchanged() {
        IllegalStateException failure = new IllegalStateException("synthetic-presign-failure");
        doThrow(failure).when(fileService).presignGetUrl(anyString(), any());

        assertThatThrownBy(() -> fileApi.presignGetUrl("https://files.example.test/a/b.png", 60))
                .isSameAs(failure);
    }
}
