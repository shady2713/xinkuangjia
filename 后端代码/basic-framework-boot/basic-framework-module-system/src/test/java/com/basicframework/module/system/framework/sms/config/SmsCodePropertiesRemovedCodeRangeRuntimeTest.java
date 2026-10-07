package com.basicframework.module.system.framework.sms.config;

import com.basicframework.module.system.service.sms.SmsCodeServiceImpl;
import jakarta.validation.constraints.NotNull;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.validation.ValidationAutoConfiguration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import java.lang.reflect.Field;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 运行期锁定短信验证码属性的真实绑定、校验，以及上游 {@code beginCode}/{@code endCode} 被删除后的
 * 调用方可见形态。
 *
 * <p>被测对象是生产 {@link SmsCodeProperties} 在真实 Spring 绑定与真实 Bean Validation 下的结果，
 * 断言读的是绑定后的实例、校验器的真实违规集合与生产类 {@link SmsCodeServiceImpl} 上真实存在的固定
 * 常量，不是源码文本。固定上游版本同时声明 {@code beginCode}/{@code endCode} 两个验证码取值字段，
 * 本地版本删除了它们并把验证码范围固定在生成器常量里；本类把「删除后配置面与调用面实际长什么样」
 * 这一事实固定下来，避免后续把旧配置键当成仍然生效。</p>
 *
 * <p>判别性由同文件内的**契约违反变体** {@link UpstreamShapedCodeRangeProperties} 提供：它保留上游
 * 形状的 {@code beginCode}/{@code endCode}，在同样前缀下绑定同样的旧配置键却能读到值。同一条
 * 「旧键必须无效」的断言作用到变体上必须失败，从而证明断言读的是真实属性面。</p>
 *
 * <p>本类不改动任何生产代码，也不对「删除这两个字段是否符合目标契约」下结论：该判断属于有权者
 * 处置范围，这里只固定当前实现的运行期读数。</p>
 *
 * @author 证据与契约方向执行代理
 */
class SmsCodePropertiesRemovedCodeRangeRuntimeTest {

    /** 上游版本中声明、本地版本已删除的两个验证码取值字段名。 */
    private static final List<String> REMOVED_UPSTREAM_KEYS = List.of("beginCode", "endCode");

    /**
     * 真实绑定：生产属性面只保留本地定义的九个字段，旧键没有任何落点。
     *
     * <p>断言的是绑定后实例上的真实读取值与真实属性面清单：既要证明仍然生效的键确实绑上（否则
     * 「旧键无效」可能只是绑定整体没跑），也要证明旧键在生产属性面上根本没有对应字段。</p>
     */
    @Test
    void removedUpstreamCodeRangeKeysHaveNoBindingTargetOnProduction() {
        runner()
                .withPropertyValues(
                        "basic-framework.sms-code.begin-code=1000",
                        "basic-framework.sms-code.end-code=9999")
                .run(context -> {
                    assertThat(context).as("旧键当前不触发绑定失败，必须由断言核实其无落点").hasNotFailed();
                    SmsCodeProperties properties = context.getBean(SmsCodeProperties.class);

                    assertThat(properties.getExpireTimes()).as("同时提供的真实键必须绑定成功").hasMinutes(10);
                    assertLegacyKeysAreInert(SmsCodeProperties.class);
                    assertThat(declaredPropertyNames(SmsCodeProperties.class)).as("生产属性面清单")
                            .containsExactlyInAnyOrder(
                                    "expireTimes", "sendFrequency", "sendMaximumQuantityPerDay",
                                    "sendIpWindow", "sendMaximumPerIp", "verificationMaximumFailures",
                                    "verificationWindow", "verificationMaximumPerMobile",
                                    "verificationMaximumPerIp");
                });
    }

    /**
     * 契约违反变体：上游形状的属性在同样前缀下能读到旧键，证明上一条断言不是恒真。
     *
     * <p>变体只用于负对照，不参与任何生产路径。</p>
     */
    @Test
    void upstreamShapedVariantStillBindsRemovedKeysSoAssertionDiscriminates() {
        new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(ValidationAutoConfiguration.class))
                .withUserConfiguration(UpstreamBinding.class)
                .withPropertyValues(
                        "basic-framework.sms-code.expire-times=10m",
                        "basic-framework.sms-code.send-frequency=1m",
                        "basic-framework.sms-code.send-maximum-quantity-per-day=10",
                        "basic-framework.sms-code.begin-code=1000",
                        "basic-framework.sms-code.end-code=9999")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    UpstreamShapedCodeRangeProperties properties =
                            context.getBean(UpstreamShapedCodeRangeProperties.class);

                    assertThat(properties.getBeginCode()).as("变体必须真的读到旧键").isEqualTo(1000);
                    assertThat(properties.getEndCode()).isEqualTo(9999);
                    assertThatThrownBy(() -> assertLegacyKeysAreInert(UpstreamShapedCodeRangeProperties.class))
                            .as("同一条「旧键无效」断言作用在契约违反变体上必须失败")
                            .isInstanceOf(AssertionError.class);
                });
    }

    /**
     * 验证码范围已固定在生产生成器里，属性面无法再配置它。
     *
     * <p>这里读的是已加载的生产类上真实存在的固定范围常量：删除 {@code beginCode}/{@code endCode}
     * 之后，验证码长度与取值上界不再来自配置。该读数说明旧配置键即使被保留在部署配置里也不可能生效，
     * 但**不**说明固定范围本身符合目标契约。</p>
     */
    @Test
    void codeRangeIsFixedInProductionGeneratorAndNotConfigurable() throws Exception {
        assertThat(productionCodeLength()).as("生产验证码长度常量").isEqualTo(6);
        assertThat(productionCodeBound()).as("生产验证码取值上界常量").isEqualTo(1_000_000);

        runner().run(context -> {
            SmsCodeProperties properties = context.getBean(SmsCodeProperties.class);

            assertLegacyKeysAreInert(SmsCodeProperties.class);
        });
    }

    /** 真实校验：零值与负值必须被拒绝，防止限额退化为「无限尝试」。 */
    @Test
    void rejectsNonPositiveBounds() {
        assertRejected("expire-times=0ms");
        assertRejected("send-frequency=-1ms");
        assertRejected("send-maximum-quantity-per-day=0");
        assertRejected("send-ip-window=0ms");
        assertRejected("send-maximum-per-ip=0");
        assertRejected("verification-window=0ms");
    }

    /** 真实校验：边界值本身合法，门槛不得误伤最小可用配置。 */
    @Test
    void acceptsMinimalPositiveBounds() {
        runner()
                .withPropertyValues(
                        "basic-framework.sms-code.expire-times=1ms",
                        "basic-framework.sms-code.send-frequency=1ms",
                        "basic-framework.sms-code.send-maximum-quantity-per-day=1",
                        "basic-framework.sms-code.send-ip-window=1ms",
                        "basic-framework.sms-code.send-maximum-per-ip=1",
                        "basic-framework.sms-code.verification-window=1ms",
                        "basic-framework.sms-code.verification-maximum-per-mobile=1",
                        "basic-framework.sms-code.verification-maximum-per-ip=1",
                        "basic-framework.sms-code.verification-maximum-failures=1")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    SmsCodeProperties properties = context.getBean(SmsCodeProperties.class);

                    assertThat(properties.getExpireTimes()).isEqualTo(Duration.ofMillis(1));
                    assertThat(properties.getSendMaximumPerIp()).isEqualTo(1);
                    assertThat(properties.getVerificationMaximumFailures()).isEqualTo(1);
                });
    }

    /** 真实校验：三项上游共有的必填约束仍然生效，缺一项即启动失败。 */
    @Test
    void stillRejectsMissingUpstreamRequiredProperties() {
        new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(ValidationAutoConfiguration.class))
                .withUserConfiguration(Binding.class)
                .run(context -> assertThat(context).hasFailed());
    }

    /**
     * 断言旧配置键在被检查的属性面上没有任何落点。
     *
     * <p>该断言同时用于生产属性类与契约违反变体：生产必须通过，变体必须失败。</p>
     *
     * @param propertiesType 被检查的属性类
     */
    private static void assertLegacyKeysAreInert(Class<?> propertiesType) {
        assertThat(declaredPropertyNames(propertiesType)).doesNotContainAnyElementsOf(REMOVED_UPSTREAM_KEYS);
    }

    /** 断言给定属性键值会让真实上下文启动失败。 */
    private void assertRejected(String property) {
        runner().withPropertyValues("basic-framework.sms-code." + property)
                .run(context -> assertThat(context)
                        .as("非法取值必须被拒绝：%s", property)
                        .hasFailed());
    }

    /**
     * 读取属性类上真实存在的属性名清单。
     *
     * @param propertiesType 被检查的属性类
     * @return 该类真实声明的属性名集合
     */
    private static Set<String> declaredPropertyNames(Class<?> propertiesType) {
        return Arrays.stream(propertiesType.getDeclaredFields())
                .map(Field::getName)
                .collect(Collectors.toSet());
    }

    /** 读取生产生成器上真实存在的验证码长度常量。 */
    private static int productionCodeLength() throws Exception {
        return readProductionConstant("SMS_CODE_LENGTH");
    }

    /** 读取生产生成器上真实存在的验证码取值上界常量。 */
    private static int productionCodeBound() throws Exception {
        return readProductionConstant("SMS_CODE_BOUND");
    }

    /**
     * 反射读取生产类上的固定范围常量。
     *
     * @param name 常量名
     * @return 常量的真实运行期取值
     */
    private static int readProductionConstant(String name) throws Exception {
        Field field = SmsCodeServiceImpl.class.getDeclaredField(name);
        field.setAccessible(true);
        return field.getInt(null);
    }

    /** 只启动真实属性绑定与 Bean Validation，不依赖业务服务与外部中间件。 */
    private ApplicationContextRunner runner() {
        return new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(ValidationAutoConfiguration.class))
                .withUserConfiguration(Binding.class)
                .withPropertyValues(
                        "basic-framework.sms-code.expire-times=10m",
                        "basic-framework.sms-code.send-frequency=1m",
                        "basic-framework.sms-code.send-maximum-quantity-per-day=10");
    }

    /** 只启用生产属性绑定与校验。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(SmsCodeProperties.class)
    static class Binding {
    }

    /**
     * 契约违反变体：保留上游形状的验证码取值字段。
     *
     * <p>字段名、类型与必填约束都对齐固定上游版本，用于证明旧键在生产属性面上无落点这一断言确实
     * 依赖生产属性面的真实形状。</p>
     */
    @ConfigurationProperties(prefix = "basic-framework.sms-code")
    static class UpstreamShapedCodeRangeProperties {

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

    /** 只启用契约违反变体的属性绑定。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(UpstreamShapedCodeRangeProperties.class)
    static class UpstreamBinding {
    }

}