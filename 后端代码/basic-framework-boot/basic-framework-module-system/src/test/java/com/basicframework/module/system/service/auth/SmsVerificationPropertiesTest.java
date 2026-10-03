package com.basicframework.module.system.service.auth;

import com.basicframework.module.system.framework.sms.config.SmsCodeProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/** 验证短信限制安全默认及无效阈值在应用属性绑定时被拒绝。 */
class SmsVerificationPropertiesTest {

    /** 绑定真实缺省阈值，确保未配置时仍有次数和时间边界。 */
    @Test
    void bindsVerificationDefaults() {
        runner().run(context -> {
            assertThat(context).hasNotFailed();
            SmsCodeProperties properties = context.getBean(SmsCodeProperties.class);
            assertThat(properties.getVerificationMaximumFailures()).isEqualTo(5);
            assertThat(properties.getVerificationMaximumPerMobile()).isEqualTo(10);
            assertThat(properties.getVerificationMaximumPerIp()).isEqualTo(50);
            assertThat(properties.getVerificationWindow()).isEqualTo(Duration.ofMinutes(1));
            assertThat(properties.getSendMaximumPerIp()).isEqualTo(50);
            assertThat(properties.getSendIpWindow()).isEqualTo(Duration.ofMinutes(1));
        });
    }

    /** 零、负数或空窗口不能把限流配置退化为无限尝试。 */
    @ParameterizedTest
    @ValueSource(strings = {"verification-maximum-failures=0", "verification-maximum-per-mobile=-1",
            "verification-maximum-per-ip=0", "verification-window=0ms", "expire-times=0ms",
            "send-maximum-per-ip=0", "send-ip-window=0ms", "send-frequency=0ms", "send-maximum-quantity-per-day=0"})
    void rejectsInvalidBudgets(String invalid) {
        runner().withPropertyValues("basic-framework.sms-code." + invalid)
                .run(context -> assertThat(context).hasFailed());
    }

    /** 提供验证码原有必需配置，仅改变待验证的限制属性。 */
    private ApplicationContextRunner runner() {
        return new ApplicationContextRunner().withUserConfiguration(Binding.class)
                .withPropertyValues("basic-framework.sms-code.expire-times=10m",
                        "basic-framework.sms-code.send-frequency=1m",
                        "basic-framework.sms-code.send-maximum-quantity-per-day=10");
    }

    /** 只启动真实属性绑定和 Bean Validation，不依赖业务服务。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(SmsCodeProperties.class)
    static class Binding {
    }
}
