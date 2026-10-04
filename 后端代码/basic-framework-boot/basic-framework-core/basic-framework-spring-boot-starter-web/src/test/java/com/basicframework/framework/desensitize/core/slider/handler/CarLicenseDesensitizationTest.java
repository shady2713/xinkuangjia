package com.basicframework.framework.desensitize.core.slider.handler;

import cn.hutool.extra.spring.SpringUtil;
import com.basicframework.framework.desensitize.core.slider.annotation.CarLicenseDesensitize;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContext;
import org.springframework.context.support.StaticApplicationContext;

import java.lang.reflect.Field;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证车牌号滑动脱敏处理器读取注解声明、遵守禁用开关的真实行为。
 *
 * <p>车牌号属于可定位到车主的信息，脱敏必须按字段声明执行：默认保留前 3 位与后 1 位，
 * 中间全部遮蔽；长度不超过保留之和时整串遮蔽，避免短号牌原样返回。与银行卡处理器不同，
 * 车牌处理器把注解的 {@code disable} 表达式交给基类经 Spring EL 求值，因此显式声明
 * {@code disable="true"} 时必须返回原文，供排障与特定业务场景临时关闭脱敏；求值需要真实
 * Spring 上下文提供 Bean 解析器，本用例按生产装配绑定最小上下文。</p>
 *
 * @author shady2713
 */
class CarLicenseDesensitizationTest {

    /** 被测车牌号脱敏处理器，无状态可跨用例复用。 */
    private static final CarLicenseDesensitization HANDLER = new CarLicenseDesensitization();

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

    /** 默认保留前 3 位与后 1 位，中间字符必须全部遮蔽。 */
    @Test
    void defaultKeepsMaskTheMiddleCharacters() {
        CarLicenseDesensitize annotation = annotationOf(Sample.class, "carLicense", CarLicenseDesensitize.class);

        assertThat(HANDLER.getPrefixKeep(annotation)).isEqualTo(3);
        assertThat(HANDLER.getSuffixKeep(annotation)).isEqualTo(1);
        assertThat(HANDLER.getReplacer(annotation)).isEqualTo("*");
        assertThat(HANDLER.desensitize("粤A66666", annotation))
                .as("车牌号脱敏结果不得包含中间字符").isEqualTo("粤A6***6")
                .doesNotContain("6666");
    }

    /** 注解显式声明的保留位数与替换符必须生效，不得固定为默认规则。 */
    @Test
    void customKeepsAndReplacerAreReadFromAnnotation() {
        CarLicenseDesensitize annotation = annotationOf(Sample.class, "carLicenseCustom", CarLicenseDesensitize.class);

        assertThat(HANDLER.getPrefixKeep(annotation)).isEqualTo(2);
        assertThat(HANDLER.getSuffixKeep(annotation)).isEqualTo(2);
        assertThat(HANDLER.getReplacer(annotation)).isEqualTo("#");
        assertThat(HANDLER.desensitize("粤A66666", annotation))
                .as("自定义保留位数与替换符必须生效").isEqualTo("粤A###66");
    }

    /** 长度不超过前后缀保留之和时必须整串遮蔽，不能保留任何原文。 */
    @Test
    void valuesNotLongerThanKeptRangeAreFullyMasked() {
        CarLicenseDesensitize annotation = annotationOf(Sample.class, "carLicense", CarLicenseDesensitize.class);

        assertThat(HANDLER.desensitize("粤A66", annotation))
                .as("长度等于 3+1 时整串遮蔽").isEqualTo("****");
        assertThat(HANDLER.desensitize("粤A", annotation)).as("短号牌整串遮蔽").isEqualTo("**");
        assertThat(HANDLER.desensitize("", annotation)).as("空串不产生多余字符").isEmpty();
    }

    /** 注解声明禁用为常量真时必须返回原文，供排障时查看真实取值。 */
    @Test
    void disableExpressionReturnsOrigin() {
        bindApplicationContext(new StaticApplicationContext());
        CarLicenseDesensitize annotation = annotationOf(Sample.class, "carLicenseDisabled", CarLicenseDesensitize.class);

        assertThat(HANDLER.getDisable(annotation)).as("车牌处理器读取注解声明的禁用表达式")
                .isEqualTo("true");
        assertThat(HANDLER.desensitize("粤A66666", annotation)).isEqualTo("粤A66666");
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

    /** 声明车牌号脱敏默认、自定义与禁用配置的样例类型。 */
    static class Sample {

        /** 使用默认保留位数的车牌号。 */
        @CarLicenseDesensitize
        private String carLicense;

        /** 保留 2 位前缀与 2 位后缀、使用井号替换符的车牌号。 */
        @CarLicenseDesensitize(prefixKeep = 2, suffixKeep = 2, replacer = "#")
        private String carLicenseCustom;

        /** 显式禁用脱敏的车牌号。 */
        @CarLicenseDesensitize(disable = "true")
        private String carLicenseDisabled;
    }
}
