package com.basicframework.framework.web.config;

import com.basicframework.framework.encrypt.config.ApiEncryptProperties;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.context.ConfigurationPropertiesAutoConfiguration;
import org.springframework.boot.autoconfigure.validation.ValidationAutoConfiguration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 Web 与接口加密属性使用统一前缀完成绑定。
 *
 * @author 李杰
 */
class ConfigurationPrefixBindingTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(
                    ConfigurationPropertiesAutoConfiguration.class,
                    ValidationAutoConfiguration.class))
            .withUserConfiguration(TestConfiguration.class)
            .withPropertyValues(
                    "basic-framework.web.admin-ui.url=http://127.0.0.1:3000",
                    "basic-framework.api-encrypt.enable=true",
                    "basic-framework.api-encrypt.algorithm=AES",
                    "basic-framework.api-encrypt.request-key=12345678901234567890123456789012",
                    "basic-framework.api-encrypt.response-key=12345678901234567890123456789012");

    /** 验证配置前缀与属性名称能够绑定到实际配置 Bean。 */
    @Test
    void bindsKebabCaseConfigurationPrefixes() {
        contextRunner.run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context.getBean(WebProperties.class).getAdminUi().getUrl())
                    .isEqualTo("http://127.0.0.1:3000");
            assertThat(context.getBean(ApiEncryptProperties.class).getEnable()).isTrue();
        });
    }

    /** 仅注册本例需要的配置属性，隔离完整应用与外部服务。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties({WebProperties.class, ApiEncryptProperties.class})
    static class TestConfiguration {
    }

}
