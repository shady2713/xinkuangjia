package com.basicframework.framework.desensitize.core.slider.handler;

import cn.hutool.extra.spring.SpringUtil;
import com.basicframework.framework.desensitize.core.slider.annotation.ChineseNameDesensitize;
import com.basicframework.framework.desensitize.core.slider.annotation.FixedPhoneDesensitize;
import com.basicframework.framework.desensitize.core.slider.annotation.IdCardDesensitize;
import com.basicframework.framework.desensitize.core.slider.annotation.MobileDesensitize;
import com.basicframework.framework.desensitize.core.slider.annotation.SliderDesensitize;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContext;
import org.springframework.context.support.StaticApplicationContext;

import java.lang.reflect.Field;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证姓名、通用滑动、固话、身份证与手机号五个滑动脱敏处理器的读取与输出契约。
 *
 * <p>这五个处理器是同一抽象基类下仅注解默认值不同的实现，合并在一个用例类中，
 * 是为了把"注解声明"与"处理器读取"两端逐一对照：处理器必须读取真实字段上声明的
 * 保留位数与替换符，而不是各自硬编码一套默认值。一旦某处读取写错（例如把后缀读成前缀），
 * 接口响应就会保留本不该保留的敏感位，且编译与启动都不会报错。</p>
 *
 * <p>输出断言按基类的真实算法核对：长度减去前后缀保留位数得到需要遮蔽的区间；
 * 区间小于等于 0 时整串替换。因此每个处理器都同时锁定"正常长度只遮蔽中间"与
 * "长度不足时整串遮蔽"两个边界，避免短值因保留规则而泄露原文。</p>
 *
 * <p>禁用开关经真实 Spring 容器求值：注解声明 {@code disable} 时必须在容器内解析，
 * 运维才能按环境临时关闭脱敏；容器状态为假时不得变成"永不脱敏"。</p>
 *
 * @author shady2713
 */
class SliderDesensitizationHandlersTest {

    /** 被测姓名脱敏处理器，无状态可跨用例复用。 */
    private static final ChineseNameDesensitization CHINESE_NAME = new ChineseNameDesensitization();
    /** 被测通用滑动脱敏处理器。 */
    private static final DefaultDesensitizationHandler SLIDER = new DefaultDesensitizationHandler();
    /** 被测固定电话脱敏处理器。 */
    private static final FixedPhoneDesensitization FIXED_PHONE = new FixedPhoneDesensitization();
    /** 被测身份证脱敏处理器。 */
    private static final IdCardDesensitization ID_CARD = new IdCardDesensitization();
    /** 被测手机号脱敏处理器。 */
    private static final MobileDesensitization MOBILE = new MobileDesensitization();

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

    /** 中文姓名默认只保留姓氏，其余字符全部遮蔽。 */
    @Test
    void chineseNameKeepsSurnameAndMasksTheRest() {
        ChineseNameDesensitize annotation = annotationOf(Sample.class, "chineseName", ChineseNameDesensitize.class);

        assertThat(CHINESE_NAME.getPrefixKeep(annotation)).isEqualTo(1);
        assertThat(CHINESE_NAME.getSuffixKeep(annotation)).isEqualTo(0);
        assertThat(CHINESE_NAME.getReplacer(annotation)).isEqualTo("*");
        assertThat(CHINESE_NAME.desensitize("刘子豪", annotation))
                .as("姓名脱敏结果不得包含名与字的原文").isEqualTo("刘**")
                .doesNotContain("子豪");
    }

    /** 通用滑动脱敏默认遮蔽整串，显式声明前后缀时只遮蔽中间。 */
    @Test
    void sliderHandlerHonoursDeclaredKeeps() {
        SliderDesensitize defaultAnnotation = annotationOf(Sample.class, "sliderDefault", SliderDesensitize.class);
        SliderDesensitize customAnnotation = annotationOf(Sample.class, "sliderCustom", SliderDesensitize.class);

        assertThat(SLIDER.getPrefixKeep(defaultAnnotation)).isEqualTo(0);
        assertThat(SLIDER.getSuffixKeep(defaultAnnotation)).isEqualTo(0);
        assertThat(SLIDER.getReplacer(defaultAnnotation)).isEqualTo("*");
        assertThat(SLIDER.desensitize("123456", defaultAnnotation)).isEqualTo("******");

        assertThat(SLIDER.getPrefixKeep(customAnnotation)).isEqualTo(1);
        assertThat(SLIDER.getSuffixKeep(customAnnotation)).isEqualTo(2);
        assertThat(SLIDER.getReplacer(customAnnotation)).isEqualTo("*");
        assertThat(SLIDER.desensitize("123456", customAnnotation))
                .as("声明 prefixKeep=1、suffixKeep=2 时保留首尾").isEqualTo("1***56");
    }

    /** 固定电话默认保留 4 位区号段与 2 位尾号，中间全部遮蔽。 */
    @Test
    void fixedPhoneKeepsAreaPrefixAndLastTwoDigits() {
        FixedPhoneDesensitize annotation = annotationOf(Sample.class, "fixedPhone", FixedPhoneDesensitize.class);

        assertThat(FIXED_PHONE.getPrefixKeep(annotation)).isEqualTo(4);
        assertThat(FIXED_PHONE.getSuffixKeep(annotation)).isEqualTo(2);
        assertThat(FIXED_PHONE.getReplacer(annotation)).isEqualTo("*");
        assertThat(FIXED_PHONE.desensitize("01086551122", annotation))
                .as("固话脱敏结果不得包含中间号段").isEqualTo("0108*****22")
                .doesNotContain("6551");
    }

    /** 身份证默认保留 6 位地区码与 2 位尾号，出生日期段必须全部遮蔽。 */
    @Test
    void idCardKeepsRegionCodeAndLastTwoDigits() {
        IdCardDesensitize annotation = annotationOf(Sample.class, "idCard", IdCardDesensitize.class);

        assertThat(ID_CARD.getPrefixKeep(annotation)).isEqualTo(6);
        assertThat(ID_CARD.getSuffixKeep(annotation)).isEqualTo(2);
        assertThat(ID_CARD.getReplacer(annotation)).isEqualTo("*");
        assertThat(ID_CARD.desensitize("530321199204074611", annotation))
                .as("身份证脱敏结果不得包含出生日期段").isEqualTo("530321**********11")
                .doesNotContain("19920407");
    }

    /**
     * 手机号默认保留前 3 位与后 4 位，中间 4 位遮蔽。
     *
     * <p>注解注释里的示例写作 {@code 1511****34}，与声明的 {@code prefixKeep=3、suffixKeep=4}
     * 不一致；处理器按声明执行，因此这里锁定真实输出 {@code 151****1234}，
     * 供后续修正注释时对照（属注释口径问题，未改动生产源码）。</p>
     */
    @Test
    void mobileKeepsThreePrefixAndFourSuffixDigits() {
        MobileDesensitize annotation = annotationOf(Sample.class, "mobile", MobileDesensitize.class);

        assertThat(MOBILE.getPrefixKeep(annotation)).isEqualTo(3);
        assertThat(MOBILE.getSuffixKeep(annotation)).isEqualTo(4);
        assertThat(MOBILE.getReplacer(annotation)).isEqualTo("*");
        assertThat(MOBILE.desensitize("15112341234", annotation))
                .as("手机号脱敏结果按声明保留前 3 后 4").isEqualTo("151****1234");
    }

    /** 各处理器都必须读取注解显式声明的保留位数与替换符，不得使用硬编码默认值。 */
    @Test
    void customReplacerAndKeepsAreReadFromAnnotation() {
        ChineseNameDesensitize chineseName =
                annotationOf(Sample.class, "chineseNameCustom", ChineseNameDesensitize.class);
        SliderDesensitize slider = annotationOf(Sample.class, "sliderReplacer", SliderDesensitize.class);
        FixedPhoneDesensitize fixedPhone =
                annotationOf(Sample.class, "fixedPhoneCustom", FixedPhoneDesensitize.class);
        IdCardDesensitize idCard = annotationOf(Sample.class, "idCardCustom", IdCardDesensitize.class);
        MobileDesensitize mobile = annotationOf(Sample.class, "mobileCustom", MobileDesensitize.class);

        assertThat(CHINESE_NAME.desensitize("欧阳娜娜", chineseName))
                .as("保存姓氏与末字，中间用自定义替换符").isEqualTo("欧##娜");
        assertThat(SLIDER.desensitize("abcdefgh", slider))
                .as("自定义替换符必须生效，避免固定为星号").isEqualTo("ab@@@@gh");
        assertThat(FIXED_PHONE.desensitize("01086551122", fixedPhone))
                .as("后缀保留 0 位时尾号也必须遮蔽").isEqualTo("0108#######");
        assertThat(ID_CARD.desensitize("530321199204074611", idCard))
                .as("自定义三段保留时只遮蔽出生日期").isEqualTo("530@@@@@@@@@@@@611")
                .doesNotContain("19920407");
        assertThat(MOBILE.desensitize("15112341234", mobile))
                .as("后缀保留 0 位时尾号也必须遮蔽").isEqualTo("151########");
    }

    /**
     * 输入长度不超过前后缀保留之和时必须整串遮蔽，不能保留任何原文。
     *
     * <p>短值（例如姓名只有一个字、号码被截断）若仍按比例保留首尾，等于把原文整个返回；
     * 基类的口径是区间不足即整串替换，这里按每个处理器的保留之和取边界值验证。</p>
     */
    @Test
    void valuesNotLongerThanKeptRangeAreFullyMasked() {
        assertThat(CHINESE_NAME.desensitize("李", annotationOf(Sample.class, "chineseName", ChineseNameDesensitize.class)))
                .as("单字姓名必须整串遮蔽").isEqualTo("*");
        assertThat(SLIDER.desensitize("12", annotationOf(Sample.class, "sliderCustom", SliderDesensitize.class)))
                .as("长度等于保留之和时整串遮蔽").isEqualTo("**");
        assertThat(FIXED_PHONE.desensitize("010865", annotationOf(Sample.class, "fixedPhone", FixedPhoneDesensitize.class)))
                .as("长度等于 4+2 时整串遮蔽").isEqualTo("******");
        assertThat(ID_CARD.desensitize("53032119", annotationOf(Sample.class, "idCard", IdCardDesensitize.class)))
                .as("长度等于 6+2 时整串遮蔽").isEqualTo("********");
        assertThat(MOBILE.desensitize("1234567", annotationOf(Sample.class, "mobile", MobileDesensitize.class)))
                .as("长度等于 3+4 时整串遮蔽").isEqualTo("*******");
        assertThat(MOBILE.desensitize("", annotationOf(Sample.class, "mobile", MobileDesensitize.class)))
                .as("空串不产生多余字符").isEmpty();
    }

    /** 禁用表达式为常量真时必须返回原文，供排障时查看真实取值。 */
    @Test
    void disableExpressionReturnsOrigin() {
        bindApplicationContext(new StaticApplicationContext());

        assertThat(MOBILE.desensitize("15112341234", annotationOf(Sample.class, "mobileDisabled", MobileDesensitize.class)))
                .isEqualTo("15112341234");
        assertThat(ID_CARD.desensitize("530321199204074611",
                annotationOf(Sample.class, "idCardDisabled", IdCardDesensitize.class)))
                .isEqualTo("530321199204074611");
    }

    /** 禁用表达式经容器开关求值为假时必须继续脱敏，防止开关写错变成永不脱敏。 */
    @Test
    void disabledSwitchEvaluatedFalseStillMasks() {
        StaticApplicationContext context = new StaticApplicationContext();
        context.getBeanFactory().registerSingleton("desensitizeSwitch", new DesensitizeSwitch(false));
        bindApplicationContext(context);

        assertThat(MOBILE.desensitize("15112341234",
                annotationOf(Sample.class, "mobileDisabledBySwitch", MobileDesensitize.class)))
                .isEqualTo("151****1234");
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

    /** 声明各处理器默认、自定义与禁用配置的样例类型。 */
    static class Sample {

        /** 使用默认保留位数的中文姓名。 */
        @ChineseNameDesensitize
        private String chineseName;

        /** 保留姓氏与末字、使用井号替换符的中文姓名。 */
        @ChineseNameDesensitize(prefixKeep = 1, suffixKeep = 1, replacer = "#")
        private String chineseNameCustom;

        /** 使用默认保留位数的通用滑动脱敏字段。 */
        @SliderDesensitize
        private String sliderDefault;

        /** 保留 1 位前缀与 2 位后缀的通用滑动脱敏字段。 */
        @SliderDesensitize(prefixKeep = 1, suffixKeep = 2)
        private String sliderCustom;

        /** 使用 @ 作为替换符的通用滑动脱敏字段。 */
        @SliderDesensitize(prefixKeep = 2, suffixKeep = 2, replacer = "@")
        private String sliderReplacer;

        /** 使用默认保留位数的固定电话。 */
        @FixedPhoneDesensitize
        private String fixedPhone;

        /** 只保留 4 位前缀、不保留后缀的固定电话。 */
        @FixedPhoneDesensitize(prefixKeep = 4, suffixKeep = 0, replacer = "#")
        private String fixedPhoneCustom;

        /** 使用默认保留位数的身份证号。 */
        @IdCardDesensitize
        private String idCard;

        /** 保留 3 位前缀与 3 位后缀的身份证号。 */
        @IdCardDesensitize(prefixKeep = 3, suffixKeep = 3, replacer = "@")
        private String idCardCustom;

        /** 显式禁用脱敏的身份证号。 */
        @IdCardDesensitize(disable = "true")
        private String idCardDisabled;

        /** 使用默认保留位数的手机号。 */
        @MobileDesensitize
        private String mobile;

        /** 只保留 3 位前缀、不保留后缀的手机号。 */
        @MobileDesensitize(prefixKeep = 3, suffixKeep = 0, replacer = "#")
        private String mobileCustom;

        /** 显式禁用脱敏的手机号。 */
        @MobileDesensitize(disable = "true")
        private String mobileDisabled;

        /** 由容器开关决定是否禁用脱敏的手机号。 */
        @MobileDesensitize(disable = "@desensitizeSwitch.enabled")
        private String mobileDisabledBySwitch;
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
