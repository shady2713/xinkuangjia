package com.basicframework.module.infra.framework.file.config;

import com.basicframework.module.infra.framework.file.core.client.s3.S3FileClientConfig;
import jakarta.validation.constraints.AssertTrue;
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
     * 存储桶默认是否作为公开资源访问。
     *
     * <p>保持默认 {@code true} 以兼容既有公开资源部署；设为 {@code false} 时全部对象均按私有附件处理，
     * 禁止匿名读取且仅通过受控临时预签名地址或已授权私有下载入口访问。</p>
     */
    private boolean publicAccess = true;

    /**
     * 仅用于预签名的 HTTP(S) 站点根地址。
     *
     * <p>留空时沿用公开 URL 推导。网关必须保留请求的 Host 和桶路径，供 MinIO 验签。</p>
     */
    private String signingEndpoint;

    /**
     * 校验可选的签名配置是否为 HTTP(S) 站点根地址。
     *
     * @return 未配置或配置合法时返回 true
     */
    @AssertTrue(message = "MinIO signing-endpoint must be a root HTTP(S) origin")
    public boolean isSigningEndpointValid() {
        return signingEndpoint == null || signingEndpoint.isBlank() || S3FileClientConfig.isRootHttpOrigin(signingEndpoint);
    }

    /**
     * 缺少显式签名地址时，公开 URL 只允许根地址或仅含桶名的路径。
     * 网关挂载路径必须另设签名根地址，确保浏览器发送的路径与签名一致。
     *
     * @return 配置允许生成可用的签名链接时返回 true
     */
    @AssertTrue(message = "MinIO public-url below the root (e.g. /files) requires signing-endpoint")
    public boolean isPublicUrlSignable() {
        // Blank values are reported by @NotBlank.
        if ((signingEndpoint != null && !signingEndpoint.isBlank())
                || publicUrl == null || publicUrl.isBlank() || bucket == null || bucket.isBlank()) {
            return true;
        }
        String base = trimTrailingSlash(publicUrl.trim());
        String bucketSuffix = "/" + bucket.trim();
        if (base.endsWith(bucketSuffix)) {
            base = base.substring(0, base.length() - bucketSuffix.length());
        }
        return S3FileClientConfig.isRootHttpOrigin(base);
    }

    /**
     * 生成 S3 客户端配置。
     *
     * <p>MinIO 固定使用 Path-Style；公开访问开关由 {@link #publicAccess} 决定。</p>
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
        clientConfig.setEnablePublicAccess(publicAccess);
        clientConfig.setRegion(region.trim());
        clientConfig.setSigningEndpoint(resolveSigningEndpoint());
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
     * 规范化可选的签名地址，便于 SDK 拼接桶路径。
     *
     * @return 去掉末尾斜线的根地址，未配置时为 {@code null}
     */
    private String resolveSigningEndpoint() {
        if (signingEndpoint == null || signingEndpoint.isBlank()) {
            return null;
        }
        return trimTrailingSlash(signingEndpoint.trim());
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
