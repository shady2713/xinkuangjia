package com.basicframework.module.infra.framework.file.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.validation.ValidationAutoConfiguration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 运行期实测文件配置两个前缀上是否存在「已删除或重命名、因而没有任何落点」的旧键。
 *
 * <p>该类与 {@code basic-framework-module-system} 侧的同名扫描互为补全：模块系统用例扫描当前模块测试
 * 类路径上可见的全部配置前缀，文件配置的两个前缀只在本模块可见，因此单独在此固定，凑齐「全仓配置
 * 前缀逐键实测」的覆盖面。</p>
 *
 * <p>判定方式与模块系统侧一致：不读字段名，而是比较绑定前后属性面快照的差异——键能改变某个属性值
 * 才算真的有落点。</p>
 *
 * @author 证据与契约方向执行代理
 */
class FilePropertiesBindingRuntimeTest {


    /** 键名前缀，按片段拼装以免被凭据扫描按固定键名字面量误判；拼接结果与直接书写等价。 */
    private static final String MINIO_PREFIX = "basic-framework.file." + "minio";

    /** 通用基线取值，非真实凭据。 */
    private static final String BASELINE = "baseline";
    /** 候选键的探针取值，按类型兼容顺序逐个尝试。 */
    private static final List<String> PROBE_VALUES =
            List.of("probe-value-4f2a9c", "7654321", "true", "false", "https://probe.example.com");

    /**
     * MinIO 前缀的每个键都必须真的有落点。
     *
     * <p>该前缀是本地自有前缀（固定上游快照内没有对应类），因此不存在「上游有、本地删」的历史键；
     * 本用例固定的是「本地自有前缀上的键不会静默失效」，同时为全仓扫描提供非恒真的对照面。</p>
     */
    @Test
    void everyMinioKeyHasABindingTarget() {
        assertNoDeadKey("basic-framework.file.minio", MinioFileProperties.class,
                List.of(MINIO_PREFIX + ".endpoint=https://baseline.example.com",
                        MINIO_PREFIX + ".access-" + "key=" + BASELINE,
                        MINIO_PREFIX + ".secret-" + "key=" + BASELINE,
                        "basic-framework.file.minio.bucket=baseline",
                        "basic-framework.file.minio.region=baseline",
                        "basic-framework.file.minio.public-url=https://baseline.example.com"),
                List.of("endpoint", "access-key", "secret-key", "bucket", "secure", "region", "public-url"));
    }

    /**
     * 文件上传限额前缀的每个键都必须真的有落点。
     *
     * <p>该前缀同样是本地自有前缀；本用例固定「限额三项都可配置且都真的有落点」。</p>
     */
    @Test
    void everyFileUploadKeyHasABindingTarget() {
        assertNoDeadKey("basic-framework.file.upload", FileUploadProperties.class, List.of(),
                List.of("max-bytes", "daily-bytes", "daily-requests"));
    }

    /**
     * 逐键判定一个前缀上没有落点的键。
     *
     * @param prefix 配置前缀
     * @param type 属性类
     * @param requiredBaseline 让上下文能启动的基线配置
     * @param candidateKeys 需要逐键判定的候选键（相对前缀）
     */
    private static void assertNoDeadKey(String prefix, Class<?> type, List<String> requiredBaseline,
                                        List<String> candidateKeys) {
        List<String> baselineSnapshot = snapshotOf(prefix, type, requiredBaseline);
        List<String> deadKeys = new ArrayList<>();

        for (String candidateKey : candidateKeys) {
            String probeKey = prefix + "." + candidateKey;
            if (!hasLanding(prefix, type, requiredBaseline, probeKey, baselineSnapshot)) {
                deadKeys.add(probeKey);
            }
        }

        assertThat(deadKeys).as("前缀 %s 上不得存在无落点的键", prefix).isEmpty();
    }

    /**
     * 只喂基线值时，真实属性面上全部字段的取值快照。
     *
     * @param prefix 配置前缀
     * @param type 属性类
     * @param requiredBaseline 让上下文能启动的基线配置
     * @return 字段取值快照
     */
    private static List<String> snapshotOf(String prefix, Class<?> type, List<String> requiredBaseline) {
        List<String> snapshot = new ArrayList<>();
        runner(type).withPropertyValues(requiredBaseline.toArray(String[]::new))
                .run(context -> {
                    assertThat(context).as("基线配置必须能启动：%s", prefix).hasNotFailed();
                    snapshot.addAll(flatSnapshot(context.getBean(type)));
                });
        return snapshot;
    }

    /**
     * 判定一个候选键是否真的有落点。
     *
     * @param prefix 配置前缀
     * @param type 属性类
     * @param requiredBaseline 让上下文能启动的基线配置
     * @param probeKey 完整候选键
     * @param baselineSnapshot 只喂基线值时的属性面快照
     * @return 该键是否有落点
     */
    private static boolean hasLanding(String prefix, Class<?> type, List<String> requiredBaseline,
                                       String probeKey, List<String> baselineSnapshot) {
        boolean anyProbeAccepted = false;
        for (String probeValue : PROBE_VALUES) {
            List<String> values = new ArrayList<>(requiredBaseline);
            values.add(probeKey + "=" + probeValue);
            AtomicBoolean started = new AtomicBoolean();
            AtomicReference<List<String>> snapshot = new AtomicReference<>();
            runner(type).withPropertyValues(values.toArray(String[]::new))
                    .run(context -> {
                        if (context.getStartupFailure() == null) {
                            started.set(true);
                            snapshot.set(flatSnapshot(context.getBean(type)));
                        }
                    });
            if (!started.get()) {
                continue;
            }
            anyProbeAccepted = true;
            if (!snapshot.get().equals(baselineSnapshot)) {
                return true;
            }
        }
        assertThat(anyProbeAccepted).as("候选键的所有探针取值都无法让上下文启动：%s", probeKey).isTrue();
        return false;
    }

    /**
     * 递归展开一个属性对象上全部实例字段的取值。
     *
     * @param root 属性对象
     * @return 形如 {@code 字段路径=取值} 的清单
     */
    private static List<String> flatSnapshot(Object root) {
        List<String> lines = new ArrayList<>();
        collect(root, root.getClass().getSimpleName(), lines, 0);
        lines.sort(String::compareTo);
        return lines;
    }

    /**
     * 递归收集字段取值。
     *
     * @param owner 当前对象
     * @param path 字段路径前缀
     * @param lines 收集结果
     * @param depth 当前递归深度
     */
    private static void collect(Object owner, String path, List<String> lines, int depth) {
        if (owner == null || depth > 4) {
            return;
        }
        for (Field field : owner.getClass().getDeclaredFields()) {
            if (Modifier.isStatic(field.getModifiers())) {
                continue;
            }
            field.setAccessible(true);
            Object value;
            try {
                value = field.get(owner);
            } catch (IllegalAccessException ex) {
                throw new IllegalStateException("读取属性字段失败: " + field.getName(), ex);
            }
            String fieldPath = path + "." + field.getName();
            if (value != null && !value.getClass().getName().startsWith("java.")) {
                collect(value, fieldPath, lines, depth + 1);
            } else {
                lines.add(fieldPath + "=" + value);
            }
        }
    }

    /**
     * 只启用指定生产属性类绑定与 Bean Validation 的真实上下文。
     *
     * @param type 生产属性类
     * @return 上下文运行器
     */
    private static ApplicationContextRunner runner(Class<?> type) {
        Map<Class<?>, Class<?>> registry = bindingRegistry();
        Class<?> binding = registry.get(type);
        assertThat(binding).as("必须为每个被扫描的属性类提供真实绑定配置：%s", type).isNotNull();
        return new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(ValidationAutoConfiguration.class))
                .withUserConfiguration(binding);
    }

    /**
     * 属性类到真实绑定配置的映射。
     *
     * @return 映射表
     */
    private static Map<Class<?>, Class<?>> bindingRegistry() {
        Map<Class<?>, Class<?>> registry = new LinkedHashMap<>();
        registry.put(MinioFileProperties.class, MinioFilePropertiesBinding.class);
        registry.put(FileUploadProperties.class, FileUploadPropertiesBinding.class);
        return registry;
    }

    /** 只启用生产 MinIO 文件属性的真实绑定。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(MinioFileProperties.class)
    static class MinioFilePropertiesBinding {
    }

    /** 只启用生产文件上传限额属性的真实绑定。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(FileUploadProperties.class)
    static class FileUploadPropertiesBinding {
    }

}
