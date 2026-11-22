package com.basicframework.module.infra.framework.file.config;

import cn.hutool.core.util.StrUtil;
import com.basicframework.module.infra.framework.file.core.client.local.LocalFileClientConfig;
import com.basicframework.module.infra.framework.file.core.client.s3.S3FileClientConfig;
import jakarta.validation.constraints.AssertTrue;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.util.Locale;

/**
 * 统一文件存储配置属性，支持阿里云 OSS（生产推荐）与本地磁盘（开发/CI/断网内网兜底）一键切换。
 *
 * @author 李杰
 */
@ConfigurationProperties(prefix = "basic-framework.file")
@Validated
@Getter
@Setter
public class FileStorageProperties {

    public static final String PROVIDER_LOCAL = "local";
    public static final String PROVIDER_ALIYUN_OSS = "aliyun-oss";

    /**
     * 存储提供方：{@code local}（默认，零外部依赖）或 {@code aliyun-oss}。
     */
    private String provider = PROVIDER_LOCAL;

    /**
     * 本地磁盘存储配置。
     */
    private Local local = new Local();

    /**
     * 阿里云 OSS 配置（通过 S3 兼容协议接入）。
     */
    private AliyunOss oss = new AliyunOss();

    /**
     * 判断当前是否启用阿里云 OSS 模式。
     *
     * @return 使用阿里云 OSS 时返回 true
     */
    public boolean isAliyunOss() {
        return PROVIDER_ALIYUN_OSS.equalsIgnoreCase(StrUtil.trim(provider));
    }

    /**
     * 返回当前存储模式下的默认公开访问策略。
     *
     * @return 是否默认公开访问
     */
    public boolean isPublicAccess() {
        return isAliyunOss() ? oss.isPublicAccess() : local.isPublicAccess();
    }

    @AssertTrue(message = "basic-framework.file.provider 仅支持 local 或 aliyun-oss")
    public boolean isProviderValid() {
        String p = StrUtil.trim(provider);
        return PROVIDER_LOCAL.equalsIgnoreCase(p) || PROVIDER_ALIYUN_OSS.equalsIgnoreCase(p);
    }

    @AssertTrue(message = "启用 aliyun-oss 时必须配置 endpoint、access-key、secret-key、bucket 与 public-url")
    public boolean isAliyunOssConfigComplete() {
        if (!isAliyunOss()) {
            return true;
        }
        return StrUtil.isNotBlank(oss.getEndpoint())
                && StrUtil.isNotBlank(oss.getAccessKey())
                && StrUtil.isNotBlank(oss.getSecretKey())
                && StrUtil.isNotBlank(oss.getBucket())
                && StrUtil.isNotBlank(oss.getPublicUrl());
    }

    /**
     * 构造本地磁盘客户端配置。
     *
     * @return 本地文件客户端配置
     */
    public LocalFileClientConfig toLocalClientConfig() {
        LocalFileClientConfig config = new LocalFileClientConfig();
        config.setBasePath(StrUtil.blankToDefault(local.getBasePath(), "./.local-storage"));
        config.setDomain(StrUtil.blankToDefault(local.getDomain(), "/admin-api/infra/file/content"));
        config.setPublicAccess(local.isPublicAccess());
        return config;
    }

    /**
     * 构造阿里云 OSS S3 协议客户端配置（Virtual-Hosted Style）。
     *
     * @return S3 客户端配置
     */
    public S3FileClientConfig toAliyunOssClientConfig() {
        S3FileClientConfig config = new S3FileClientConfig();
        String endpoint = trimTrailingSlash(oss.getEndpoint().trim());
        String lower = endpoint.toLowerCase(Locale.ROOT);
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
            endpoint = "https://" + endpoint;
        }
        config.setEndpoint(endpoint);
        config.setDomain(trimTrailingSlash(oss.getPublicUrl().trim()));
        config.setBucket(oss.getBucket().trim());
        config.setAccessKey(oss.getAccessKey().trim());
        config.setAccessSecret(oss.getSecretKey().trim());
        config.setEnablePathStyleAccess(false);
        config.setEnablePublicAccess(oss.isPublicAccess());
        config.setRegion(StrUtil.blankToDefault(oss.getRegion(), "oss-cn-hangzhou").trim());
        if (StrUtil.isNotBlank(oss.getSigningEndpoint())) {
            config.setSigningEndpoint(trimTrailingSlash(oss.getSigningEndpoint().trim()));
        }
        return config;
    }

    private static String trimTrailingSlash(String value) {
        int end = value.length();
        while (end > 0 && value.charAt(end - 1) == '/') {
            end--;
        }
        return value.substring(0, end);
    }

    @Getter
    @Setter
    public static class Local {

        private String basePath = "./.local-storage";
        private String domain = "/admin-api/infra/file/content";
        private boolean publicAccess = true;
    }

    @Getter
    @Setter
    public static class AliyunOss {

        private String endpoint = "";
        private String accessKey = "";
        private String secretKey = "";
        private String bucket = "";
        private String region = "oss-cn-hangzhou";
        private String publicUrl = "";
        private boolean publicAccess = false;
        private String signingEndpoint = "";
    }

}
