package com.basicframework.framework.desensitize.core.slider.handler;

import com.basicframework.framework.desensitize.core.slider.annotation.BankCardDesensitize;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证银行卡号滑动脱敏处理器读取注解声明并遮蔽中间号段的真实行为。
 *
 * <p>银行卡号脱敏直接决定接口是否泄露完整卡号，处理器必须按字段声明的保留位数与替换符
 * 执行，不能各自硬编码默认值；长度不超过前后缀保留之和时必须整串遮蔽，否则短卡号会原样
 * 返回。这里同时锁定一个真实差异：{@link BankCardDesensitize#disable()} 属性被处理器忽略
 * （{@code getDisable} 固定返回空表达式），声明 {@code disable="true"} 仍然脱敏——脱敏方向
 * 上是安全的一侧，但开关不生效属已知行为，已在交付报告中登记为待处理项，未改动生产源码。</p>
 *
 * @author shady2713
 */
class BankCardDesensitizationTest {

    /** 被测银行卡号脱敏处理器，无状态可跨用例复用。 */
    private static final BankCardDesensitization HANDLER = new BankCardDesensitization();

    /** 默认保留前 6 位与后 2 位，中间号段必须全部遮蔽。 */
    @Test
    void defaultKeepsMaskTheMiddleSegments() {
        BankCardDesensitize annotation = annotationOf(Sample.class, "bankCard", BankCardDesensitize.class);

        assertThat(HANDLER.getPrefixKeep(annotation)).isEqualTo(6);
        assertThat(HANDLER.getSuffixKeep(annotation)).isEqualTo(2);
        assertThat(HANDLER.getReplacer(annotation)).isEqualTo("*");
        assertThat(HANDLER.desensitize("9988002866797031", annotation))
                .as("银行卡号脱敏结果不得包含中间号段").isEqualTo("998800********31")
                .doesNotContain("28667970");
    }

    /** 注解显式声明的保留位数与替换符必须生效，不得固定为默认规则。 */
    @Test
    void customKeepsAndReplacerAreReadFromAnnotation() {
        BankCardDesensitize annotation = annotationOf(Sample.class, "bankCardCustom", BankCardDesensitize.class);

        assertThat(HANDLER.getPrefixKeep(annotation)).isEqualTo(2);
        assertThat(HANDLER.getSuffixKeep(annotation)).isEqualTo(3);
        assertThat(HANDLER.getReplacer(annotation)).isEqualTo("#");
        assertThat(HANDLER.desensitize("9988002866797031", annotation))
                .as("自定义保留位数与替换符必须生效").isEqualTo("99###########031")
                .doesNotContain("88002866");
    }

    /** 长度不超过前后缀保留之和时必须整串遮蔽，不能保留任何原文。 */
    @Test
    void valuesNotLongerThanKeptRangeAreFullyMasked() {
        BankCardDesensitize annotation = annotationOf(Sample.class, "bankCard", BankCardDesensitize.class);

        assertThat(HANDLER.desensitize("99880028", annotation))
                .as("长度等于 6+2 时整串遮蔽").isEqualTo("********");
        assertThat(HANDLER.desensitize("9988", annotation)).as("短卡号整串遮蔽").isEqualTo("****");
        assertThat(HANDLER.desensitize("", annotation)).as("空串不产生多余字符").isEmpty();
    }

    /** 注解声明禁用时处理器仍固定脱敏，锁定真实行为并提示开关不生效。 */
    @Test
    void disableAttributeIsIgnoredByBankCardHandler() {
        BankCardDesensitize annotation = annotationOf(Sample.class, "bankCardDisabled", BankCardDesensitize.class);

        assertThat(annotation.disable()).as("样例确实声明了禁用").isEqualTo("true");
        assertThat(HANDLER.getDisable(annotation))
                .as("银行卡处理器固定返回空禁用表达式，注解 disable 属性不生效").isEmpty();
        assertThat(HANDLER.desensitize("9988002866797031", annotation))
                .as("即使声明禁用也仍然脱敏，不会泄露完整卡号").isEqualTo("998800********31");
    }

    /**
     * 从样例字段读取真实声明的脱敏注解，避免在测试中伪造注解实例。
     *
     * @param type 声明字段的类型
     * @param fieldName 样例字段名
     * @param annotationType 期望读取到的注解类型
     * @param <A> 注解类型
     * @return 字段上声明的脱敏注解
     */
    private static <A extends java.lang.annotation.Annotation> A annotationOf(
            Class<?> type, String fieldName, Class<A> annotationType) {
        try {
            Field field = type.getDeclaredField(fieldName);
            A annotation = field.getAnnotation(annotationType);
            assertThat(annotation).as("样例字段 %s 必须带 %s 注解", fieldName, annotationType.getSimpleName())
                    .isNotNull();
            return annotation;
        } catch (NoSuchFieldException exception) {
            throw new IllegalStateException("未找到测试字段 " + fieldName, exception);
        }
    }

    /** 声明银行卡号脱敏默认、自定义与禁用配置的样例类型。 */
    static class Sample {

        /** 使用默认保留位数的银行卡号。 */
        @BankCardDesensitize
        private String bankCard;

        /** 保留 2 位前缀与 3 位后缀、使用井号替换符的银行卡号。 */
        @BankCardDesensitize(prefixKeep = 2, suffixKeep = 3, replacer = "#")
        private String bankCardCustom;

        /** 显式声明禁用脱敏的银行卡号，用于锁定禁用属性被忽略的真实行为。 */
        @BankCardDesensitize(disable = "true")
        private String bankCardDisabled;
    }
}
