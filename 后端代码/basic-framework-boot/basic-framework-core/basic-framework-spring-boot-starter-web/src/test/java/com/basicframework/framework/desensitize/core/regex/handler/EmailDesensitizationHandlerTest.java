package com.basicframework.framework.desensitize.core.regex.handler;

import cn.hutool.extra.spring.SpringUtil;
import com.basicframework.framework.desensitize.core.regex.annotation.EmailDesensitize;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContext;
import org.springframework.context.support.StaticApplicationContext;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证邮箱脱敏处理器的正则与替换规则读取契约。
 *
 * <p>该处理器只负责把注解上声明的正则和替换串交给父类的统一脱敏流程，本身不做任何加工。
 * 因此需要锁定三点：注解未显式声明时必须取到注解默认值（否则默认脱敏会失效）；
 * 显式声明时必须原样透传（否则自定义脱敏规则会被忽略）；声明禁用表达式时必须在
 * 真实 Spring 容器上下文内求值并跳过脱敏（否则运维无法按环境临时关闭脱敏）。</p>
 *
 * <p>同时锁定真实输出：本地部分被遮蔽而域名保留，便于运维按域名排查投递问题；
 * 输入不含邮箱结构时不做任何替换，属于既有口径而非脱敏保证。</p>
 *
 * @author shady2713
 */
class EmailDesensitizationHandlerTest {

    /** 被测处理器，无状态，可跨用例复用。 */
    private static final EmailDesensitizationHandler HANDLER = new EmailDesensitizationHandler();

    /** 用例开始前的静态 Spring 上下文，结束后原样恢复。 */
    private ApplicationContext previousContext;

    /** 记录进入用例前的静态上下文，供还原使用。 */
    @BeforeEach
    void captureContext() {
        previousContext = SpringUtil.getApplicationContext();
    }

    /** 还原静态上下文，避免容器状态泄漏到同 JVM 的其他测试。 */
    @AfterEach
    void restoreContext() {
        bindApplicationContext(previousContext);
    }

    /**
     * 把真实上下文绑定到 Hutool 静态入口。
     *
     * <p>生产由容器回调 {@code setApplicationContext} 完成绑定；{@code SpringUtil} 保留公开无参构造，
     * 测试中按同样的方式建立真实容器解析能力。</p>
     *
     * @param context 待绑定的上下文；null 表示清除绑定
     */
    private static void bindApplicationContext(ApplicationContext context) {
        new SpringUtil().setApplicationContext(context);
    }

    /** 注解未显式声明时，正则与替换串必须取注解默认值。 */
    @Test
    void readsDefaultRegexAndReplacerFromAnnotation() throws NoSuchFieldException {
        EmailDesensitize annotation = annotationOf("defaultMasked");

        assertThat(HANDLER.getRegex(annotation)).isEqualTo("(^.)[^@]*(@.*$)");
        assertThat(HANDLER.getReplacer(annotation)).isEqualTo("$1****$2");
    }

    /** 注解显式声明自定义规则时，处理器必须原样透传，不得替换成内置规则。 */
    @Test
    void passesThroughCustomRegexAndReplacer() throws NoSuchFieldException {
        EmailDesensitize annotation = annotationOf("customRule");

        assertThat(HANDLER.getRegex(annotation)).isEqualTo("(^.{2})[^@]*(@.*$)");
        assertThat(HANDLER.getReplacer(annotation)).isEqualTo("$1***$2");
    }

    /** 默认规则必须遮蔽邮箱本地部分并保留域名，使脱敏结果不可反推原地址。 */
    @Test
    void defaultRuleMasksLocalPartAndKeepsDomain() throws NoSuchFieldException {
        String masked = HANDLER.desensitize("example@gmail.com", annotationOf("defaultMasked"));

        assertThat(masked).isEqualTo("e****@gmail.com");
        assertThat(masked).doesNotContain("xample");
        assertThat(masked).endsWith("@gmail.com");
    }

    /** 自定义规则必须真实生效，保留前两位本地字符并替换其余部分。 */
    @Test
    void customRuleAppliesConfiguredMask() throws NoSuchFieldException {
        assertThat(HANDLER.desensitize("example@gmail.com", annotationOf("customRule")))
                .isEqualTo("ex***@gmail.com");
    }

    /**
     * 输入不含邮箱结构时原样返回。
     *
     * <p>正则要求存在 {@code @} 与域名部分，未命中时不产生替换。该行为说明本处理器不是
     * “任意文本保证脱敏”，把非邮箱字段挂上本注解不会得到脱敏效果。</p>
     */
    @Test
    void nonEmailTextIsReturnedUnchanged() throws NoSuchFieldException {
        assertThat(HANDLER.desensitize("plain-text", annotationOf("defaultMasked")))
                .isEqualTo("plain-text");
    }

    /**
     * 单字段内出现多个邮箱时只遮蔽第一个，其余原样保留。
     *
     * <p>默认正则使用 {@code ^} 与 {@code $} 锚定整段文本，一次替换只覆盖首个地址。
     * 因此本注解适用于“字段只存一个邮箱”的场景；把多个地址放进同一字段时后续地址会明文输出，
     * 属既有口径限制，本用例锁定真实输出以便评审时可见。</p>
     */
    @Test
    void onlyFirstAddressIsMaskedWhenFieldHoldsMultipleAddresses() throws NoSuchFieldException {
        String masked = HANDLER.desensitize("example@gmail.com, second@qq.com", annotationOf("defaultMasked"));

        assertThat(masked).isEqualTo("e****@gmail.com, second@qq.com");
    }

    /**
     * 禁用表达式为常量 true 时必须原样返回，不做任何遮蔽。
     *
     * <p>该分支用于排障或按环境临时关闭脱敏；若被忽略，运维在需要看原文时会拿到脱敏结果。</p>
     */
    @Test
    void disabledByConstantExpressionReturnsOrigin() throws NoSuchFieldException {
        bindApplicationContext(new StaticApplicationContext());

        assertThat(HANDLER.desensitize("example@gmail.com", annotationOf("disabled")))
                .isEqualTo("example@gmail.com");
    }

    /**
     * 禁用表达式可以引用 Spring 容器中的 Bean，容器状态为真时跳过脱敏。
     *
     * <p>注解文档声明 disable 支持 Spring EL；真实用途是让开关来自配置或容器，
     * 因此这里用真实容器注册开关 Bean，锁定表达式确实经 Bean 解析求值。</p>
     */
    @Test
    void disabledByContainerBeanExpressionReturnsOrigin() throws NoSuchFieldException {
        StaticApplicationContext context = new StaticApplicationContext();
        context.getBeanFactory().registerSingleton("desensitizeSwitch", new DesensitizeSwitch(true));
        bindApplicationContext(context);

        assertThat(HANDLER.desensitize("example@gmail.com", annotationOf("disabledBySwitch")))
                .isEqualTo("example@gmail.com");
    }

    /**
     * 禁用表达式的求值结果为假时仍必须执行脱敏。
     *
     * <p>表达式写错或开关关闭都不能变成“永不脱敏”，否则敏感字段会明文输出。</p>
     */
    @Test
    void enabledSwitchStillDesensitizes() throws NoSuchFieldException {
        StaticApplicationContext context = new StaticApplicationContext();
        context.getBeanFactory().registerSingleton("desensitizeSwitch", new DesensitizeSwitch(false));
        bindApplicationContext(context);

        assertThat(HANDLER.desensitize("example@gmail.com", annotationOf("disabledBySwitch")))
                .isEqualTo("e****@gmail.com");
    }

    /**
     * 从样例字段读取真实声明的邮箱脱敏注解，避免在测试中伪造注解实例。
     *
     * @param fieldName 样例字段名
     * @return 字段上声明的邮箱脱敏注解
     * @throws NoSuchFieldException 字段或注解缺失时抛出，说明测试夹具被改动
     */
    private static EmailDesensitize annotationOf(String fieldName) throws NoSuchFieldException {
        EmailDesensitize annotation = Sample.class.getDeclaredField(fieldName).getAnnotation(EmailDesensitize.class);
        assertThat(annotation).as("样例字段 %s 必须带邮箱脱敏注解", fieldName).isNotNull();
        return annotation;
    }

    /** 声明默认与自定义邮箱脱敏规则的样例类型。 */
    static class Sample {

        /** 使用注解默认正则与替换串。 */
        @EmailDesensitize
        private String defaultMasked;

        /** 显式声明自定义正则与替换串。 */
        @EmailDesensitize(regex = "(^.{2})[^@]*(@.*$)", replacer = "$1***$2")
        private String customRule;

        /** 用常量表达式永久禁用脱敏。 */
        @EmailDesensitize(disable = "true")
        private String disabled;

        /** 用容器内开关 Bean 决定是否禁用脱敏。 */
        @EmailDesensitize(disable = "@desensitizeSwitch.enabled")
        private String disabledBySwitch;
    }

    /** 禁用开关替身，按构造时的取值回答启用状态。 */
    static class DesensitizeSwitch {

        /** 开关当前取值。 */
        private final boolean enabled;

        /**
         * 创建固定取值的开关。
         *
         * @param enabled 开关取值
         */
        DesensitizeSwitch(boolean enabled) {
            this.enabled = enabled;
        }

        /**
         * 读取开关取值，供 SpEL 表达式 {@code @desensitizeSwitch.enabled} 访问。
         *
         * @return 开关取值
         */
        public boolean isEnabled() {
            return enabled;
        }
    }
}
