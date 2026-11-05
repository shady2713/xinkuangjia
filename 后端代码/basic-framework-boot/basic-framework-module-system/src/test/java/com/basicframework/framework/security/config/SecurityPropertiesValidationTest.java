package com.basicframework.framework.security.config;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.mock.env.MockEnvironment;

import java.time.Duration;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 SM2 私钥缺失或格式错误时配置校验会拒绝启动。
 *
 * @author shady2713
 */
class SecurityPropertiesValidationTest {

    /** 仅用于测试的 SM2 私钥。 */
    private static final String TEST_PRIVATE_KEY =
            "fab85826985d339820dc4b9914487069e2b67ff67275b67ca00fc1d682d810f6";

    /** 使用 Bean Validation 默认校验器。 */
    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    /** 验证未注入私钥时产生明确的配置错误。 */
    @Test
    void rejectsMissingPrivateKey() {
        SecurityProperties properties = new SecurityProperties();

        Set<ConstraintViolation<SecurityProperties>> violations = validator.validate(properties);

        assertThat(violations).anyMatch(violation ->
                violation.getMessage().contains("SM2 私钥未配置"));
    }

    /** 验证格式错误的私钥同样被拒绝。 */
    @Test
    void rejectsMalformedPrivateKey() {
        SecurityProperties properties = new SecurityProperties();
        properties.getSm2().setPrivateKey("not-a-valid-key");

        Set<ConstraintViolation<SecurityProperties>> violations = validator.validate(properties);

        assertThat(violations).anyMatch(violation ->
                violation.getMessage().contains("SM2 私钥格式错误"));
    }

    /** 验证合法私钥和默认参数通过配置校验。 */
    @Test
    void acceptsValidPrivateKey() {
        SecurityProperties properties = new SecurityProperties();
        properties.getSm2().setPrivateKey(TEST_PRIVATE_KEY);

        assertThat(validator.validate(properties)).isEmpty();
    }

    /** 验证短信登录失败次数必须大于 0。 */
    @Test
    void rejectsInvalidSmsLoginMaxFailures() {
        SecurityProperties properties = new SecurityProperties();
        properties.getSm2().setPrivateKey(TEST_PRIVATE_KEY);
        properties.getSmsLoginLock().setMaxFailures(0);

        Set<ConstraintViolation<SecurityProperties>> violations = validator.validate(properties);

        assertThat(violations).anyMatch(violation ->
                violation.getMessage().contains("短信登录手机号失败次数必须大于 0"));
    }

    /** 验证默认降级策略和会话空闲超时符合安全基线。 */
    @Test
    void hasSafeSessionDefaults() {
        SecurityProperties properties = new SecurityProperties();

        assertThat(properties.getRedisUnavailableStrategy())
                .isEqualTo(RedisUnavailableStrategy.LOCAL_FALLBACK);
        assertThat(properties.getSession().getIdleTimeout()).isEqualTo(Duration.ofMinutes(30));
        assertThat(properties.getSmsLoginLock().getEnabled()).isTrue();
    }
}
