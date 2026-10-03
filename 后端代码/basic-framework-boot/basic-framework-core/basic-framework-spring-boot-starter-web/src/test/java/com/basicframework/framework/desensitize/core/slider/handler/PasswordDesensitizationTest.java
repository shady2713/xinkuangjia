package com.basicframework.framework.desensitize.core.slider.handler;

import com.basicframework.framework.desensitize.core.slider.annotation.PasswordDesensitize;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证密码脱敏处理器在边界长度下的输出，确保任何输入都不泄露原文。
 *
 * <p>脱敏的目的是让接口响应不可反推凭据；若某些长度下返回原文或保留过多字符，
 * 就等于没有脱敏，因此每个用例都直接断言输出不含原始字符。</p>
 *
 * @author shady2713
 */
class PasswordDesensitizationTest {

    /** 默认配置：前缀、后缀都不保留，替换符为星号。 */
    private static PasswordDesensitize DEFAULT_ANNOTATION;
    /** 保留首尾各 2 位。 */
    private static PasswordDesensitize KEEP_TWO_TWO;
    /** 前缀 1 位、后缀 3 位，替换符为 @。 */
    private static PasswordDesensitize MASK_ONE_THREE;
    /** 使用井号替换符。 */
    private static PasswordDesensitize HASH_REPLACER;
    /** 禁用表达式为真。 */
    private static PasswordDesensitize DISABLED_TRUE;
    /** 禁用表达式为假。 */
    private static PasswordDesensitize DISABLED_FALSE;
    /** 禁用表达式非法。 */
    private static PasswordDesensitize DISABLED_BROKEN;
    /** 被测处理器。 */
    private static final PasswordDesensitization HANDLER = new PasswordDesensitization();

    /** 从真实字段声明读取各类脱敏配置，避免在测试中伪造注解。 */
    @BeforeAll
    static void loadAnnotations() {
        // 禁用表达式通过 hutool SpringUtil 解析 Bean，需要真实上下文才能求值。
        bindSpringContext();
        DEFAULT_ANNOTATION = annotationOf("defaultMasked");
        KEEP_TWO_TWO = annotationOf("keepTwoTwo");
        MASK_ONE_THREE = annotationOf("customKeep");
        HASH_REPLACER = annotationOf("hashReplacer");
        DISABLED_TRUE = annotationOf("disabled");
        DISABLED_FALSE = annotationOf("disabledFalse");
        DISABLED_BROKEN = annotationOf("disabledBroken");
    }

    /**
     * 绑定最小 Spring 上下文，使禁用表达式可以正常求值。
     * 脱敏的禁用开关按生产路径经表达式解析，缺少上下文时该分支无法覆盖。
     */
    private static void bindSpringContext() {
        try {
            org.springframework.context.support.GenericApplicationContext applicationContext =
                    new org.springframework.context.support.GenericApplicationContext();
            applicationContext.refresh();
            Class<?> springUtilClass = Class.forName("cn.hutool.extra.spring.SpringUtil");
            Object springUtil = springUtilClass.getDeclaredConstructor().newInstance();
            springUtilClass.getMethod("setApplicationContext",
                            org.springframework.context.ApplicationContext.class)
                    .invoke(springUtil, applicationContext);
        } catch (ReflectiveOperationException exception) {
            throw new IllegalStateException("绑定测试 Spring 上下文失败", exception);
        }
    }

    /** 默认配置下必须全部替换为星号。 */
    @Test
    void defaultRuleMasksEntireValue() {
        String result = HANDLER.desensitize("SecretPassword1", DEFAULT_ANNOTATION);

        assertThat(result).isEqualTo("***************");
        assertThat(result).doesNotContain("SecretPassword1");
    }

    /** 任意长度的输入都不得出现原文片段。 */
    @Test
    void noLengthLeaksPlainText() {
        for (int length = 1; length <= 64; length++) {
            String raw = "A".repeat(length);
            String result = HANDLER.desensitize(raw, DEFAULT_ANNOTATION);
            assertThat(result)
                    .as("长度=%d 的输入必须被完全替换，实际=%s", length, result)
                    .doesNotContain(raw)
                    .isEqualTo("*".repeat(length));
        }
    }

    /** 空串脱敏后仍为空串，不得因替换逻辑产生多余字符。 */
    @Test
    void emptyValueStaysEmpty() {
        assertThat(HANDLER.desensitize("", DEFAULT_ANNOTATION)).isEmpty();
    }

    /** 单字符输入必须被替换，避免短值因“保留比例”而泄露。 */
    @Test
    void singleCharacterIsMasked() {
        assertThat(HANDLER.desensitize("A", DEFAULT_ANNOTATION)).isEqualTo("*");
    }

    /** 处理器必须从注解读取配置，而不是使用硬编码默认值。 */
    @Test
    void handlerReadsConfigurationFromAnnotation() {
        // 前缀 1 位、后缀 3 位，8 位输入的中间 4 位被替换
        assertThat(HANDLER.desensitize("abcdefgh", MASK_ONE_THREE))
                .isEqualTo("a@@@@fgh");
    }

    /** 自定义替换符必须生效，避免固定为星号而与其他脱敏规则混淆。 */
    @Test
    void customReplacerIsApplied() {
        assertThat(HANDLER.desensitize("Secret", HASH_REPLACER)).isEqualTo("######");
    }

    /** 禁用表达式为真时必须返回原文，运维排查场景需要看到真实值。 */
    @Test
    void disableExpressionReturnsOriginalValue() {
        assertThat(HANDLER.desensitize("Secret", DISABLED_TRUE)).isEqualTo("Secret");
    }

    /** 禁用表达式为假时必须继续脱敏。 */
    @Test
    void falseDisableExpressionStillMasks() {
        assertThat(HANDLER.desensitize("Secret", DISABLED_FALSE)).isEqualTo("******");
    }

    /**
     * 记录禁用表达式无法解析时的真实行为。
     *
     * <p>表达式非法时解析直接抛异常，脱敏中断而不是继续遮蔽；
     * 若配置写错，响应会在序列化阶段失败，需在配置校验阶段提前拦截。</p>
     */
    @Test
    void unresolvableDisableExpressionFails() {
        assertThatThrownBy(() -> HANDLER.desensitize("Secret", DISABLED_BROKEN))
                .as("非法禁用表达式当前会使脱敏直接失败")
                .isInstanceOf(org.springframework.expression.spel.SpelParseException.class);
    }

    /** 长度不超过前后缀保留之和时必须全部替换，不保留任何字符。 */
    @Test
    void valueShorterThanKeptRangeIsFullyReplaced() {
        assertThat(HANDLER.desensitize("abc", KEEP_TWO_TWO)).isEqualTo("***");
        assertThat(HANDLER.desensitize("abcd", KEEP_TWO_TWO)).isEqualTo("****");
    }

    /** 长度超过保留范围时只保留前后缀，中间全部替换。 */
    @Test
    void valueLongerThanKeptRangeKeepsOnlyEdges() {
        assertThat(HANDLER.desensitize("abcdefgh", KEEP_TWO_TWO)).isEqualTo("ab****gh");
    }

    /** 从真实字段声明读取默认配置，验证默认前缀、后缀与替换符。 */
    @Test
    void realAnnotationUsesMaskedDefaults() {
        assertThat(HANDLER.desensitize("PlainText", annotationOf("defaultMasked")))
                .as("默认注解必须完全遮蔽").isEqualTo("*********");
    }

    /** 保留位数的真实字段同样必须按声明生效。 */
    @Test
    void realAnnotationAppliesKeepLengths() {
        assertThat(HANDLER.desensitize("abcdefgh", annotationOf("keepTwoTwo"))).isEqualTo("ab****gh");
    }

    /** 从真实字段声明读取自定义替换符配置。 */
    @Test
    void realAnnotationAppliesCustomReplacer() {
        assertThat(HANDLER.desensitize("Secret", annotationOf("hashReplacer"))).isEqualTo("######");
    }

    /** 从真实字段声明读取禁用配置。 */
    @Test
    void realAnnotationSupportsDisable() {
        assertThat(HANDLER.desensitize("Secret", annotationOf("disabled"))).isEqualTo("Secret");
    }

    /** 读取样例字段上真实声明的脱敏注解。 */
    private static PasswordDesensitize annotationOf(String fieldName) {
        try {
            PasswordDesensitize annotation = Sample.class.getDeclaredField(fieldName)
                    .getAnnotation(PasswordDesensitize.class);
            assertThat(annotation).as("测试字段 %s 必须带脱敏注解", fieldName).isNotNull();
            return annotation;
        } catch (NoSuchFieldException exception) {
            throw new IllegalStateException("未找到测试字段 " + fieldName, exception);
        }
    }

    /** 声明多种脱敏配置的样例类型。 */
    static class Sample {

        /** 默认配置的密码字段。 */
        @PasswordDesensitize
        private String defaultMasked;

        /** 保留首尾各两位的密码。 */
        @PasswordDesensitize(prefixKeep = 2, suffixKeep = 2)
        private String keepTwoTwo;

        /** 前缀 1 位、后缀 3 位的密码。 */
        @PasswordDesensitize(prefixKeep = 1, suffixKeep = 3, replacer = "@")
        private String customKeep;

        /** 使用井号替换符的密码。 */
        @PasswordDesensitize(replacer = "#")
        private String hashReplacer;

        /** 被显式禁用脱敏的密码。 */
        @PasswordDesensitize(disable = "true")
        private String disabled;

        /** 禁用表达式为假的密码。 */
        @PasswordDesensitize(disable = "false")
        private String disabledFalse;

        /** 禁用表达式非法的密码。 */
        @PasswordDesensitize(disable = "not a valid expression((")
        private String disabledBroken;
    }
}
