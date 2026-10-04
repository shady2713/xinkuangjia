package com.basicframework.framework.desensitize.core.base.handler;

import com.basicframework.framework.desensitize.core.slider.annotation.SliderDesensitize;
import org.junit.jupiter.api.Test;

import java.lang.annotation.Annotation;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证脱敏处理器默认的“禁用脱敏”表达式读取契约。
 *
 * <p>禁用开关是脱敏链路的旁路：表达式求值为真时接口会回显原文。处理器默认按约定从注解的
 * {@code disable} 属性读取该表达式，读取不到时只能视为“未禁用”，不能把反射异常抛到序列化阶段，
 * 否则一次注解不匹配就会让整个响应失败。因此这里同时锁定“表达式原样透传”和“读取失败的兜底”。</p>
 *
 * @author shady2713
 */
class DesensitizationHandlerTest {

    /** 被测处理器，只观察默认实现的读取行为，不参与真实脱敏输出。 */
    private static final ProbeHandler HANDLER = new ProbeHandler();

    /**
     * 注解声明了 disable 表达式时必须原样返回，交由调用方按 Spring EL 求值。
     *
     * <p>这里刻意断言字符串本身而不是布尔结果：处理器只负责读取，提前求值会把
     * 非法表达式和“未声明表达式”混为一谈。</p>
     *
     * @throws NoSuchFieldException 样例字段缺失时抛出，说明测试夹具被改动
     */
    @Test
    void readsDisableExpressionDeclaredByAnnotation() throws NoSuchFieldException {
        assertThat(HANDLER.getDisable(annotationOf("disabledFalse")))
                .as("声明的表达式必须原样透传").isEqualTo("false");
        assertThat(HANDLER.getDisable(annotationOf("disabledExpression")))
                .as("Spring EL 形式的表达式同样原样透传").isEqualTo("#{true}");
    }

    /** 声明了 disable 属性但取默认空值时返回空串，表示不禁用脱敏。 */
    @Test
    void defaultDisableExpressionStaysEmpty() throws NoSuchFieldException {
        assertThat(HANDLER.getDisable(annotationOf("defaultDisabled"))).isEmpty();
    }

    /**
     * 注解完全没有 disable 属性时必须返回空串，而不是抛出反射异常。
     *
     * <p>默认实现按“注解带 disable 属性”的约定读取；历史或第三方脱敏注解不满足该约定时，
     * 读取失败若向外传播会让整段脱敏在序列化阶段失败，因此失败必须收敛成“不禁用”。</p>
     *
     * @throws NoSuchFieldException 样例字段缺失时抛出，说明测试夹具被改动
     */
    @Test
    void missingDisableAttributeFallsBackToEmptyExpression() throws NoSuchFieldException {
        LegacyAnnotation annotation = LegacySample.class.getDeclaredField("legacy")
                .getAnnotation(LegacyAnnotation.class);
        assertThat(annotation).as("测试字段必须带历史脱敏注解").isNotNull();

        assertThat(HANDLER.getDisable(annotation))
                .as("缺少 disable 属性时不得抛异常，也不得被误判为禁用").isEmpty();
    }

    /**
     * 从样例字段读取真实声明的滑动脱敏注解。
     *
     * @param fieldName 样例字段名
     * @return 字段上声明的滑动脱敏注解
     * @throws NoSuchFieldException 字段不存在时抛出，说明测试夹具被改动
     */
    private static SliderDesensitize annotationOf(String fieldName) throws NoSuchFieldException {
        SliderDesensitize annotation = Sample.class.getDeclaredField(fieldName)
                .getAnnotation(SliderDesensitize.class);
        assertThat(annotation).as("测试字段 %s 必须带滑动脱敏注解", fieldName).isNotNull();
        return annotation;
    }

    /**
     * 只实现脱敏动作的处理器，用于以声明类型 {@link Annotation} 观察默认 {@code getDisable} 的行为。
     */
    static class ProbeHandler implements DesensitizationHandler<Annotation> {

        /** 本用例不验证脱敏输出，原样返回输入。 */
        @Override
        public String desensitize(String origin, Annotation annotation) {
            return origin;
        }
    }

    /** 声明多种 disable 配置的样例类型。 */
    static class Sample {

        /** 未声明 disable，取默认空表达式。 */
        @SliderDesensitize
        private String defaultDisabled;

        /** 显式声明字符串表达式。 */
        @SliderDesensitize(disable = "false")
        private String disabledFalse;

        /** 声明 Spring EL 形式表达式。 */
        @SliderDesensitize(disable = "#{true}")
        private String disabledExpression;
    }

    /** 不提供 disable 属性的历史脱敏注解，用于验证默认实现的兜底行为。 */
    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.FIELD)
    @interface LegacyAnnotation {

        /** 历史注解的唯一属性。 */
        String value() default "";
    }

    /** 声明历史脱敏注解的样例类型。 */
    static class LegacySample {

        /** 只带历史注解、没有 disable 属性的字段。 */
        @LegacyAnnotation("legacy")
        private String legacy;
    }
}
