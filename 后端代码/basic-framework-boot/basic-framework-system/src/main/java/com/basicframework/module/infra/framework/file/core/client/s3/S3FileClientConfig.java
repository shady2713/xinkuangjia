package com.basicframework.module.infra.framework.file.core.client.s3;

import cn.hutool.core.util.StrUtil;
import com.basicframework.module.infra.framework.file.core.client.FileClientConfig;
import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;
import org.hibernate.validator.constraints.URL;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;

import java.net.URI;
import java.net.URISyntaxException;

/**
 * S3 文件客户端的配置类
 *
 * 兼容 MinIO、阿里云 OSS、腾讯云 COS、七牛云、华为云 OBS、火山云等 S3 协议存储。
 *
 * @author shady
 */
@Data
public class S3FileClientConfig implements FileClientConfig {

    public static final String ENDPOINT_QINIU = "qiniucs.com";
    public static final String ENDPOINT_ALIYUN = "aliyuncs.com";
    public static final String ENDPOINT_TENCENT = "myqcloud.com";
    public static final String ENDPOINT_VOLCES = "volces.com"; // 火山云（字节）

    /**
     * 节点地址
     * 1. MinIO：https://www.example.com/Spring-Boot/MinIO 。例如说，http://127.0.0.1:9000
     * 2. 阿里云：https://help.aliyun.com/document_detail/31837.html
     * 3. 腾讯云：https://cloud.tencent.com/document/product/436/6224
     * 4. 七牛云：https://developer.qiniu.com/kodo/4088/s3-access-domainname
     * 5. 华为云：https://console.huaweicloud.com/apiexplorer/#/endpoint/OBS
     * 6. 火山云：https://www.volcengine.com/docs/6349/107356
     */
    @NotNull(message = "endpoint 不能为空")
    private String endpoint;
    /**
     * 自定义域名
     * 1. MinIO：通过 Nginx 配置
     * 2. 阿里云：https://help.aliyun.com/document_detail/31836.html
     * 3. 腾讯云：https://cloud.tencent.com/document/product/436/11142
     * 4. 七牛云：https://developer.qiniu.com/kodo/8556/set-the-custom-source-domain-name
     * 5. 华为云：https://support.huaweicloud.com/usermanual-obs/obs_03_0032.html
     * 6. 火山云：https://www.volcengine.com/docs/6349/128983
     */
    @URL(message = "domain 必须是 URL 格式")
    private String domain;
    /**
     * 存储 Bucket
     */
    @NotNull(message = "bucket 不能为空")
    private String bucket;

    /**
     * 访问 Key
     * 1. MinIO：https://www.example.com/Spring-Boot/MinIO
     * 2. 阿里云：https://ram.console.aliyun.com/manage/ak
     * 3. 腾讯云：https://console.cloud.tencent.com/cam/capi
     * 4. 七牛云：https://portal.qiniu.com/user/key
     * 5. 华为云：https://support.huaweicloud.com/qs-obs/obs_qs_0005.html
     * 6. 火山云：https://console.volcengine.com/iam/keymanage/
     */
    @NotNull(message = "accessKey 不能为空")
    private String accessKey;
    /**
     * 访问 Secret
     */
    @NotNull(message = "accessSecret 不能为空")
    private String accessSecret;

    /**
     * 是否启用 PathStyle 访问
     */
    @NotNull(message = "enablePathStyleAccess 不能为空")
    private Boolean enablePathStyleAccess;

    /**
     * 是否公开访问
     *
     * true：公开访问，所有人都可以访问
     * false：私有访问，只有配置的 accessKey 才可以访问
     */
    @NotNull(message = "是否公开访问不能为空")
    private Boolean enablePublicAccess;

    /**
     * 区域
     * 1. AWS S3：https://docs.aws.amazon.com/general/latest/gr/s3.html 例如说，us-east-1、us-west-2
     * 2. MinIO：可以填任意值，通常使用 us-east-1
     * 3. 阿里云：不需要填写，会自动识别
     * 4. 腾讯云：不需要填写，会自动识别
     * 5. 七牛云：不需要填写，会自动识别
     * 6. 华为云：不需要填写，会自动识别
     * 7. 火山云：不需要填写，会自动识别
     */
    private String region;

    /**
     * 仅用于预签名的 HTTP(S) 根地址，要求网关保留原始 Host 和桶路径以通过 SigV4 验签。
     *
     * <p>留空时沿用 {@link #domain} 推导，无法推导时回到 {@link #endpoint}。</p>
     */
    private String signingEndpoint;

    /**
     * 校验自定义域名配置是否满足存储服务要求。
     *
     * @return 七牛云场景必须配置 domain，其它场景允许自动生成访问域名
     */
    @SuppressWarnings("RedundantIfStatement")
    @AssertTrue(message = "domain 不能为空")
    @JsonIgnore
    public boolean isDomainValid() {
        // 如果是七牛，必须带有 domain
        if (StrUtil.contains(endpoint, ENDPOINT_QINIU) && StrUtil.isEmpty(domain)) {
            return false;
        }
        return true;
    }

    /**
     * 校验预签名配置的站点地址。
     *
     * @return 留空或配置为有效 HTTP(S) 根地址时返回 true
     */
    @AssertTrue(message = "signingEndpoint must be a root HTTP(S) origin")
    @JsonIgnore
    public boolean isSigningEndpointValid() {
        return StrUtil.isBlank(signingEndpoint) || isRootHttpOrigin(signingEndpoint);
    }

    /**
     * 核对地址是否仅包含 HTTP(S) 协议和有效的主机端口。
     *
     * @param value 待核对地址，接受首尾空白及单个末尾斜线
     * @return 符合根地址形式且无用户信息、查询或片段时返回 true
     */
    public static boolean isRootHttpOrigin(String value) {
        if (StrUtil.isBlank(value)) {
            return false;
        }
        try {
            URI uri = new URI(value.trim());
            String scheme = uri.getScheme();
            return ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))
                    && StrUtil.isNotEmpty(uri.getHost())
                    && uri.getRawUserInfo() == null
                    && (StrUtil.isEmpty(uri.getRawPath()) || "/".equals(uri.getRawPath()))
                    && uri.getRawQuery() == null
                    && uri.getRawFragment() == null;
        } catch (URISyntaxException ex) {
            return false;
        }
    }

}
