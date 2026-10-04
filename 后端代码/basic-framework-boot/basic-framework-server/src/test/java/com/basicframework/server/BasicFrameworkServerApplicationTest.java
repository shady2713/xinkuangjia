package com.basicframework.server;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证后端启动入口的装配声明。
 *
 * <p>{@code @SpringBootApplication} 的扫描范围决定哪些包会被注册为 Spring 组件：范围写错时应用
 * 仍能启动，但 server 与 module 下的控制器、服务和配置都不会生效，表现为接口全部 404 或配置缺失。
 * 因此这里同时锁定扫描范围的声明与解析结果——解析出的两个包必须真实存在于类路径上。</p>
 *
 * <p>{@code main} 本身依赖完整运行时（真实 MySQL、Redis、MinIO 与端口绑定），
 * 由打包产物的人工启动探针验证，不在本用例内启动整个应用。</p>
 *
 * @author shady2713
 */
class BasicFrameworkServerApplicationTest {

    /** 基础包占位符，与应用启动时读取的配置键一致。 */
    private static final String BASE_PACKAGE_PLACEHOLDER = "${basic-framework.info.base-package}";

    /**
     * 入口类必须可作为 Spring 配置源实例化，并声明为 Spring Boot 应用。
     *
     * <p>容器启动时会实例化该配置类；若它不可实例化或缺少 {@code @SpringBootApplication}，
     * 启动入口本身就无法工作。</p>
     */
    @Test
    void entryClassIsInstantiableSpringBootApplication() {
        new BasicFrameworkServerApplication();

        SpringBootApplication annotation = BasicFrameworkServerApplication.class.getAnnotation(SpringBootApplication.class);
        assertThat(annotation).as("启动入口必须声明为 Spring Boot 应用").isNotNull();
        assertThat(annotation.scanBasePackages())
                .as("扫描范围必须使用配置化的基础包，不得写死包名")
                .containsExactlyInAnyOrder(BASE_PACKAGE_PLACEHOLDER + ".server", BASE_PACKAGE_PLACEHOLDER + ".module");
    }

    /**
     * 扫描范围解析后必须覆盖真实存在的 server 与 module 包。
     *
     * <p>用应用自身的 YAML 解析基础包，避免测试与运行期使用不同的取值口径；
     * 再按解析结果加载两侧的代表类，证明包确实在类路径上而不是拼错的空包。</p>
     *
     * @throws Exception 读取配置或加载代表类失败时抛出
     */
    @Test
    void scanPackagesResolveToExistingPackages() throws Exception {
        String basePackage = basePackageFromApplicationYaml();
        List<String> resolved = Arrays.stream(BasicFrameworkServerApplication.class
                        .getAnnotation(SpringBootApplication.class).scanBasePackages())
                .map(packageName -> packageName.replace(BASE_PACKAGE_PLACEHOLDER, basePackage))
                .toList();

        assertThat(resolved).containsExactly(basePackage + ".server", basePackage + ".module");
        assertThat(Class.forName(resolved.get(0) + ".BasicFrameworkServerApplication"))
                .as("server 扫描范围必须包含启动入口自身")
                .isEqualTo(BasicFrameworkServerApplication.class);
        assertThat(Class.forName(resolved.get(1) + ".infra.framework.file.config.MinioFileProperties"))
                .as("module 扫描范围必须包含业务模块组件").isNotNull();
    }

    /**
     * 从应用自带 YAML 读取基础包取值。
     *
     * @return 基础包名
     * @throws IOException 配置文件缺失或无法解析时抛出
     */
    private String basePackageFromApplicationYaml() throws IOException {
        PropertySource<?> source = new YamlPropertySourceLoader()
                .load("application", new ClassPathResource("application.yaml")).get(0);
        return String.valueOf(source.getProperty("basic-framework.info.base-package"));
    }

}
