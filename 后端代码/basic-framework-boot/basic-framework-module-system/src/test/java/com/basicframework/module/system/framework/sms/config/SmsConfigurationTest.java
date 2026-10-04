package com.basicframework.module.system.framework.sms.config;

import com.basicframework.module.system.framework.sms.core.client.SmsClientFactory;
import com.basicframework.module.system.framework.sms.core.client.impl.SmsClientFactoryImpl;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.context.ConfigurationPropertiesAutoConfiguration;
import org.springframework.boot.autoconfigure.validation.ValidationAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证短信配置在最小上下文中注册客户端工厂并绑定验证码属性。
 *
 * <p>该配置类同时承担两件事：注册短信客户端工厂，以及启用短信验证码属性绑定。
 * 只断言工厂 Bean 存在无法排除属性未绑定——那样验证码有效期与频率限制会取到未配置的值，
 * 只有在真实发短信时才会暴露。</p>
 *
 * @author shady2713
 */
class SmsConfigurationTest {

    /** 自动配置必须注册唯一的短信客户端工厂。 */
    @Test
    void registersSmsClientFactory() {
        contextRunner()
                .withPropertyValues(requiredCodeProperties())
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).hasSingleBean(SmsClientFactory.class);
                    assertThat(context.getBean(SmsClientFactory.class)).isInstanceOf(SmsClientFactoryImpl.class);
                });
    }

    /** 缺少短信验证码必填配置时必须阻止上下文启动，避免取到未配置的有效期与频率限制。 */
    @Test
    void rejectsMissingCodeProperties() {
        contextRunner().run(context -> assertThat(context).hasFailed());
    }

    /** 短信验证码属性必须按统一前缀绑定，配置值要真实进入属性对象。 */
    @Test
    void bindsSmsCodeProperties() {
        contextRunner()
                .withPropertyValues(
                        "basic-framework.sms-code.expire-times=10m",
                        "basic-framework.sms-code.send-frequency=1m",
                        "basic-framework.sms-code.send-maximum-quantity-per-day=7")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    SmsCodeProperties properties = context.getBean(SmsCodeProperties.class);
                    assertThat(properties.getExpireTimes()).hasMinutes(10);
                    assertThat(properties.getSendFrequency()).hasMinutes(1);
                    assertThat(properties.getSendMaximumQuantityPerDay()).isEqualTo(7);
                });
    }

    /**
     * 短信验证码必填配置的最小合法取值。
     *
     * @return 供最小上下文使用的属性键值对
     */
    private String[] requiredCodeProperties() {
        return new String[]{
                "basic-framework.sms-code.expire-times=10m",
                "basic-framework.sms-code.send-frequency=1m",
                "basic-framework.sms-code.send-maximum-quantity-per-day=10"};
    }

    /**
     * 构造只装配短信配置的最小上下文。
     *
     * @return 最小上下文运行器
     */
    private ApplicationContextRunner contextRunner() {
        return new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(ConfigurationPropertiesAutoConfiguration.class,
                        ValidationAutoConfiguration.class))
                .withUserConfiguration(SmsConfiguration.class);
    }

}
