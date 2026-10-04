package com.basicframework.module.infra.framework.file.config;

import com.basicframework.module.infra.framework.file.core.client.FileClientFactory;
import com.basicframework.module.infra.framework.file.core.client.FileClientFactoryImpl;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证文件自动配置在最小上下文中注册客户端工厂并绑定 MinIO 配置属性。
 *
 * <p>该配置类同时承担两件事：注册进程内共享的客户端工厂，以及启用 MinIO 配置属性绑定。
 * 只断言工厂 Bean 存在无法排除属性绑定没生效——那样 MinIO 配置会是 null，文件客户端初始化时
 * 才会在运行期暴露；反过来，必填项缺失必须在启动阶段失败，不能以空配置连接对象存储。</p>
 *
 * @author shady2713
 */
class BasicFrameworkFileAutoConfigurationTest {

    /** 自动配置必须注册唯一的文件客户端工厂，实现类为进程内实现。 */
    @Test
    void registersFileClientFactory() {
        contextRunner().run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).hasSingleBean(FileClientFactory.class);
            assertThat(context.getBean(FileClientFactory.class)).isInstanceOf(FileClientFactoryImpl.class);
        });
    }

    /** MinIO 配置必须按统一前缀绑定，配置值要真实进入属性对象。 */
    @Test
    void bindsMinioProperties() {
        contextRunner().run(context -> {
            assertThat(context).hasNotFailed();
            MinioFileProperties properties = context.getBean(MinioFileProperties.class);
            assertThat(properties.getEndpoint()).isEqualTo("minio.example.test:9000");
            assertThat(properties.getBucket()).isEqualTo("files");
            assertThat(properties.getPublicUrl()).isEqualTo("https://cdn.example.test");
            assertThat(properties.toClientConfig().getEndpoint())
                    .as("绑定后的配置必须能生成可用的客户端配置").isEqualTo("http://minio.example.test:9000");
        });
    }

    /** 缺少必填配置时必须阻止上下文启动，避免以空配置连接对象存储。 */
    @Test
    void rejectsMissingRequiredProperties() {
        new ApplicationContextRunner()
                .withUserConfiguration(BasicFrameworkFileAutoConfiguration.class)
                .run(context -> assertThat(context)
                        .hasFailed()
                        .getFailure()
                        .isInstanceOf(org.springframework.boot.context.properties.ConfigurationPropertiesBindException.class));
    }

    /**
     * 构造装配文件自动配置并绑定必填 MinIO 配置的最小上下文。
     *
     * @return 最小上下文运行器
     */
    private ApplicationContextRunner contextRunner() {
        return new ApplicationContextRunner()
                .withUserConfiguration(BasicFrameworkFileAutoConfiguration.class)
                .withPropertyValues(
                        "basic-framework.file.minio.endpoint=minio.example.test:9000",
                        "basic-framework.file.minio.access-key=DUMMY-MINIO-ACCESS-KEY",
                        "basic-framework.file.minio.secret-key=DUMMY-MINIO-SECRET-KEY",
                        "basic-framework.file.minio.bucket=files",
                        "basic-framework.file.minio.region=us-east-1",
                        "basic-framework.file.minio.public-url=https://cdn.example.test");
    }

}
