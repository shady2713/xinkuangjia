package com.basicframework.module.infra.api.file;

import com.basicframework.module.infra.service.file.FileStorageService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证对象存储跨模块 API 只做契约转换：原样转发参数、原样返回结果、原样传播失败。
 *
 * <p>该实现是其它模块访问文件存储的唯一入口，参数或返回值一旦被改写（例如补前缀、
 * 吞掉删除数量、把异常包成业务异常），调用方拿到的地址、内容或删除结果就会与真实存储
 * 不一致。因此这里逐方法核对入参与返回值，并确认存储层失败会向外抛出而不是被吞掉。</p>
 *
 * @author shady2713
 */
class FileStorageApiImplTest {

    /** 被测 API 实现，存储服务按外部边界替换为可观察替身。 */
    private FileStorageApiImpl fileStorageApi;
    /** 记录调用参数的存储服务替身。 */
    private FileStorageService fileStorageService;

    /** 为每个用例创建独立 API 与存储替身，避免用例之间共享调用记录。 */
    @BeforeEach
    void setUp() {
        fileStorageApi = new FileStorageApiImpl();
        fileStorageService = mock(FileStorageService.class);
        ReflectionTestUtils.setField(fileStorageApi, "fileStorageService", fileStorageService);
    }

    /** 上传必须按原路径与原内容类型转发，并返回存储层给出的访问地址。 */
    @Test
    void uploadForwardsArgumentsAndReturnsUrl() throws Exception {
        byte[] content = "file-content".getBytes(StandardCharsets.UTF_8);
        when(fileStorageService.upload(content, "upload/2026/a.txt", "text/plain"))
                .thenReturn("http://minio/upload/2026/a.txt");

        assertThat(fileStorageApi.upload(content, "upload/2026/a.txt", "text/plain"))
                .isEqualTo("http://minio/upload/2026/a.txt");
        verify(fileStorageService).upload(content, "upload/2026/a.txt", "text/plain");
    }

    /** 读取内容必须返回存储层的真实字节，不做编码或裁剪。 */
    @Test
    void getContentReturnsStoredBytes() throws Exception {
        byte[] content = new byte[]{1, 2, 3};
        when(fileStorageService.getContent("upload/2026/a.bin")).thenReturn(content);

        assertThat(fileStorageApi.getContent("upload/2026/a.bin")).isEqualTo(content);
    }

    /** 复制必须转发来源、目标与内容类型，并返回目标地址。 */
    @Test
    void copyForwardsPathsAndReturnsTargetUrl() throws Exception {
        when(fileStorageService.copy("upload/a.txt", "upload/b.txt", "text/plain"))
                .thenReturn("http://minio/upload/b.txt");

        assertThat(fileStorageApi.copy("upload/a.txt", "upload/b.txt", "text/plain"))
                .isEqualTo("http://minio/upload/b.txt");
    }

    /** 目录列举必须返回存储层的下一级前缀列表，包含空列表语义。 */
    @Test
    void listPrefixesReturnsServiceResult() throws Exception {
        when(fileStorageService.listPrefixes("upload/", "/")).thenReturn(List.of("upload/2026/", "upload/tmp/"));
        when(fileStorageService.listPrefixes("empty/", "/")).thenReturn(List.of());

        assertThat(fileStorageApi.listPrefixes("upload/", "/"))
                .containsExactly("upload/2026/", "upload/tmp/");
        assertThat(fileStorageApi.listPrefixes("empty/", "/")).as("空目录返回空列表而不是 null").isEmpty();
    }

    /** 前缀删除必须返回真实删除数量，0 与正数都要如实传递。 */
    @Test
    void deletePrefixReturnsDeletedCount() throws Exception {
        when(fileStorageService.deletePrefix("upload/tmp/")).thenReturn(5);
        when(fileStorageService.deletePrefix("upload/none/")).thenReturn(0);

        assertThat(fileStorageApi.deletePrefix("upload/tmp/")).isEqualTo(5);
        assertThat(fileStorageApi.deletePrefix("upload/none/")).isZero();
    }

    /** 存储层失败必须向外抛出，调用方才能感知并决定重试或补偿。 */
    @Test
    void storageFailurePropagates() throws Exception {
        when(fileStorageService.getContent("upload/missing.txt"))
                .thenThrow(new IllegalStateException("对象不存在"));

        assertThatThrownBy(() -> fileStorageApi.getContent("upload/missing.txt"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("对象不存在");
    }
}
