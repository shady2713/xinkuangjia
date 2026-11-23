package com.basicframework.server;

import com.basicframework.module.infra.framework.file.config.FileStorageProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.context.config.ConfigDataEnvironmentPostProcessor;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.MutablePropertySources;
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
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 验证本地环境变量到应用配置的绑定及配置完整性契约。
 *
 * @author 李杰
 */
class LocalEnvironmentConfigurationTest {

    @TempDir
    static Path configDataRoot;

    private static final Pattern PLACEHOLDER_PATTERN = Pattern.compile("\\$\\{([A-Z][A-Z0-9_]*)(?::[^}]*)?}");

    @Test
    void bindsLocalDatasourceAndRedisVariables() throws IOException {
        Map<String, Object> values = localValues();
        values.put("SPRING_PROFILES_ACTIVE", "local");
        StandardEnvironment environment = environment(values, true);
        assertEquals("48080", environment.getProperty("server.port"));
        assertEquals("local", environment.getProperty("spring.profiles.active"));
        assertEquals("jdbc:mysql://127.0.0.1:3306/framework_test?sslMode=DISABLED&allowPublicKeyRetrieval=true"
                        + "&serverTimezone=Asia/Shanghai&nullCatalogMeansCurrent=true",
                environment.getProperty("spring.datasource.url"));
        assertEquals(values.get("DB_PASSWORD"), environment.getProperty("spring.datasource.password"));
        assertEquals(values.get("REDIS_PASSWORD"), environment.getProperty("spring.data.redis.password"));
    }

    @Test
    void configDataDefaultsToProdWhenNoProfileSelected() throws IOException {
        Map<String, Object> values = localValues();
        values.remove("SPRING_PROFILES_ACTIVE");
        StandardEnvironment environment = configDataEnvironment(values);
        assertActiveProfile(environment, "prod", "local");
        assertProductionDatasourceUrl(environment);
    }

    @Test
    void configDataAppliesExplicitProdProfile() throws IOException {
        Map<String, Object> values = localValues();
        values.put("SPRING_PROFILES_ACTIVE", "prod");
        StandardEnvironment environment = configDataEnvironment(values);
        assertActiveProfile(environment, "prod", "local");
        assertProductionDatasourceUrl(environment);
    }

    @Test
    void configDataAppliesExplicitLocalProfileWithLocalYamlSettings() throws IOException {
        Map<String, Object> values = localValues();
        values.put("SPRING_PROFILES_ACTIVE", "local");
        StandardEnvironment environment = configDataEnvironment(values);
        assertActiveProfile(environment, "local", "prod");
        assertEquals(environment(new HashMap<>(values), true).getProperty("spring.datasource.url"),
                environment.getProperty("spring.datasource.url"));
    }

    @Test
    void productionDatasourceDefaultsRequireTlsAndIdentityVerification() throws IOException {
        Map<String, Object> values = localValues();
        values.put("SPRING_PROFILES_ACTIVE", "prod");
        StandardEnvironment environment = environment(values, false);
        String url = environment.getProperty("spring.datasource.url");
        String expected = "jdbc:mysql://127.0.0.1:3306/framework_test?sslMode=VERIFY_IDENTITY"
                + "&allowPublicKeyRetrieval=false&serverTimezone=Asia/Shanghai&nullCatalogMeansCurrent=true";
        assertEquals(expected, url);
        assertFalse(url.contains("useSSL=false"));
    }

    @Test
    void adminUiAddressUsesLocalPortAndDeploymentOverride() throws IOException {
        Map<String, Object> values = localValues();
        assertEquals("http://localhost:5175", environment(values).getProperty("basic-framework.web.admin-ui.url"));
        values.put("ADMIN_UI_URL", "https://admin.example.com");
        assertEquals("https://admin.example.com", environment(values).getProperty("basic-framework.web.admin-ui.url"));
    }

    @Test
    void fileStorageDefaultsToLocalAndRejectsIncompleteAliyunOss() throws IOException {
        StandardEnvironment localEnv = environment(localValues());
        FileStorageProperties localProps = Binder.get(localEnv)
                .bind("basic-framework.file", FileStorageProperties.class).get();
        assertFalse(localProps.isAliyunOss());
        assertTrue(localProps.isProviderValid());
        assertTrue(localProps.isAliyunOssConfigComplete());

        Map<String, Object> ossValues = localValues();
        ossValues.put("FILE_STORAGE_PROVIDER", "aliyun-oss");
        StandardEnvironment ossEnv = environment(ossValues);
        FileStorageProperties incompleteOss = Binder.get(ossEnv)
                .bind("basic-framework.file", FileStorageProperties.class).get();
        assertTrue(incompleteOss.isAliyunOss());
        assertFalse(incompleteOss.isAliyunOssConfigComplete());
    }

    @Test
    void envExampleKeysAreAllConsumedByServerConfiguration() throws IOException {
        Path envExample = resolveEnvExample();
        Set<String> declaredKeys = parseEnvKeys(Files.readAllLines(envExample, StandardCharsets.UTF_8));
        assertFalse(declaredKeys.isEmpty(), ".env.example 不得为空");
        Set<String> referencedKeys = loadReferencedPlaceholders();
        Set<String> unmapped = findUnmappedKeys(declaredKeys, referencedKeys);
        assertTrue(unmapped.isEmpty(), ".env.example 存在未被配置消费的悬空变量：" + unmapped);
    }

    @Test
    void unmappedEnvExampleKeyIsDetected() throws IOException {
        Set<String> declared = parseEnvKeys(List.of(
                "# 注释行不计入",
                "SERVER_PORT=48080",
                "UNMAPPED_GHOST_SWITCH=true"));
        Set<String> unmapped = findUnmappedKeys(declared, loadReferencedPlaceholders());
        assertEquals(Set.of("UNMAPPED_GHOST_SWITCH"), unmapped);
    }

    private static Path resolveEnvExample() {
        Path fromModule = Path.of("..", ".env.example").normalize();
        if (Files.isRegularFile(fromModule)) {
            return fromModule;
        }
        Path fromReactor = Path.of(".env.example").normalize();
        assertTrue(Files.isRegularFile(fromReactor), "未找到后端 .env.example");
        return fromReactor;
    }

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

    private static Set<String> loadReferencedPlaceholders() throws IOException {
        Set<String> referenced = new LinkedHashSet<>();
        for (String resourceName : List.of("application.yaml", "application-local.yaml", "logback-spring.xml")) {
            String content = new ClassPathResource(resourceName).getContentAsString(StandardCharsets.UTF_8);
            Matcher matcher = PLACEHOLDER_PATTERN.matcher(content);
            while (matcher.find()) {
                referenced.add(matcher.group(1));
            }
        }
        return referenced;
    }

    private static StandardEnvironment configDataEnvironment(Map<String, Object> values) throws IOException {
        Path configDir = Files.createTempDirectory(configDataRoot, "config-data");
        String configLocation = "file:" + configDir.toAbsolutePath().toString().replace('\\', '/') + "/";
        Pattern dotenvImport = Pattern.compile("(?:optional:)?file:(\\.\\./)?\\.env(?![\\w.-])");
        int redirected = 0;
        for (String resourceName : List.of("application.yaml", "application-local.yaml")) {
            String content = new ClassPathResource(resourceName).getContentAsString(StandardCharsets.UTF_8);
            Matcher matcher = dotenvImport.matcher(content);
            StringBuilder isolated = new StringBuilder();
            while (matcher.find()) {
                String target = configLocation + (matcher.group(1) == null ? ".env" : "parent/.env");
                matcher.appendReplacement(isolated, Matcher.quoteReplacement("optional:" + target));
                redirected++;
            }
            matcher.appendTail(isolated);
            Files.writeString(configDir.resolve(resourceName), isolated, StandardCharsets.UTF_8);
        }
        assertEquals(2, redirected, "both dotenv imports must be redirected into the temp directory");
        StandardEnvironment environment = new StandardEnvironment();
        MutablePropertySources sources = environment.getPropertySources();
        sources.remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
        sources.remove(StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
        Map<String, Object> source = new HashMap<>(values);
        source.put("spring.config.location", configLocation);
        sources.addFirst(new MapPropertySource("configDataTest", source));
        ConfigDataEnvironmentPostProcessor.applyTo(environment);
        return environment;
    }

    private static void assertActiveProfile(StandardEnvironment environment, String expected, String unexpected) {
        List<String> active = List.of(environment.getActiveProfiles());
        assertTrue(active.contains(expected), () -> "active profiles: " + active);
        assertFalse(active.contains(unexpected), () -> "active profiles: " + active);
    }

    private static void assertProductionDatasourceUrl(StandardEnvironment environment) {
        String url = environment.getProperty("spring.datasource.url");
        assertTrue(url.contains("sslMode=VERIFY_IDENTITY"), url);
        assertTrue(url.contains("allowPublicKeyRetrieval=false"), url);
    }

    private static Set<String> findUnmappedKeys(Set<String> declaredKeys, Set<String> referencedKeys) {
        Set<String> unmapped = new LinkedHashSet<>(declaredKeys);
        unmapped.removeAll(referencedKeys);
        return unmapped;
    }

    private static StandardEnvironment environment(Map<String, Object> values) throws IOException {
        return environment(values, false);
    }

    private static StandardEnvironment environment(Map<String, Object> values, boolean includeLocalProfile)
            throws IOException {
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
        environment.getPropertySources().remove(StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
        environment.getPropertySources().addFirst(new MapPropertySource("test-env", values));
        YamlPropertySourceLoader loader = new YamlPropertySourceLoader();
        if (includeLocalProfile) {
            loader.load("application-local", new ClassPathResource("application-local.yaml"))
                    .forEach(environment.getPropertySources()::addLast);
        }
        loader.load("application", new ClassPathResource("application.yaml"))
                .forEach(environment.getPropertySources()::addLast);
        return environment;
    }

    private static Map<String, Object> localValues() {
        Map<String, Object> values = new HashMap<>();
        values.put("DB_HOST", "127.0.0.1");
        values.put("DB_PORT", "3306");
        values.put("DB_NAME", "framework_test");
        values.put("DB_USERNAME", "framework_user");
        values.put("DB_PASSWORD", "test-" + UUID.randomUUID());
        values.put("REDIS_PASSWORD", "test-" + UUID.randomUUID());
        return values;
    }

}
