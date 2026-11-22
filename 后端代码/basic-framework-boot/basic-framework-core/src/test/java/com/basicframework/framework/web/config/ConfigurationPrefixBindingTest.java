package com.basicframework.framework.web.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.context.ConfigurationPropertiesAutoConfiguration;
import org.springframework.boot.autoconfigure.validation.ValidationAutoConfiguration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 Web 配置属性使用统一前缀完成绑定。
 *
 * @author 李杰
 */
class ConfigurationPrefixBindingTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(
                    ConfigurationPropertiesAutoConfiguration.class,
                    ValidationAutoConfiguration.class))
            .withUserConfiguration(TestConfiguration.class)
            .withPropertyValues("basic-framework.web.admin-ui.url=http://127.0.0.1:3000");

    @Test
    void bindsKebabCaseConfigurationPrefixes() {
        contextRunner.run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context.getBean(WebProperties.class).getAdminUi().getUrl())
                    .isEqualTo("http://127.0.0.1:3000");
        });
    }

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(WebProperties.class)
    static class TestConfiguration {
    }

}
