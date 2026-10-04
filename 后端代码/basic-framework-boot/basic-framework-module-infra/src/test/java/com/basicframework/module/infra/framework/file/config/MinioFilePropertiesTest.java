package com.basicframework.module.infra.framework.file.config;

import com.basicframework.module.infra.framework.file.core.client.s3.S3FileClientConfig;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 {@link MinioFileProperties#toClientConfig()} 生成 S3 客户端配置的口径。
 *
 * <p>该转换把环境变量形式的 MinIO 配置变成进程内文件客户端配置，任何拼接错误都会直接影响
 * 对象存储的访问地址：端点缺协议会让 SDK 拒绝初始化，公开域名重复拼桶名会生成 404 的
 * 访问地址，末尾斜杠会产生双斜杠路径。MinIO 还必须固定 Path-Style 与公开访问，
 * 因为业务对外提供的是无时效的对象地址。</p>
 *
 * @author shady2713
 */
class MinioFilePropertiesTest {

    /** 端点未声明协议且 secure=false 时补 http，避免 SDK 因缺少协议初始化失败。 */
    @Test
    void endpointWithoutSchemeUsesHttpWhenNotSecure() {
        S3FileClientConfig config = properties("minio.example.test:9000", false).toClientConfig();

        assertThat(config.getEndpoint()).isEqualTo("http://minio.example.test:9000");
    }

    /** 端点未声明协议且 secure=true 时补 https，用于只允许加密访问的部署。 */
    @Test
    void endpointWithoutSchemeUsesHttpsWhenSecure() {
        S3FileClientConfig config = properties("minio.example.test:9000", true).toClientConfig();

        assertThat(config.getEndpoint()).isEqualTo("https://minio.example.test:9000");
    }

    /**
     * 端点已声明协议时必须保持原样（含大小写与端口），secure 开关不得二次拼接。
     *
     * <p>环境变量里显式写出的协议代表部署事实，按 secure 覆盖会连到错误的协议上。</p>
     */
    @Test
    void explicitSchemeIsKeptRegardlessOfSecureFlag() {
        assertThat(properties("HTTP://minio.example.test:9000", true).toClientConfig().getEndpoint())
                .isEqualTo("HTTP://minio.example.test:9000");
        assertThat(properties("https://minio.example.test", false).toClientConfig().getEndpoint())
                .isEqualTo("https://minio.example.test");
    }

    /** public-url 已包含桶名时不得重复拼接，否则生成的对象地址会多一级路径。 */
    @Test
    void publicDomainDoesNotRepeatExistingBucketSuffix() {
        MinioFileProperties properties = properties("https://minio.example.test", false);
        properties.setPublicUrl("https://cdn.example.test/files");
        properties.setBucket("files");

        assertThat(properties.toClientConfig().getDomain()).isEqualTo("https://cdn.example.test/files");
    }

    /** public-url 未包含桶名时追加桶路径，保证公开地址直接指向桶内对象。 */
    @Test
    void publicDomainAppendsBucketWhenMissing() {
        MinioFileProperties properties = properties("https://minio.example.test", false);
        properties.setPublicUrl("https://cdn.example.test/static");
        properties.setBucket("uploads");

        assertThat(properties.toClientConfig().getDomain()).isEqualTo("https://cdn.example.test/static/uploads");
    }

    /** 端点与公开地址末尾的斜杠必须全部去掉，避免后续拼接产生双斜杠。 */
    @Test
    void trailingSlashesAreTrimmed() {
        MinioFileProperties properties = properties("minio.example.test:9000//", false);
        properties.setPublicUrl("https://cdn.example.test/static//");

        S3FileClientConfig config = properties.toClientConfig();

        assertThat(config.getEndpoint()).isEqualTo("http://minio.example.test:9000");
        assertThat(config.getDomain()).isEqualTo("https://cdn.example.test/static/files");
    }

    /**
     * MinIO 固定启用 Path-Style 与公开访问，并去除桶名、密钥与区域的多余空白。
     *
     * <p>Path-Style 是 MinIO 的既有接入约定；公开访问对应“对象地址无时效”的业务约束。
     * 环境变量常带不可见空白，未去除会让桶名与签名校验失败。</p>
     */
    @Test
    void minioConventionsAndTrimmedFieldsAreApplied() {
        MinioFileProperties properties = properties("https://minio.example.test", false);
        properties.setBucket(" files ");
        properties.setAccessKey(" access-key ");
        properties.setSecretKey(" secret-key ");
        properties.setRegion(" us-east-1 ");

        S3FileClientConfig config = properties.toClientConfig();

        assertThat(config.getEnablePathStyleAccess()).isTrue();
        assertThat(config.getEnablePublicAccess()).isTrue();
        assertThat(config.getBucket()).isEqualTo("files");
        assertThat(config.getAccessKey()).isEqualTo("access-key");
        assertThat(config.getAccessSecret()).isEqualTo("secret-key");
        assertThat(config.getRegion()).isEqualTo("us-east-1");
    }

    /**
     * 构造启用 Path-Style 与公开访问的 MinIO 配置，桶名默认 files。
     *
     * @param endpoint MinIO 端点，允许不含协议
     * @param secure   未声明协议时是否使用 HTTPS
     * @return 配置实例
     */
    private MinioFileProperties properties(String endpoint, boolean secure) {
        MinioFileProperties properties = new MinioFileProperties();
        properties.setEndpoint(endpoint);
        properties.setSecure(secure);
        properties.setBucket("files");
        properties.setAccessKey("access-key");
        properties.setSecretKey("secret-key");
        properties.setRegion("us-east-1");
        properties.setPublicUrl(endpoint.startsWith("http") ? endpoint : "https://cdn.example.test");
        return properties;
    }

}
