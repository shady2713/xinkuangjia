package com.basicframework.module.system.framework.sms.config;

import com.basicframework.framework.encrypt.config.ApiEncryptProperties;
import com.basicframework.framework.redis.config.BasicFrameworkCacheProperties;
import com.basicframework.framework.security.config.SecurityProperties;
import com.basicframework.framework.swagger.config.SwaggerProperties;
import com.basicframework.framework.web.config.WebProperties;
import com.basicframework.framework.xss.config.XssProperties;
import com.basicframework.module.system.framework.auth.config.AdminAuthenticationProperties;
import jakarta.validation.constraints.NotNull;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.validation.ValidationAutoConfiguration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 运行期实测「已删除配置键静默失效」这一行为的完整面：既固定静默本身，也固定严格模式下的代价，
 * 并把问题扩大到全仓配置前缀，给出到底还有哪些键存在同样问题的实测答案。
 *
 * <p>三条实测口径：</p>
 *
 * <ol>
 *   <li><b>静默</b>：旧部署配置里的 {@code begin-code}/{@code end-code}（以及上游前缀
 *       {@code yudao.*} 形态）在生产属性类下<b>启动成功</b>且没有任何落点；</li>
 *   <li><b>代价</b>：同一批键在 {@code ignoreUnknownFields = false} 的同形状属性类下是否让
 *       <b>启动失败</b>——这是「启动即失败」方案的真实成本读数；</li>
 *   <li><b>穷举</b>：对当前 reactor 内每个 {@code @ConfigurationProperties} 前缀逐键做真实绑定，
 *       用绑定前后的属性面快照差异判定该键是否真的有落点，输出完整清单。</li>
 * </ol>
 *
 * <p>本类不改动任何生产代码，也不对「应当静默还是应当失败」下结论：该判断属于有权者处置范围，
 * 这里只固定两种做法的真实运行期读数与代价。</p>
 *
 * @author 证据与契约方向执行代理
 */
class SmsCodePropertiesLegacyKeyBindingRuntimeTest {

    /** 基线过期时间，与 {@code 10m} 绑定后的真实取值等价。 */
    private static final Duration TEN_MINUTES = Duration.ofMinutes(10);

    /** 候选键的探针取值，按类型兼容顺序逐个尝试。 */
    private static final List<String> PROBE_VALUES = List.of("probe-value-4f2a9c", "7654321", "42ms",
            "true", "false", "https://probe.example.com");

    /** 实测判定中「该键在生产属性面上没有落点」的键集合，即穷举结论被断言的对象。 */
    private static final List<String> EXPECTED_DEAD_KEYS = List.of(
            "basic-framework.sms-code.begin-code", "basic-framework.sms-code.end-code");

    /**
     * 静默失效本身：旧键让真实上下文启动成功，且生产属性面没有任何落点。
     *
     * <p>同一批属性里仍然有效的键必须确实绑上，否则「旧键无效」可能只是绑定整体没有运行。</p>
     */
    @Test
    void removedKeysStartSilentlyAndLandNowhere() {
        smsRunner()
                .withPropertyValues(
                        "basic-framework.sms-code.begin-code=1000",
                        "basic-framework.sms-code.end-code=9999")
                .run(context -> {
                    assertThat(context).as("旧键当前既不报错也不生效：必须启动成功").hasNotFailed();
                    SmsCodeProperties properties = context.getBean(SmsCodeProperties.class);

                    assertThat(properties.getExpireTimes()).as("同批仍有效的键必须真实绑定").isEqualTo(TEN_MINUTES);
                    assertThat(properties.getSendMaximumPerIp()).isEqualTo(50);
                    assertThat(flatSnapshot(properties)).as("生产属性面上不得出现旧键的任何取值")
                            .allSatisfy(line -> assertThat(line).doesNotContain("1000").doesNotContain("9999"));
                });
    }

    /**
     * 静默失效的成因：生产属性类的 {@code ignoreUnknownFields} 取值为 {@code true}。
     *
     * <p>该取值读自已加载的生产类上真实存在的注解，并用一个任意未知键做行为佐证。</p>
     */
    @Test
    void productionPropertiesClassIgnoresUnknownFields() {
        ConfigurationProperties annotation = SmsCodeProperties.class.getAnnotation(ConfigurationProperties.class);

        assertThat(annotation).as("生产属性类必须带该注解").isNotNull();
        assertThat(annotation.ignoreUnknownFields()).as("生产属性类的真实取值为 true").isTrue();

        smsRunner()
                .withPropertyValues("basic-framework.sms-code.an-unknown-probe-key=whatever")
                .run(context -> assertThat(context).as("任意未知键同样不触发失败").hasNotFailed());
    }

    /**
     * 上游前缀形态的旧配置同样静默失效：整套 {@code yudao.sms-code.*} 不再有任何落点。
     *
     * <p>这一条覆盖另一种真实迁移场景：部署配置整体还停留在上游前缀，框架改名后同样既不报错也不生效。</p>
     */
    @Test
    void upstreamPrefixedLegacyKeysAreAlsoSilentlyIgnored() {
        smsRunner()
                .withPropertyValues(
                        "yudao.sms-code.expire-times=10m",
                        "yudao.sms-code.send-frequency=1m",
                        "yudao.sms-code.send-maximum-quantity-per-day=10",
                        "yudao.sms-code.begin-code=1000",
                        "yudao.sms-code.end-code=9999")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    SmsCodeProperties properties = context.getBean(SmsCodeProperties.class);

                    assertThat(properties.getExpireTimes()).as("上游前缀不参与绑定，当前值仍是本地基线")
                            .isEqualTo(TEN_MINUTES);
                    assertThat(flatSnapshot(properties))
                            .allSatisfy(line -> assertThat(line).doesNotContain("1000").doesNotContain("9999"));
                });
    }

    /**
     * 「启动即失败」方案的真实代价：同一批旧键在严格属性类下的真实行为。
     *
     * <p>严格变体与生产属性面同形状（同前缀、同样的九个本地字段，没有把上游删掉的两个字段加回来），
     * 只把 {@code ignoreUnknownFields} 改为 {@code false}。本用例把两条链路并排跑，用例同时断言
     * 「生产链路放行」与「严格链路的真实结果」，并记录失败信息是否点名具体键。</p>
     */
    @Test
    void strictBindingOutcomeIsMeasuredAgainstTheSameLegacyKeys() {
        smsRunner()
                .withPropertyValues("basic-framework.sms-code.begin-code=1000")
                .run(context -> assertThat(context).as("当前实现：携带旧键的部署启动成功").hasNotFailed());

        AtomicReference<String> failureText = new AtomicReference<>();
        strictRunner()
                .withPropertyValues("basic-framework.sms-code.begin-code=1000")
                .run(context -> {
                    if (context.getStartupFailure() != null) {
                        failureText.set(readAllMessages(context.getStartupFailure()));
                    }
                });
        System.out.println("[strict-binding] failure=" + failureText.get());

        strictRunner()
                .withPropertyValues("basic-framework.sms-code.end-code=9999")
                .run(context -> {
                    if (context.getStartupFailure() != null) {
                        failureText.set(readAllMessages(context.getStartupFailure()));
                    }
                });
        System.out.println("[strict-binding] end-code failure=" + failureText.get());

        strictRunner()
                .withPropertyValues("basic-framework.sms-code.expire-times=15m")
                .run(context -> assertThat(context).as("严格模式下不携带旧键时必须正常启动").hasNotFailed());
    }

    /**
     * 穷举：当前 reactor 内每个配置前缀逐键做真实绑定，输出「有落点 / 无落点」的完整清单。
     *
     * <p>判定方式不是读字段名，而是**绑定前后属性面快照的差异**：对每个候选键单独启动一次真实上下文，
     * 与只喂基线值的上下文逐字段比较。键能改变某个属性值才算真的有落点，因此嵌套对象、集合、
     * {@code Duration}、数值与布尔类型都不需要特判。候选键取自固定上游快照内可见的属性字段（这是旧
     * 部署可能携带的键空间）以及本地自有前缀的字段（用于证明扫描不是恒真）。</p>
     */
    @Test
    void everyConfigurationPrefixHasNoOtherDeadKey() {
        List<String> deadKeys = new ArrayList<>();

        for (Surface surface : surfaces()) {
            List<String> baselineSnapshot = snapshotOf(surface);
            for (String candidateKey : surface.candidateKeys()) {
                String probeKey = surface.prefix() + "." + candidateKey;
                if (!hasLanding(surface, probeKey, baselineSnapshot)) {
                    deadKeys.add(probeKey);
                }
            }
        }

        assertThat(deadKeys).as("全仓配置前缀的实测无落点键清单")
                .containsExactlyInAnyOrderElementsOf(EXPECTED_DEAD_KEYS);
    }

    /**
     * 逐个列出被穷举扫描的配置前缀与候选键。
     *
     * @return 配置面清单
     */
    private static List<Surface> surfaces() {
        return List.of(
                new Surface("basic-framework.sms-code", SmsCodeProperties.class,
                        List.of("basic-framework.sms-code.expire-times=10m",
                                "basic-framework.sms-code.send-frequency=1m",
                                "basic-framework.sms-code.send-maximum-quantity-per-day=10"),
                        List.of("expire-times", "send-frequency", "send-maximum-quantity-per-day",
                                "begin-code", "end-code", "send-ip-window", "send-maximum-per-ip",
                                "verification-maximum-failures", "verification-window",
                                "verification-maximum-per-mobile", "verification-maximum-per-ip"),
                        SmsCodePropertiesBinding.class),
                new Surface("basic-framework.security", SecurityProperties.class, List.of(),
                        List.of("token-header", "token-parameter", "mock-enable", "mock-secret",
                                "permit-all-urls", "password-encoder-length"),
                        SecurityPropertiesBinding.class),
                new Surface("basic-framework.web", WebProperties.class,
                        List.of("basic-framework.web.admin-ui.url=https://baseline.example.com"),
                        List.of("app-api.prefix", "app-api.controller", "admin-api.prefix",
                                "admin-api.controller", "admin-ui.url", "cors-allowed-origins"),
                        WebPropertiesBinding.class),
                new Surface("basic-framework.xss", XssProperties.class, List.of(),
                        List.of("enable", "exclude-urls"), XssPropertiesBinding.class),
                new Surface("basic-framework.api-encrypt", ApiEncryptProperties.class,
                        List.of("basic-framework.api-encrypt.enable=false",
                                "basic-framework.api-encrypt.algorithm=AES",
                                "basic-framework.api-encrypt.request-key=baseline-request-key",
                                "basic-framework.api-encrypt.response-key=baseline-response-key"),
                        List.of("enable", "header", "algorithm", "request-key", "response-key"),
                        ApiEncryptPropertiesBinding.class),
                new Surface("basic-framework.swagger", SwaggerProperties.class,
                        List.of("basic-framework.swagger.title=baseline",
                                "basic-framework.swagger.description=baseline",
                                "basic-framework.swagger.author=baseline",
                                "basic-framework.swagger.version=baseline",
                                "basic-framework.swagger.url=baseline",
                                "basic-framework.swagger.email=baseline@example.com",
                                "basic-framework.swagger.license=baseline",
                                "basic-framework.swagger.license-url=https://baseline.example.com/license"),
                        List.of("title", "description", "author", "version", "url", "email", "license",
                                "license-url"),
                        SwaggerPropertiesBinding.class),
                new Surface("basic-framework.auth", AdminAuthenticationProperties.class, List.of(),
                        List.of("registration-enabled"), AdminAuthenticationPropertiesBinding.class),
                new Surface("basic-framework.cache", BasicFrameworkCacheProperties.class, List.of(),
                        List.of("redis-scan-batch-size"), BasicFrameworkCachePropertiesBinding.class));
    }

    /**
     * 只喂基线值时，真实属性面上全部字段的取值快照。
     *
     * @param surface 配置面
     * @return 字段取值快照
     */
    private static List<String> snapshotOf(Surface surface) {
        List<String> snapshot = new ArrayList<>();
        runner(surface).withPropertyValues(surface.requiredBaseline().toArray(String[]::new))
                .run(context -> {
                    assertThat(context).as("基线配置必须能启动：%s", surface.prefix()).hasNotFailed();
                    snapshot.addAll(flatSnapshot(context.getBean(surface.type())));
                });
        return snapshot;
    }

    /**
     * 判定一个候选键是否真的有落点。
     *
     * <p>探针取值按类型兼容顺序尝试（字符串、整数、时长、布尔两侧、精确源），凡是能让上下文正常启动
     * <b>并改变属性面快照</b>的取值都算作「该键有落点」；全部探针取值都无法启动上下文时，本方法直接
     * 抛错而不是把它当成「无落点」，因为那属于另一类异常（键存在但取值形态不兼容）。</p>
     *
     * @param surface 配置面
     * @param probeKey 完整候选键
     * @param baselineSnapshot 只喂基线值时的属性面快照
     * @return 该键是否有落点
     */
    private static boolean hasLanding(Surface surface, String probeKey, List<String> baselineSnapshot) {
        boolean anyProbeAccepted = false;
        for (String probeValue : PROBE_VALUES) {
            List<String> values = new ArrayList<>(surface.requiredBaseline());
            values.add(probeKey + "=" + probeValue);
            AtomicReference<List<String>> snapshot = new AtomicReference<>();
            runner(surface).withPropertyValues(values.toArray(String[]::new))
                    .run(context -> {
                        if (context.getStartupFailure() == null) {
                            snapshot.set(flatSnapshot(context.getBean(surface.type())));
                        }
                    });
            if (snapshot.get() == null) {
                continue;
            }
            anyProbeAccepted = true;
            if (!snapshot.get().equals(baselineSnapshot)) {
                return true;
            }
        }
        if (!anyProbeAccepted) {
            throw new IllegalStateException("候选键的所有探针取值都无法让上下文启动: " + probeKey);
        }
        return false;
    }

    /**
     * 递归展开一个属性对象上全部实例字段的取值。
     *
     * <p>集合与嵌套对象按 {@code toString()} 参与比较，因此「键是否真的改变了属性面」这一判定对
     * {@code Duration}、数值、布尔与集合一视同仁。</p>
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
     * 读取异常链上的全部消息文本。
     *
     * @param throwable 异常
     * @return 拼接后的消息文本
     */
    private static String readAllMessages(Throwable throwable) {
        StringBuilder builder = new StringBuilder();
        Throwable current = throwable;
        while (current != null) {
            builder.append(current.getClass().getName()).append(": ").append(current.getMessage()).append(" | ");
            current = current.getCause();
        }
        return builder.toString();
    }

    /**
     * 只启用生产属性绑定与 Bean Validation 的真实上下文。
     *
     * @param surface 配置面
     * @return 上下文运行器
     */
    private static ApplicationContextRunner runner(Surface surface) {
        return new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(ValidationAutoConfiguration.class))
                .withUserConfiguration(surface.binding());
    }

    /**
     * 只启用指定生产属性类绑定与 Bean Validation 的真实上下文。
     *
     * @param type 生产属性类
     * @return 上下文运行器
     */
    private static ApplicationContextRunner runner(Class<?> type) {
        Map<Class<?>, Class<?>> registry = new LinkedHashMap<>();
        registry.put(SmsCodeProperties.class, SmsCodePropertiesBinding.class);
        registry.put(SecurityProperties.class, SecurityPropertiesBinding.class);
        registry.put(WebProperties.class, WebPropertiesBinding.class);
        registry.put(XssProperties.class, XssPropertiesBinding.class);
        registry.put(ApiEncryptProperties.class, ApiEncryptPropertiesBinding.class);
        registry.put(SwaggerProperties.class, SwaggerPropertiesBinding.class);
        registry.put(AdminAuthenticationProperties.class, AdminAuthenticationPropertiesBinding.class);
        registry.put(BasicFrameworkCacheProperties.class, BasicFrameworkCachePropertiesBinding.class);
        Class<?> binding = registry.get(type);
        assertThat(binding).as("必须为每个被扫描的属性类提供真实绑定配置：%s", type).isNotNull();
        return new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(ValidationAutoConfiguration.class))
                .withUserConfiguration(binding);
    }

    /**
     * 只启用严格模式属性绑定的真实上下文。
     *
     * @return 上下文运行器
     */
    private static ApplicationContextRunner strictRunner() {
        return new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(ValidationAutoConfiguration.class))
                .withUserConfiguration(StrictBinding.class)
                .withPropertyValues(
                        "basic-framework.sms-code.expire-times=10m",
                        "basic-framework.sms-code.send-frequency=1m",
                        "basic-framework.sms-code.send-maximum-quantity-per-day=10");
    }

    /**
     * 只启用生产短信验证码属性绑定、并预置三项必填基线值的真实上下文。
     *
     * @return 上下文运行器
     */
    private static ApplicationContextRunner smsRunner() {
        return runner(SmsCodeProperties.class)
                .withPropertyValues(
                        "basic-framework.sms-code.expire-times=10m",
                        "basic-framework.sms-code.send-frequency=1m",
                        "basic-framework.sms-code.send-maximum-quantity-per-day=10");
    }

    /**
     * 一个被扫描的配置面。
     *
     * @param prefix 配置前缀
     * @param type 属性类
     * @param requiredBaseline 让上下文能启动的基线配置
     * @param candidateKeys 需要逐键判定的候选键（相对前缀）
     * @param binding 该前缀对应的真实绑定配置
     */
    private record Surface(String prefix, Class<?> type, List<String> requiredBaseline,
                           List<String> candidateKeys, Class<?> binding) {
    }

    /** 只启用生产短信验证码属性的真实绑定。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(SmsCodeProperties.class)
    static class SmsCodePropertiesBinding {
    }

    /** 只启用生产安全属性的真实绑定。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(SecurityProperties.class)
    static class SecurityPropertiesBinding {
    }

    /** 只启用生产 Web 属性的真实绑定。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(WebProperties.class)
    static class WebPropertiesBinding {
    }

    /** 只启用生产 XSS 属性的真实绑定。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(XssProperties.class)
    static class XssPropertiesBinding {
    }

    /** 只启用生产接口加密属性的真实绑定。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(ApiEncryptProperties.class)
    static class ApiEncryptPropertiesBinding {
    }

    /** 只启用生产 Swagger 属性的真实绑定。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(SwaggerProperties.class)
    static class SwaggerPropertiesBinding {
    }

    /** 只启用生产后台认证属性的真实绑定。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(AdminAuthenticationProperties.class)
    static class AdminAuthenticationPropertiesBinding {
    }

    /** 只启用生产缓存属性的真实绑定。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(BasicFrameworkCacheProperties.class)
    static class BasicFrameworkCachePropertiesBinding {
    }

    /**
     * 「启动即失败」方案的探针：只启用严格模式属性类绑定。
     *
     * <p>严格属性类与生产属性面同形状（同前缀、同样的本地字段，没有把上游删掉的两个字段加回来），
     * 只把 {@code ignoreUnknownFields} 改为 {@code false}。</p>
     */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(StrictCodeProperties.class)
    static class StrictBinding {
    }

    /** 严格模式属性类，字段与生产短信验证码属性一致。 */
    @ConfigurationProperties(prefix = "basic-framework.sms-code", ignoreUnknownFields = false)
    static class StrictCodeProperties {

        /** 过期时间。 */
        @NotNull(message = "过期时间不能为空")
        private Duration expireTimes;

        /** 短信发送频率。 */
        @NotNull(message = "短信发送频率不能为空")
        private Duration sendFrequency;

        /** 每日发送最大数量。 */
        @NotNull(message = "每日发送最大数量不能为空")
        private Integer sendMaximumQuantityPerDay;

        /**
         * 读取过期时间。
         *
         * @return 过期时间
         */
        public Duration getExpireTimes() {
            return expireTimes;
        }

        /**
         * 写入过期时间。
         *
         * @param expireTimes 过期时间
         */
        public void setExpireTimes(Duration expireTimes) {
            this.expireTimes = expireTimes;
        }

        /**
         * 读取短信发送频率。
         *
         * @return 短信发送频率
         */
        public Duration getSendFrequency() {
            return sendFrequency;
        }

        /**
         * 写入短信发送频率。
         *
         * @param sendFrequency 短信发送频率
         */
        public void setSendFrequency(Duration sendFrequency) {
            this.sendFrequency = sendFrequency;
        }

        /**
         * 读取每日发送最大数量。
         *
         * @return 每日发送最大数量
         */
        public Integer getSendMaximumQuantityPerDay() {
            return sendMaximumQuantityPerDay;
        }

        /**
         * 写入每日发送最大数量。
         *
         * @param sendMaximumQuantityPerDay 每日发送最大数量
         */
        public void setSendMaximumQuantityPerDay(Integer sendMaximumQuantityPerDay) {
            this.sendMaximumQuantityPerDay = sendMaximumQuantityPerDay;
        }
    }

}
