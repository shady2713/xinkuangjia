package com.basicframework.server;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.BindException;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 验证本地环境变量到应用配置的绑定及缺失配置失败契约。
 *
 * @author 李杰
 */
class LocalEnvironmentConfigurationTest {

    /** 匹配应用配置中的占位符引用，例如 {@code ${DB_HOST:127.0.0.1}}。 */
    private static final Pattern PLACEHOLDER_PATTERN = Pattern.compile("\\$\\{([A-Z][A-Z0-9_]*)(?::[^}]*)?}");

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

    /** MinIO 的安全协议配置缺失时保持启动失败，防止以错误存储配置运行。 */
    @Test
    void missingMinioSecureStopsBinding() throws IOException {
        StandardEnvironment environment = environment(localValues());
        assertThrows(BindException.class,
                () -> Binder.get(environment).bind("basic-framework.file.minio.secure", Boolean.class));
    }

    /**
     * {@code .env.example} 中的所有非注释变量都必须在服务端配置文件中有真实占位绑定，防止悬空变量误导开发者。
     *
     * @throws IOException 读取环境样例或配置文件失败时抛出
     */
    @Test
    void envExampleKeysAreAllConsumedByServerConfiguration() throws IOException {
        Path envExample = resolveEnvExample();
        Set<String> declaredKeys = parseEnvKeys(Files.readAllLines(envExample, StandardCharsets.UTF_8));
        assertFalse(declaredKeys.isEmpty(), ".env.example 不得为空");
        Set<String> referencedKeys = loadReferencedPlaceholders();
        Set<String> unmapped = findUnmappedKeys(declaredKeys, referencedKeys);
        assertTrue(unmapped.isEmpty(), ".env.example 存在未被配置消费的悬空变量：" + unmapped);
    }

    /**
     * 反向证明：当 {@code .env.example} 出现未绑定的伪配置键时，校验逻辑必须检出。
     *
     * @throws IOException 读取配置文件失败时抛出
     */
    @Test
    void unmappedEnvExampleKeyIsDetected() throws IOException {
        Set<String> declared = parseEnvKeys(List.of(
                "# 注释行不计入",
                "SERVER_PORT=48080",
                "UNMAPPED_GHOST_SWITCH=true"));
        Set<String> unmapped = findUnmappedKeys(declared, loadReferencedPlaceholders());
        assertEquals(Set.of("UNMAPPED_GHOST_SWITCH"), unmapped);
    }

    /**
     * 定位后端聚合工程根目录下的 {@code .env.example}，兼容在聚合根或 server 模块工作目录执行测试。
     *
     * @return 真实存在的环境模板路径
     */
    private static Path resolveEnvExample() {
        Path fromModule = Path.of("..", ".env.example").normalize();
        if (Files.isRegularFile(fromModule)) {
            return fromModule;
        }
        Path fromReactor = Path.of(".env.example").normalize();
        assertTrue(Files.isRegularFile(fromReactor), "未找到后端 .env.example");
        return fromReactor;
    }

    /**
     * 解析 {@code KEY=VALUE} 行的键名集合，忽略空行与井号注释行。
     *
     * @param lines 环境模板文本行
     * @return 按出现顺序去重的键名集合
     */
    private static Set<String> parseEnvKeys(List<String> lines) {
        Set<String> keys = new LinkedHashSet<>();
        for (String raw : lines) {
            String line = raw.trim();
            if (line.isEmpty() || line.startsWith("#")) {
                continue;
            }
            int separator = line.indexOf('=');
            assertTrue(separator > 0, ".env.example 存在非法配置行：" + line);
            keys.add(line.substring(0, separator).trim());
        }
        return keys;
    }

    /**
     * 提取 {@code application.yaml} 与 {@code logback-spring.xml} 中实际引用的大写环境变量占位符。
     *
     * @return 服务端配置实际消费的环境变量集合
     * @throws IOException 类路径配置无法读取时抛出
     */
    private static Set<String> loadReferencedPlaceholders() throws IOException {
        Set<String> referenced = new LinkedHashSet<>();
        for (String resourceName : List.of("application.yaml", "logback-spring.xml")) {
            String content = new ClassPathResource(resourceName).getContentAsString(StandardCharsets.UTF_8);
            Matcher matcher = PLACEHOLDER_PATTERN.matcher(content);
            while (matcher.find()) {
                referenced.add(matcher.group(1));
            }
        }
        return referenced;
    }

    /**
     * 计算环境模板中声明但未被服务端配置引用的悬空键。
     *
     * @param declaredKeys 环境模板声明的键集合
     * @param referencedKeys 服务端配置引用的占位符集合
     * @return 悬空键集合
     */
    private static Set<String> findUnmappedKeys(Set<String> declaredKeys, Set<String> referencedKeys) {
        Set<String> unmapped = new LinkedHashSet<>(declaredKeys);
        unmapped.removeAll(referencedKeys);
        return unmapped;
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
