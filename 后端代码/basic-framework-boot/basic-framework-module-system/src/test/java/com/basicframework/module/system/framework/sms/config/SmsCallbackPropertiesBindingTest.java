package com.basicframework.module.system.framework.sms.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.context.ConfigurationPropertiesAutoConfiguration;
import org.springframework.boot.autoconfigure.validation.ValidationAutoConfiguration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证短信回调签名配置的前缀、密钥集合与时间窗口绑定。
 *
 * @author shady2713
 */
class SmsCallbackPropertiesBindingTest {

    /** 应用配置绑定测试上下文，隔离完整应用与外部服务。 */
    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(
                    ConfigurationPropertiesAutoConfiguration.class,
                    ValidationAutoConfiguration.class))
            .withUserConfiguration(TestConfiguration.class);

    /** 验证渠道密钥与时间窗口按 kebab-case 前缀绑定。 */
    @Test
    void bindsSecretsAndTimestampTolerance() {
        contextRunner.withPropertyValues(
                "basic-framework.sms-callback.secrets.ALIYUN=CHANGE_ME_ALIYUN_HMAC",
                "basic-framework.sms-callback.secrets.TENCENT=CHANGE_ME_TENCENT_HMAC",
                "basic-framework.sms-callback.timestamp-tolerance=90s")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    SmsCallbackProperties properties = context.getBean(SmsCallbackProperties.class);
                    assertThat(properties.getSecrets())
                            .containsEntry("ALIYUN", "CHANGE_ME_ALIYUN_HMAC")
                            .containsEntry("TENCENT", "CHANGE_ME_TENCENT_HMAC");
                    assertThat(properties.getTimestampTolerance()).isEqualTo(Duration.ofSeconds(90));
                });
    }

    /** 验证未配置密钥时保持空集合，由验签器按失败关闭处理。 */
    @Test
    void keepsEmptySecretsWhenNotConfigured() {
        contextRunner.run(context -> {
            assertThat(context).hasNotFailed();
            SmsCallbackProperties properties = context.getBean(SmsCallbackProperties.class);
            assertThat(properties.getSecrets()).isEmpty();
            assertThat(properties.getTimestampTolerance()).isEqualTo(Duration.ofMinutes(5));
        });
    }

    /** 仅注册本例需要的配置属性，避免加载短信客户端和数据库组件。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(SmsCallbackProperties.class)
    static class TestConfiguration {
    }

}
