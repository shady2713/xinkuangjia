package com.basicframework.framework.desensitize.core.regex.handler;

import cn.hutool.extra.spring.SpringUtil;
import com.basicframework.framework.desensitize.core.regex.annotation.RegexDesensitize;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContext;
import org.springframework.context.support.StaticApplicationContext;

import java.lang.reflect.Field;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证通用正则脱敏处理器对注解声明正则、替换串与禁用开关的读取契约。
 *
 * <p>该处理器是自定义脱敏规则的入口：注解默认值会把整段文本替换成固定串，
 * 显式声明时则原样透传正则与替换串（替换串支持 {@code $1} 这类捕获组引用）。
 * 读取写错会让"看起来配了脱敏"的字段实际明文输出，因此这里锁定三件事：
 * 默认值必须来自注解、显式声明必须原样生效、未命中的文本不得被替换。</p>
 *
 * <p>禁用开关经真实 Spring 容器求值，容器开关为假时必须继续脱敏，
 * 避免开关写错变成"永不脱敏"。非法正则会在替换时抛出正则异常，
 * 属配置错误而非可恢复状态，本用例一并锁定该真实行为。</p>
 *
 * @author shady2713
 */
class DefaultRegexDesensitizationHandlerTest {

    /** 被测处理器，无状态可跨用例复用。 */
    private static final DefaultRegexDesensitizationHandler HANDLER = new DefaultRegexDesensitizationHandler();

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

    /** 未显式声明时，正则、替换串与禁用表达式都必须来自注解默认值。 */
    @Test
    void readsDefaultsFromAnnotation() {
        RegexDesensitize annotation = annotationOf("defaultMasked");

        assertThat(HANDLER.getRegex(annotation)).isEqualTo("^[\\s\\S]*$");
        assertThat(HANDLER.getReplacer(annotation)).isEqualTo("******");
        assertThat(HANDLER.getDisable(annotation)).isEmpty();
    }

    /** 显式声明的正则、替换串与禁用表达式必须原样透传，不得被内置默认值覆盖。 */
    @Test
    void passesThroughDeclaredRegexReplacerAndDisable() {
        RegexDesensitize annotation = annotationOf("customRule");

        assertThat(HANDLER.getRegex(annotation)).isEqualTo("123");
        assertThat(HANDLER.getReplacer(annotation)).isEqualTo("******");
        assertThat(HANDLER.getDisable(annotation)).isEqualTo("");
    }

    /**
     * 默认规则必须把整段文本替换成固定串，与输入长度无关。
     *
     * <p>默认正则匹配任意字符（含换行），因此任何长度的输入都得到同一固定串；
     * 该行为说明它只适合"整字段遮蔽"场景，不能用于保留部分字符的脱敏。</p>
     */
    @Test
    void defaultRuleReplacesWholeValue() {
        RegexDesensitize annotation = annotationOf("defaultMasked");

        assertThat(HANDLER.desensitize("123456789", annotation)).isEqualTo("******");
        assertThat(HANDLER.desensitize("a\nb", annotation)).as("换行也在默认匹配范围内").isEqualTo("******");
        assertThat(HANDLER.desensitize("", annotation))
                .as("默认正则匹配空串，处理器本身不区分空白；序列化器在调用前已把空值写成 null")
                .isEqualTo("******");
    }

    /**
     * 自定义正则必须真实生效，只替换命中片段并保留其余内容。
     *
     * <p>断言采用注解注释里的同一例子：正则 {@code 123}、替换串 {@code ******}，
     * 输入 {@code 123456789} 应得到 {@code ******456789}。</p>
     */
    @Test
    void customRegexReplacesOnlyMatchedSegment() {
        RegexDesensitize annotation = annotationOf("customRule");

        assertThat(HANDLER.desensitize("123456789", annotation))
                .as("只替换命中前缀，其余内容保留").isEqualTo("******456789");
    }

    /** 替换串支持捕获组引用，声明 {@code $1} 时必须按分组回填。 */
    @Test
    void replacerSupportsCaptureGroupReferences() {
        RegexDesensitize annotation = annotationOf("grouped");

        assertThat(HANDLER.desensitize("13800000001", annotation))
                .as("按分组保留前 3 位与后 4 位").isEqualTo("138****0001");
    }

    /** 输入不含命中片段时原样返回，不得凭空插入替换串。 */
    @Test
    void unmatchedTextIsReturnedUnchanged() {
        RegexDesensitize annotation = annotationOf("customRule");

        assertThat(HANDLER.desensitize("abcdef", annotation)).isEqualTo("abcdef");
    }

    /** 禁用表达式为真时必须返回原文，供排障时查看真实取值。 */
    @Test
    void disableExpressionReturnsOrigin() {
        bindApplicationContext(new StaticApplicationContext());

        assertThat(HANDLER.desensitize("123456789", annotationOf("disabled"))).isEqualTo("123456789");
    }

    /** 容器开关求值为假时必须继续脱敏，开关写错不能变成永不脱敏。 */
    @Test
    void disabledSwitchEvaluatedFalseStillMasks() {
        StaticApplicationContext context = new StaticApplicationContext();
        context.getBeanFactory().registerSingleton("desensitizeSwitch", new DesensitizeSwitch(false));
        bindApplicationContext(context);

        assertThat(HANDLER.desensitize("123456789", annotationOf("disabledBySwitch"))).isEqualTo("******");
    }

    /**
     * 非法正则在替换时抛出正则异常，不会被静默忽略。
     *
     * <p>该类配置来自注解声明，写错只在真实序列化时才暴露；本用例锁定"失败而不是明文输出"
     * 这一真实行为，便于评审时判断是否需要改为启动期校验。</p>
     */
    @Test
    void invalidRegexFailsInsteadOfLeakingPlainText() {
        RegexDesensitize annotation = annotationOf("invalidRegex");

        assertThatThrownBy(() -> HANDLER.desensitize("123456789", annotation))
                .isInstanceOf(java.util.regex.PatternSyntaxException.class);
    }

    /**
     * 把真实上下文绑定到 Hutool 静态入口。
     *
     * @param context 待绑定的上下文；null 表示清除绑定
     */
    private static void bindApplicationContext(ApplicationContext context) {
        new SpringUtil().setApplicationContext(context);
    }

    /**
     * 从样例字段读取真实声明的正则脱敏注解，避免在测试中伪造注解实例。
     *
     * @param fieldName 样例字段名
     * @return 字段上声明的正则脱敏注解
     */
    private static RegexDesensitize annotationOf(String fieldName) {
        try {
            Field field = Sample.class.getDeclaredField(fieldName);
            RegexDesensitize annotation = field.getAnnotation(RegexDesensitize.class);
            assertThat(annotation).as("样例字段 %s 必须带正则脱敏注解", fieldName).isNotNull();
            return annotation;
        } catch (NoSuchFieldException exception) {
            throw new IllegalStateException("未找到测试字段 " + fieldName, exception);
        }
    }

    /** 声明默认、自定义、分组、禁用与非法正则配置的样例类型。 */
    static class Sample {

        /** 使用注解默认正则与替换串。 */
        @RegexDesensitize
        private String defaultMasked;

        /** 只替换前缀 123。 */
        @RegexDesensitize(regex = "123", replacer = "******")
        private String customRule;

        /** 用捕获组保留手机号前三后四位。 */
        @RegexDesensitize(regex = "^(\\d{3})\\d{4}(\\d{4})$", replacer = "$1****$2")
        private String grouped;

        /** 用常量表达式永久禁用脱敏。 */
        @RegexDesensitize(disable = "true")
        private String disabled;

        /** 用容器内开关 Bean 决定是否禁用脱敏。 */
        @RegexDesensitize(disable = "@desensitizeSwitch.enabled")
        private String disabledBySwitch;

        /** 声明一个非法的正则，用于锁定配置写错时的真实行为。 */
        @RegexDesensitize(regex = "([", replacer = "******")
        private String invalidRegex;
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
