package com.basicframework.module.infra.service.file;

import com.basicframework.module.infra.framework.file.config.MinioFileProperties;
import com.basicframework.module.infra.framework.file.core.client.FileClient;
import com.basicframework.module.infra.framework.file.core.client.FileClientFactory;
import com.basicframework.module.infra.framework.file.core.client.FileObjectPage;
import com.basicframework.module.infra.framework.file.core.enums.FileStorageEnum;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证环境变量驱动的唯一 MinIO 存储服务的初始化与委托契约。
 *
 * <p>该服务是存储访问的唯一入口：它按固定标识创建客户端，并把列举、复制、目录查询与
 * 前缀删除逐项委托给客户端。委托一旦漏参（例如复制时丢掉目标路径、列举时丢掉游标），
 * 调用方会拿到错误的桶视图或把对象复制到错误位置；初始化拿不到客户端时若继续运行，
 * 后续每个请求都会以空指针失败，因此必须在这里显式失败阻止应用带错误配置启动。</p>
 *
 * <p>销毁路径同样需要锁定： Bean 销毁时若客户端尚未初始化就调用关闭，会让容器关闭阶段
 * 抛错；已初始化时则必须恰好关闭一次，否则 SDK 连接资源泄漏。</p>
 *
 * @author shady2713
 */
class FileStorageServiceImplTest {

    /** 服务内部使用的唯一客户端标识，与实现常量一致。 */
    private static final Long MINIO_CLIENT_ID = 1L;

    /** 下游客户端工厂替身，用于观察创建参数并按标识返回客户端。 */
    private FileClientFactory fileClientFactory;
    /** 存储客户端替身，用于观察逐项委托的真实参数与返回透传。 */
    private FileClient fileClient;
    /** 环境配置，仅用于触发客户端配置转换。 */
    private MinioFileProperties properties;
    /** 被测服务，每个用例独占实例，避免共享客户端状态。 */
    private FileStorageServiceImpl service;

    /** 为每个用例创建独立替身与配置，并完成真实初始化路径。 */
    @BeforeEach
    void setUp() {
        fileClientFactory = mock(FileClientFactory.class);
        fileClient = mock(FileClient.class);
        properties = minioProperties();
        when(fileClientFactory.getFileClient(MINIO_CLIENT_ID)).thenReturn(fileClient);
        service = new FileStorageServiceImpl(fileClientFactory, properties);
        service.initializeFileClient();
    }

    /**
     * 初始化必须按固定标识与 S3 类型创建客户端，并把环境配置转换为客户端配置。
     *
     * <p>标识与类型是运行期定位客户端的唯一依据；写错会让列举与上传访问到不同客户端。</p>
     */
    @Test
    void initializeFileClientCreatesClientWithFixedIdentity() {
        verify(fileClientFactory).createOrUpdateFileClient(eq(MINIO_CLIENT_ID),
                eq(FileStorageEnum.S3.getStorage()), any());
        verify(fileClientFactory).getFileClient(MINIO_CLIENT_ID);
        verifyNoMoreInteractions(fileClientFactory);
    }

    /** 初始化拿不到客户端时必须显式失败，不得静默留下空客户端。 */
    @Test
    void initializeFileClientFailsWhenClientMissing() {
        when(fileClientFactory.getFileClient(MINIO_CLIENT_ID)).thenReturn(null);

        assertThatThrownBy(() -> service.initializeFileClient())
                .isInstanceOf(NullPointerException.class)
                .hasMessageContaining("MinIO 文件客户端初始化失败");
    }

    /** 对象列举必须原样转发游标并返回同一页结果。 */
    @Test
    void listObjectsForwardsCursorAndReturnsPage() {
        FileObjectPage page = new FileObjectPage(
                List.of(new FileObjectPage.Entry("profile/avatar.png", 128L)), "synthetic-next-token");
        when(fileClient.listObjects("synthetic-cursor")).thenReturn(page);

        assertThat(service.listObjects("synthetic-cursor")).isSameAs(page);

        verify(fileClient).listObjects("synthetic-cursor");
        verifyNoMoreInteractions(fileClient);
    }

    /** 对象列举的首页游标为 null，必须原样转发而不是被替换成空串。 */
    @Test
    void listObjectsForwardsNullCursor() {
        FileObjectPage page = new FileObjectPage(List.of(), null);
        when(fileClient.listObjects(null)).thenReturn(page);

        assertThat(service.listObjects(null)).isSameAs(page);

        verify(fileClient).listObjects(null);
    }

    /** 服务端复制必须转发来源、目标与类型三个参数，并返回客户端给出的地址。 */
    @Test
    void copyForwardsAllArgumentsAndReturnsUrl() throws Exception {
        when(fileClient.copy("source/note.txt", "target/note.txt", "text/plain"))
                .thenReturn("https://storage.example.test/target/note.txt");

        assertThat(service.copy("source/note.txt", "target/note.txt", "text/plain"))
                .isEqualTo("https://storage.example.test/target/note.txt");

        verify(fileClient).copy("source/note.txt", "target/note.txt", "text/plain");
        verifyNoMoreInteractions(fileClient);
    }

    /** 目录前缀查询必须转发前缀与分隔符，并原样返回客户端顺序。 */
    @Test
    void listPrefixesForwardsPrefixAndDelimiter() throws Exception {
        List<String> prefixes = List.of("profile/2026/", "profile/2025/");
        when(fileClient.listPrefixes("profile/", "/")).thenReturn(prefixes);

        assertThat(service.listPrefixes("profile/", "/")).isSameAs(prefixes);

        verify(fileClient).listPrefixes("profile/", "/");
        verifyNoMoreInteractions(fileClient);
    }

    /** 前缀删除必须转发前缀并返回真实删除数量。 */
    @Test
    void deletePrefixForwardsPrefixAndReturnsCount() throws Exception {
        when(fileClient.deletePrefix("profile/")).thenReturn(3);

        assertThat(service.deletePrefix("profile/")).isEqualTo(3);

        verify(fileClient).deletePrefix("profile/");
        verifyNoMoreInteractions(fileClient);
    }

    /** 客户端抛出的失败必须原样传播，不得被包装成"空结果"掩盖存储故障。 */
    @Test
    void clientFailuresPropagateUnchanged() throws Exception {
        IOException failure = new IOException("synthetic-storage-failure");
        when(fileClient.listPrefixes("profile/", "/")).thenThrow(failure);

        assertThatThrownBy(() -> service.listPrefixes("profile/", "/")).isSameAs(failure);
    }

    /** 销毁前尚未初始化完成的 Bean 关闭时必须无操作，不得抛空指针。 */
    @Test
    void closeFileClientWithoutInitializedClientIsNoOp() {
        FileStorageServiceImpl notInitialized =
                new FileStorageServiceImpl(fileClientFactory, properties);

        notInitialized.closeFileClient();

        verify(fileClient, never()).close();
    }

    /** 已初始化的 Bean 销毁时必须恰好关闭一次客户端，释放 SDK 连接资源。 */
    @Test
    void closeFileClientClosesInitializedClientOnce() {
        service.closeFileClient();

        verify(fileClient).close();
        verifyNoMoreInteractions(fileClient);
    }

    /**
     * 构造带合成凭据的环境配置，覆盖客户端配置转换所需的全部必填字段。
     *
     * @return 指向环回地址的合成 MinIO 配置
     */
    private static MinioFileProperties minioProperties() {
        MinioFileProperties properties = new MinioFileProperties();
        properties.setEndpoint("http://127.0.0.1:9000");
        properties.setPublicUrl("http://127.0.0.1:9000");
        properties.setBucket("bf-test-bucket");
        properties.setRegion("us-east-1");
        properties.setAccessKey("synthetic-access-key");
        properties.setSecretKey("synthetic-secret-key");
        return properties;
    }
}
