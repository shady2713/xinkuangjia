package com.basicframework.server;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.BindException;
import org.springframework.boot.context.properties.bind.Binder;
import com.basicframework.framework.web.config.WebProperties;
import com.basicframework.module.infra.framework.file.config.FileUploadProperties;
import org.springframework.boot.autoconfigure.web.servlet.MultipartProperties;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * 验证本地环境变量到应用配置的绑定及缺失配置失败契约。
 *
 * @author 李杰
 */
class LocalEnvironmentConfigurationTest {

    /** 验证端口、主数据源和 Redis 使用显式环境配置，避免退回默认实例。 */
    @Test
    void bindsLocalDatasourceAndRedisVariables() throws IOException {
        Map<String, Object> values = localValues();
        StandardEnvironment environment = environment(values);
        assertEquals("48080", environment.getProperty("server.port"));
        assertEquals("local", environment.getProperty("spring.profiles.active"));
        assertEquals("jdbc:mysql://127.0.0.1:3306/framework_test?useSSL=false&serverTimezone=Asia/Shanghai"
                        + "&allowPublicKeyRetrieval=true&nullCatalogMeansCurrent=true",
                environment.getProperty("spring.datasource.dynamic.datasource.master.url"));
        assertEquals(values.get("DB_PASSWORD"),
                environment.getProperty("spring.datasource.dynamic.datasource.master.password"));
        assertEquals(values.get("REDIS_PASSWORD"), environment.getProperty("spring.data.redis.password"));
    }

    /** 未单独配置从库时复用主库参数，保持单数据库开发环境可运行。 */
    @Test
    void slaveDatasourceFallsBackToMaster() throws IOException {
        StandardEnvironment environment = environment(localValues());
        assertEquals(environment.getProperty("spring.datasource.dynamic.datasource.master.url"),
                environment.getProperty("spring.datasource.dynamic.datasource.slave.url"));
        assertEquals(environment.getProperty("spring.datasource.dynamic.datasource.master.password"),
                environment.getProperty("spring.datasource.dynamic.datasource.slave.password"));
    }

    /** 管理站点地址使用当前前端端口，部署变量可覆盖本地地址。 */
    @Test
    void adminUiAddressUsesLocalPortAndDeploymentOverride() throws IOException {
        Map<String, Object> values = localValues();
        assertEquals("http://localhost:5175",
                environment(values).getProperty("basic-framework.web.admin-ui.url"));
        values.put("ADMIN_UI_URL", "https://admin.example.com");
        assertEquals("https://admin.example.com",
                environment(values).getProperty("basic-framework.web.admin-ui.url"));
    }

    /** 当前 YAML 绑定跨域环境变量，缺省关闭；列表中的源不隐式扩大到其他端口。 */
    @Test
    void corsEnvironmentUsesExplicitOriginsAndClosedDefault() throws IOException {
        Map<String, Object> values = localValues();
        assertEquals(java.util.List.of(), Binder.get(environment(values))
                .bind("basic-framework.web", WebProperties.class).get().getCorsAllowedOrigins());
        values.put("CORS_ALLOWED_ORIGIN", "http://localhost:5175,https://admin.example.com");
        assertEquals(java.util.List.of("http://localhost:5175", "https://admin.example.com"),
                Binder.get(environment(values)).bind("basic-framework.web", WebProperties.class).get().getCorsAllowedOrigins());
    }

    /** 文件限制同时控制应用与 Multipart 层，环境覆盖不能让两者的文件大小口径分离。 */
    @Test
    void fileBudgetsAndMultipartUseConsistentEnvironmentValues() throws IOException {
        Map<String, Object> values = localValues();
        Binder defaults = Binder.get(environment(values));
        FileUploadProperties upload = defaults.bind("basic-framework.file.upload", FileUploadProperties.class).get();
        MultipartProperties multipart = defaults.bind("spring.servlet.multipart", MultipartProperties.class).get();
        assertEquals(10 * 1024 * 1024, upload.getMaxBytes());
        assertEquals(upload.getMaxBytes(), multipart.getMaxFileSize().toBytes());
        assertEquals(33L * 1024 * 1024, multipart.getMaxRequestSize().toBytes());
        values.put("FILE_UPLOAD_MAX_BYTES", "33554432");
        values.put("FILE_UPLOAD_DAILY_BYTES", "67108864");
        values.put("FILE_UPLOAD_DAILY_REQUESTS", "7");
        Binder configured = Binder.get(environment(values));
        FileUploadProperties overridden = configured.bind("basic-framework.file.upload", FileUploadProperties.class).get();
        assertEquals(33554432, overridden.getMaxBytes());
        assertEquals(67108864, overridden.getDailyBytes());
        assertEquals(7, overridden.getDailyRequests());
        assertEquals(overridden.getMaxBytes(), configured.bind("spring.servlet.multipart", MultipartProperties.class)
                .get().getMaxFileSize().toBytes());
    }

    /** 数据库和存储凭据没有源码缺省值，环境缺失时无法解析为有效凭据。 */
    @Test
    void databaseAndStorageSecretsRequireEnvironmentInjection() throws IOException {
        StandardEnvironment environment = environment(Map.of());
        assertThrows(IllegalArgumentException.class,
                () -> environment.getProperty("spring.datasource.dynamic.datasource.master.password"));
        assertThrows(IllegalArgumentException.class,
                () -> environment.getProperty("basic-framework.file.minio.secret-key"));
    }

    /** MinIO 的安全协议配置缺失时保持启动失败，防止以错误存储配置运行。 */
    @Test
    void missingMinioSecureStopsBinding() throws IOException {
        StandardEnvironment environment = environment(localValues());
        assertThrows(BindException.class,
                () -> Binder.get(environment).bind("basic-framework.file.minio.secure", Boolean.class));
    }

    /**
     * 构造隔离环境，避免开发者机器上的变量影响绑定结果。
     *
     * @param values 本例需要的环境配置
     * @return 加载当前应用 YAML 的隔离环境
     * @throws IOException 当前应用 YAML 无法读取时抛出
     */
    private static StandardEnvironment environment(Map<String, Object> values) throws IOException {
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
        environment.getPropertySources().remove(StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
        environment.getPropertySources().addFirst(new MapPropertySource("local-test-values", values));
        new YamlPropertySourceLoader().load("application-test", new ClassPathResource("application.yaml"))
                .forEach(environment.getPropertySources()::addLast);
        return environment;
    }

    /**
     * 提供本例的最小配置，凭据每次随机生成且不输出。
     *
     * @return 用于验证绑定的环境配置
     */
    private static Map<String, Object> localValues() {
        Map<String, Object> values = new HashMap<>();
        values.put("DB_HOST", "127.0.0.1");
        values.put("DB_PORT", "3306");
        values.put("DB_NAME", "framework_test");
        values.put("DB_USERNAME", "framework_test");
        values.put("DB_PASSWORD", UUID.randomUUID().toString());
        values.put("REDIS_PASSWORD", UUID.randomUUID().toString());
        return values;
    }
}
