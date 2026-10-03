package com.basicframework.module.infra.service.file;

import com.basicframework.module.infra.framework.file.config.FileUploadProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.validation.ValidationAutoConfiguration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证上传限额通过真实 Spring 配置绑定执行，非法配置不能仅靠业务调用时才暴露。
 *
 * @author shady2713
 */
class FileUploadPropertiesTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(ValidationAutoConfiguration.class))
            .withUserConfiguration(UploadConfiguration.class);

    /** 没有覆盖项时使用有界默认值，不能回落到无限上传。 */
    @Test
    void bindsSafeDefaults() {
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            var properties = context.getBean(FileUploadProperties.class);
            assertThat(properties.getMaxBytes()).isEqualTo(10 * 1024 * 1024);
            assertThat(properties.getDailyBytes()).isEqualTo(200L * 1024 * 1024);
            assertThat(properties.getDailyRequests()).isEqualTo(100);
        });
    }

    /** 非正预算与超过内存路径硬上限的单文件配置必须阻止上下文启动。 */
    @ParameterizedTest
    @ValueSource(strings = {"max-bytes=0", "max-bytes=33554433", "daily-bytes=0", "daily-requests=0"})
    void rejectsInvalidLimits(String value) {
        runner.withPropertyValues("basic-framework.file.upload." + value)
                .run(context -> assertThat(context).hasFailed());
    }

    /** 仅注册目标配置绑定，避免依赖外部服务或扫描完整应用。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(FileUploadProperties.class)
    static class UploadConfiguration {
    }
}
