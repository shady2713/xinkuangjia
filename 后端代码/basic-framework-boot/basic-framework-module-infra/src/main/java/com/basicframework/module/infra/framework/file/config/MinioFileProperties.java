package com.basicframework.module.infra.framework.file.config;

import com.basicframework.module.infra.framework.file.core.client.s3.S3FileClientConfig;
import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.validator.constraints.URL;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.util.Locale;

/**
 * MinIO 文件存储配置属性。
 *
 * <p>配置只从受控环境变量绑定，不读取任何数据库配置。</p>
 *
 * @author 李杰
 */
@ConfigurationProperties(prefix = "basic-framework.file.minio")
@Validated
@Getter
@Setter
public class MinioFileProperties {

    /** MinIO SDK 访问端点，可省略 http/https 协议。 */
    @NotBlank(message = "MinIO endpoint 不能为空")
    private String endpoint;

    /** MinIO 业务访问 Key。 */
    @NotBlank(message = "MinIO access-key 不能为空")
    private String accessKey;

    /** MinIO 业务访问 Secret。 */
    @NotBlank(message = "MinIO secret-key 不能为空")
    private String secretKey;

    /** MinIO 存储桶。 */
    @NotBlank(message = "MinIO bucket 不能为空")
    private String bucket;

    /** SDK 是否使用 HTTPS 访问未显式声明协议的端点。 */
    private boolean secure;

    /** MinIO S3 区域。 */
    @NotBlank(message = "MinIO region 不能为空")
    private String region;

    /** 浏览器可长期访问的公开根地址。 */
    @NotBlank(message = "MinIO public-url 不能为空")
    @URL(message = "MinIO public-url 必须是 URL 格式")
    private String publicUrl;

    /**
     * 生成 S3 客户端配置。
     *
     * <p>MinIO 固定使用 Path-Style；根据业务约束固定返回公开、无时效的对象 URL。</p>
     *
     * @return 可供文件客户端初始化的 S3 配置
     */
    public S3FileClientConfig toClientConfig() {
        S3FileClientConfig clientConfig = new S3FileClientConfig();
        clientConfig.setEndpoint(resolveEndpoint());
        clientConfig.setDomain(resolvePublicDomain());
        clientConfig.setBucket(bucket.trim());
        clientConfig.setAccessKey(accessKey.trim());
        clientConfig.setAccessSecret(secretKey.trim());
        clientConfig.setEnablePathStyleAccess(true);
        clientConfig.setEnablePublicAccess(true);
        clientConfig.setRegion(region.trim());
        return clientConfig;
    }

    /**
     * 规范化 SDK 端点；仅在环境变量未声明协议时使用 secure 补齐协议。
     *
     * @return 带协议且不含末尾斜杠的端点
     */
    private String resolveEndpoint() {
        String normalizedEndpoint = trimTrailingSlash(endpoint.trim());
        String lowerCaseEndpoint = normalizedEndpoint.toLowerCase(Locale.ROOT);
        if (lowerCaseEndpoint.startsWith("http://") || lowerCaseEndpoint.startsWith("https://")) {
            return normalizedEndpoint;
        }
        return (secure ? "https://" : "http://") + normalizedEndpoint;
    }

    /**
     * 生成对象公开域名；当 public-url 已包含桶名时避免重复拼接。
     *
     * @return 包含存储桶路径的公开域名
     */
    private String resolvePublicDomain() {
        String normalizedPublicUrl = trimTrailingSlash(publicUrl.trim());
        String normalizedBucket = bucket.trim();
        String bucketSuffix = "/" + normalizedBucket;
        if (normalizedPublicUrl.endsWith(bucketSuffix)) {
            return normalizedPublicUrl;
        }
        return normalizedPublicUrl + bucketSuffix;
    }

    /**
     * 移除地址末尾全部斜杠，避免后续路径拼接产生双斜杠。
     *
     * @param value 待处理地址
     * @return 不含末尾斜杠的地址
     */
    private String trimTrailingSlash(String value) {
        int endIndex = value.length();
        while (endIndex > 0 && value.charAt(endIndex - 1) == '/') {
            endIndex--;
        }
        return value.substring(0, endIndex);
    }

}
