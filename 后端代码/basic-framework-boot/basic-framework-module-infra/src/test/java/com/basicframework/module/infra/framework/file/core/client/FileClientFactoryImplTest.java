package com.basicframework.module.infra.framework.file.core.client;

import com.basicframework.module.infra.framework.file.core.client.s3.S3FileClient;
import com.basicframework.module.infra.framework.file.core.client.s3.S3FileClientConfig;
import com.basicframework.module.infra.framework.file.core.enums.FileStorageEnum;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证进程内文件客户端工厂的创建、复用与未知标识行为。
 *
 * <p>工厂按配置编号缓存客户端：同一编号必须复用同一实例（重复创建会让每个请求各持一套连接资源），
 * 配置变化必须就地刷新既有实例，未登记的编号必须返回 null 让上层走“存储不可用”分支，
 * 未支持的存储类型必须显式失败而不是返回空客户端。</p>
 *
 * @author shady2713
 */
class FileClientFactoryImplTest {

    /** 被测工厂，每个用例独占实例，避免共享缓存。 */
    private final FileClientFactoryImpl factory = new FileClientFactoryImpl();

    /** 未登记的编号必须返回 null，调用方据此判定客户端不存在。 */
    @Test
    void unknownClientReturnsNull() {
        assertThat(factory.getFileClient(404L)).isNull();
    }

    /** 首次登记时按存储类型创建并初始化客户端，之后按同一编号取到同一实例。 */
    @Test
    void createInitializesClientAndReusesInstance() {
        factory.createOrUpdateFileClient(1L, FileStorageEnum.S3.getStorage(), config("bucket-a"));

        FileClient client = factory.getFileClient(1L);

        assertThat(client).isInstanceOf(S3FileClient.class);
        assertThat(client.getId()).isEqualTo(1L);
        assertThat(factory.getFileClient(1L)).as("同一编号必须复用同一实例").isSameAs(client);
    }

    /**
     * 同一编号的配置变化必须就地刷新既有实例，而不是新建客户端。
     *
     * <p>新建会让并发初始化时的旧实例失去引用却仍持有 SDK 连接资源；
     * 这里同时确认新配置确实被应用（初始化会补全空的 domain）。</p>
     */
    @Test
    void updateRefreshesExistingInstanceInPlace() {
        factory.createOrUpdateFileClient(2L, FileStorageEnum.S3.getStorage(), config("bucket-a"));
        FileClient created = factory.getFileClient(2L);
        S3FileClientConfig updated = config("bucket-b");
        assertThat(updated.getDomain()).as("刷新前的配置应保持未初始化状态").isNull();

        factory.createOrUpdateFileClient(2L, FileStorageEnum.S3.getStorage(), updated);

        assertThat(factory.getFileClient(2L)).as("配置变化必须刷新原实例，不得替换实例").isSameAs(created);
        assertThat(updated.getDomain()).as("刷新必须对新配置执行初始化").isEqualTo("https://minio.example.test/bucket-b");
    }

    /** 未支持的存储类型必须显式失败，不得返回无法工作的空客户端。 */
    @Test
    void unsupportedStorageFails() {
        assertThatThrownBy(() -> factory.createOrUpdateFileClient(3L, 999, config("bucket-a")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("999");
        assertThat(factory.getFileClient(3L)).as("失败后不得留下半成品客户端").isNull();
    }

    /**
     * 构造最小可用的 S3 客户端配置。
     *
     * @param bucket 存储桶，用于区分不同配置
     * @return 未设置 domain 的 S3 配置
     */
    private S3FileClientConfig config(String bucket) {
        S3FileClientConfig config = new S3FileClientConfig();
        config.setEndpoint("https://minio.example.test");
        config.setBucket(bucket);
        config.setAccessKey("access-key");
        config.setAccessSecret("secret-key");
        config.setEnablePathStyleAccess(true);
        config.setEnablePublicAccess(true);
        config.setRegion("us-east-1");
        return config;
    }

}
