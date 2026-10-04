package com.basicframework.module.infra.framework.file.core.client.s3;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 {@link S3FileClientConfig#isDomainValid()} 的自定义域名校验边界。
 *
 * <p>该校验由 Bean Validation 在配置绑定时执行：七牛云没有自动生成的访问域名，缺少 domain
 * 会让上传成功但公开地址不可用；其它厂商允许按桶名自动生成域名，因此不能把 domain 一律设为必填。
 * 这里用真实校验器，与接口入参/配置绑定的校验路径保持一致。</p>
 *
 * @author shady2713
 */
class S3FileClientConfigTest {

    /** 真实校验器工厂，本类独占并负责关闭。 */
    private static ValidatorFactory validatorFactory;
    /** 真实校验器。 */
    private static Validator validator;

    /** 建立真实校验器，避免直接调用判定方法代替容器校验。 */
    @BeforeAll
    static void createValidator() {
        validatorFactory = Validation.buildDefaultValidatorFactory();
        validator = validatorFactory.getValidator();
    }

    /** 关闭校验器工厂，释放其持有的资源。 */
    @AfterAll
    static void closeValidator() {
        validatorFactory.close();
    }

    /** 七牛云端点缺少 domain 时必须判为不合法，否则公开地址不可用。 */
    @Test
    void qiniuEndpointRequiresDomain() {
        S3FileClientConfig config = config("https://cdn.qiniucs.com");

        assertThat(violatedProperties(config)).contains("domainValid");
        assertThat(config.isDomainValid()).isFalse();
    }

    /** 七牛云端点配置了 domain 后必须通过校验。 */
    @Test
    void qiniuEndpointPassesWithDomain() {
        S3FileClientConfig config = config("https://cdn.qiniucs.com");
        config.setDomain("https://files.example.test");

        assertThat(violatedProperties(config)).doesNotContain("domainValid");
        assertThat(config.isDomainValid()).isTrue();
    }

    /** 其它厂商端点允许省略 domain，由客户端按桶名自动生成访问域名。 */
    @Test
    void nonQiniuEndpointAllowsMissingDomain() {
        S3FileClientConfig config = config("https://oss.aliyuncs.com");

        assertThat(violatedProperties(config)).doesNotContain("domainValid");
        assertThat(config.isDomainValid()).isTrue();
    }

    /** 端点缺少必要字段时其余约束仍然生效，域名校验不得掩盖这些必填项。 */
    @Test
    void requiredFieldsAreStillEnforced() {
        S3FileClientConfig config = new S3FileClientConfig();
        config.setEndpoint("https://cdn.qiniucs.com");

        assertThat(violatedProperties(config))
                .contains("bucket", "accessKey", "accessSecret", "enablePathStyleAccess", "enablePublicAccess");
    }

    /**
     * 对配置执行真实校验，返回全部违规属性名。
     *
     * @param config 待校验配置
     * @return 违规属性名集合；空集合表示通过
     */
    private Set<String> violatedProperties(S3FileClientConfig config) {
        Set<ConstraintViolation<S3FileClientConfig>> violations = validator.validate(config);
        return violations.stream().map(violation -> violation.getPropertyPath().toString()).collect(Collectors.toSet());
    }

    /**
     * 构造只缺 domain 的完整 S3 配置。
     *
     * @param endpoint 节点地址
     * @return S3 配置
     */
    private S3FileClientConfig config(String endpoint) {
        S3FileClientConfig config = new S3FileClientConfig();
        config.setEndpoint(endpoint);
        config.setBucket("files");
        config.setAccessKey("access-key");
        config.setAccessSecret("secret-key");
        config.setEnablePathStyleAccess(true);
        config.setEnablePublicAccess(true);
        config.setRegion("us-east-1");
        return config;
    }

}
