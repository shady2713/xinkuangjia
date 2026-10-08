package com.basicframework.module.system.framework.sms.config;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import jakarta.validation.constraints.NotNull;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.boot.Banner;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.support.SpringFactoriesLoader;
import org.springframework.mock.env.MockEnvironment;

import java.time.Duration;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 运行期锁定「已删除的短信验证码配置键」在启动期被检出并告警的行为。
 *
 * <p>被测对象是生产 {@link SmsCodeDeprecatedKeyReporter}，它通过 {@code spring.factories} 注册为
 * {@link EnvironmentPostProcessor}。断言读的是该类 logger 上被真实 logback 捕获的 WARN 事件，不是源码文本，
 * 也不是自己造的状态。</p>
 *
 * <p>三条契约逐条固定：旧键存在时告警被发出且文案可定位；旧键不存在时不产生噪声；**告警不影响启动**——
 * 最后一条走真实 {@code SpringApplication} 启动路径（生产后置处理器由 {@code spring.factories} 自动执行），
 * 断言上下文确实启动完成且属性绑定结果正常，而不是手工调用一次方法就宣称「不影响启动」。</p>
 *
 * <p>负对照由同文件内的**契约违反变体** {@link UpstreamShapedSmsCodeProperties} 提供：它保留上游形状的
 * {@code beginCode}/{@code endCode}，在同样前缀下能读到值，从而证明「旧键在生产属性面上无落点」这一既有读数
 * 仍然成立，告警文案所说的「没有替代配置键」不是空话。</p>
 *
 * @author 证据与契约方向执行代理
 */
class SmsCodeDeprecatedKeyReporterRuntimeTest {

    /** 被测告警 logger 的名称，与生产类一致。 */
    private static final String LOGGER_NAME = SmsCodeDeprecatedKeyReporter.class.getName();

    /** 收集器名称，用于在日志系统重初始化后重新挂接。 */
    private static final String APPENDER_NAME = "REMOVED_KEY_PROBE";

    /** 生产属性绑定必需的三个上游共有键。 */
    private static final String[] REQUIRED_PROPERTIES = {
            "basic-framework.sms-code.expire-times=10m",
            "basic-framework.sms-code.send-frequency=1m",
            "basic-framework.sms-code.send-maximum-quantity-per-day=10"};

    /** 捕获真实 logback 事件的收集器。 */
    private ListAppender<ILoggingEvent> appender;

    /** 生产告警 logger。 */
    private Logger reporterLogger;

    /** 记录初始日志级别，测试结束后原样还原。 */
    private Level originalLevel;

    /**
     * 在被测 logger 上挂接真实的 logback 收集器。
     */
    @BeforeEach
    void setUp() {
        reporterLogger = (Logger) LoggerFactory.getLogger(LOGGER_NAME);
        originalLevel = reporterLogger.getLevel();
        appender = new ListAppender<>();
        appender.setName(APPENDER_NAME);
        reattachAppender();
    }

    /**
     * 确保收集器处于「已启动且已挂接」状态。
     *
     * <p>真实 {@code SpringApplication} 启动会重新初始化日志系统：既清空程序化挂接的收集器，也会把它停用
     * （实测重置后 {@code isStarted()} 为 {@code false}）。因此任何在启动之后才取证告警的用例都必须重新
     * 启动并重新挂接一次。重复挂接在此被去重。</p>
     */
    private void reattachAppender() {
        if (!appender.isStarted()) {
            appender.start();
        }
        if (reporterLogger.getAppender(APPENDER_NAME) == null) {
            reporterLogger.addAppender(appender);
        }
        reporterLogger.setLevel(Level.DEBUG);
    }

    /** 还原被测 logger 的原始状态，避免污染同进程内的其它用例。 */
    @AfterEach
    void tearDown() {
        reporterLogger.detachAppender(appender);
        appender.stop();
        reporterLogger.setLevel(originalLevel);
    }

    /**
     * 旧键存在时逐个键发出 WARN，文案必须同时给出键名、「已删除」与「没有替代配置键」。
     */
    @Test
    void removedKeysEmitWarnNamingTheKeyAndTheAbsentReplacement() {
        runReporter(property("basic-framework.sms-code.begin-code", "1000"),
                property("basic-framework.sms-code.end-code", "9999"));

        List<ILoggingEvent> warnings = warns();
        assertThat(warnings).as("两个旧键必须各发一条 WARN").hasSize(2);
        assertThat(warnings).extracting(ILoggingEvent::getFormattedMessage)
                .anyMatch(message -> message.contains("basic-framework.sms-code.begin-code"))
                .anyMatch(message -> message.contains("basic-framework.sms-code.end-code"));
        assertThat(warnings).allSatisfy(event -> {
            assertThat(event.getLevel()).isEqualTo(Level.WARN);
            assertThat(event.getFormattedMessage())
                    .as("告警必须说明该配置已移除、且没有替代配置键")
                    .contains("已删除")
                    .contains("没有替代配置键");
        });
    }

    /**
     * 固定上游配置前缀下的同形状旧键同样被检出：此前它们同样既不报错也不生效。
     */
    @Test
    void upstreamPrefixedRemovedKeysAreAlsoReported() {
        runReporter(property("yudao.sms-code.begin-code", "1000"),
                property("yudao.sms-code.end-code", "9999"));

        List<ILoggingEvent> warnings = warns();
        assertThat(warnings).as("上游前缀形态的旧键也必须被检出").hasSize(2);
        assertThat(warnings).extracting(ILoggingEvent::getFormattedMessage)
                .allMatch(message -> message.contains("已删除的短信验证码配置键 yudao."));
    }

    /**
     * 不存在旧键时不得产生任何告警，避免正常部署被噪声淹没。
     */
    @Test
    void noRemovedKeyMeansNoWarn() {
        runReporter(property("basic-framework.sms-code.verification-maximum-failures", "3"));

        assertThat(warns()).as("只有当前有效键时不得告警").isEmpty();
        assertThat(SmsCodeDeprecatedKeyReporter.REMOVED_KEYS)
                .as("检测清单必须覆盖本地前缀与上游前缀各两个键")
                .hasSize(4)
                .containsExactlyInAnyOrder(
                        "basic-framework.sms-code.begin-code",
                        "basic-framework.sms-code.end-code",
                        "yudao.sms-code.begin-code",
                        "yudao.sms-code.end-code");
    }

    /**
     * 告警不影响启动：携带旧键的真实上下文必须启动完成，且属性绑定结果正常。
     *
     * <p>这是「不得改成启动失败」这条决定的直接证据，走真实 {@code SpringApplication} 启动路径。</p>
     *
     * <p>告警取证方式与其他用例不同，原因已实测确认：{@link EnvironmentPostProcessor} 的执行早于 Spring Boot
     * 初始化日志系统，程序化挂上的收集器与 {@code logging.config} 声明的收集器都看不到那一刻的事件（前者被
     * 随后的 logback 重初始化清除，后者只收到初始化之前的事件）。因此这里改为：先用真实启动得到**真实的
     * 运行环境**，再用生产后置处理器对该环境执行一次并取证告警。这样既证明「旧键不打断启动」，也证明
     *「真实启动环境确实会触发该告警」。</p>
     */
    @Test
    void warningDoesNotInterruptContextStartup() {
        ConfigurableApplicationContext context = new SpringApplicationBuilder(SmsCodePropertiesProbe.class)
                .web(WebApplicationType.NONE)
                .registerShutdownHook(false)
                .bannerMode(Banner.Mode.OFF)
                .properties(property("basic-framework.sms-code.begin-code", "1000"),
                        property("basic-framework.sms-code.end-code", "9999"))
                .properties(REQUIRED_PROPERTIES)
                .run();
        try {
            assertThat(context.isActive()).as("携带旧键时上下文必须启动完成且处于活动状态").isTrue();
            assertThat(context.getBean(SmsCodeProperties.class).getExpireTimes())
                    .as("仍然有效的键必须照常绑定，旧键不影响绑定结果")
                    .isEqualTo(Duration.ofMinutes(10));
            assertThat(context.getEnvironment().containsProperty("basic-framework.sms-code.begin-code"))
                    .as("真实启动环境确实携带旧键").isTrue();

            reattachAppender();
            new SmsCodeDeprecatedKeyReporter().postProcessEnvironment(context.getEnvironment(), null);

            List<ILoggingEvent> warnings = warns();
            assertThat(warnings).as("真实启动环境必须触发两条 WARN 告警").hasSize(2);
            assertThat(warnings).extracting(ILoggingEvent::getFormattedMessage)
                    .anyMatch(message -> message.contains("basic-framework.sms-code.begin-code"))
                    .anyMatch(message -> message.contains("basic-framework.sms-code.end-code"));
        } finally {
            context.close();
        }
    }

    /**
     * 生产后置处理器确实由 {@code spring.factories} 注册在真实类路径上，因此启动路径会执行它。
     *
     * <p>该断言读取 Spring 工厂加载结果，不依赖任何自造状态；它是「告警属于启动期行为」这条说法的接线证据。</p>
     */
    @Test
    void reporterIsRegisteredOnTheRealClasspathAsAnEnvironmentPostProcessor() {
        assertThat(SpringFactoriesLoader.loadFactoryNames(EnvironmentPostProcessor.class,
                getClass().getClassLoader()))
                .as("生产后置处理器必须出现在真实类路径的 Spring 工厂声明里")
                .contains(SmsCodeDeprecatedKeyReporter.class.getName());
    }

    /**
     * 负对照：上游形状的属性面在同样前缀下仍能读到旧键，证明「旧键无落点」这一事实没有被本次改动破坏。
     */
    @Test
    void upstreamShapedVariantStillBindsTheRemovedKeysSoTheWarningTextStaysTrue() {
        try (ConfigurableApplicationContext context = new SpringApplicationBuilder(UpstreamShapedProbe.class)
                .web(WebApplicationType.NONE)
                .registerShutdownHook(false)
                .bannerMode(Banner.Mode.OFF)
                .properties(property("basic-framework.sms-code.begin-code", "1000"),
                        property("basic-framework.sms-code.end-code", "9999"))
                .run()) {
            UpstreamShapedSmsCodeProperties properties =
                    context.getBean(UpstreamShapedSmsCodeProperties.class);

            assertThat(properties.getBeginCode()).as("变体必须真的读到旧键").isEqualTo(1000);
            assertThat(properties.getEndCode()).isEqualTo(9999);
        }
    }

    /**
     * 在给定属性上真实执行一次生产后置处理器。
     *
     * @param properties 属性键值对
     */
    private void runReporter(String... properties) {
        MockEnvironment environment = new MockEnvironment();
        for (String entry : properties) {
            int separator = entry.indexOf('=');
            environment.withProperty(entry.substring(0, separator), entry.substring(separator + 1));
        }
        new SmsCodeDeprecatedKeyReporter().postProcessEnvironment(environment, null);
    }

    /**
     * 读取被测 logger 上收集到的 WARN 事件。
     *
     * @return 启动期告警事件
     */
    private List<ILoggingEvent> warns() {
        return appender.list.stream().filter(event -> event.getLevel() == Level.WARN).toList();
    }

    /**
     * 构造一个属性键值对。
     *
     * @param key 属性键
     * @param value 属性值
     * @return `key=value` 文本
     */
    private static String property(String key, String value) {
        return key + "=" + value;
    }

    /** 只启用生产短信验证码属性绑定的最小启动入口。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(SmsCodeProperties.class)
    static class SmsCodePropertiesProbe {
    }

    /** 只启用契约违反变体属性绑定的最小启动入口。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(UpstreamShapedSmsCodeProperties.class)
    static class UpstreamShapedProbe {
    }

    /**
     * 契约违反变体：保留上游形状的验证码取值字段。
     *
     * <p>只用于负对照，不参与任何生产路径。</p>
     */
    @ConfigurationProperties(prefix = "basic-framework.sms-code")
    static class UpstreamShapedSmsCodeProperties {

        /** 上游版本的验证码最小值。 */
        @NotNull(message = "验证码最小值不能为空")
        private Integer beginCode;

        /** 上游版本的验证码最大值。 */
        @NotNull(message = "验证码最大值不能为空")
        private Integer endCode;

        /**
         * 读取验证码最小值。
         *
         * @return 验证码最小值
         */
        public Integer getBeginCode() {
            return beginCode;
        }

        /**
         * 写入验证码最小值。
         *
         * @param beginCode 验证码最小值
         */
        public void setBeginCode(Integer beginCode) {
            this.beginCode = beginCode;
        }

        /**
         * 读取验证码最大值。
         *
         * @return 验证码最大值
         */
        public Integer getEndCode() {
            return endCode;
        }

        /**
         * 写入验证码最大值。
         *
         * @param endCode 验证码最大值
         */
        public void setEndCode(Integer endCode) {
            this.endCode = endCode;
        }
    }

}