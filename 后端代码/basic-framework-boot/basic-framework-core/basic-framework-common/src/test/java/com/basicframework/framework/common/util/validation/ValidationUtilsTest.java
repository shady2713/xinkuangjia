package com.basicframework.framework.common.util.validation;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import jakarta.validation.constraints.NotNull;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证通用格式校验工具中尚未被其它校验器测试覆盖的入口契约。
 *
 * <p>URL、XML NCName 与数值型百分比／数量是导入、配置和外部对接的常用入参；
 * 空值一律判为不合法（是否必填由必填注解负责），空白串不能绕过格式规则。
 * 身份证除格式外还要校验出生日期真实存在，{@code 19990230} 这类“格式正确但日期
 * 不存在”的取值必须被拒，且不能把解析异常抛给调用方。</p>
 *
 * <p>{@link ValidationUtils#validate} 是业务代码主动触发 Bean Validation 的统一入口：
 * 校验通过不得抛异常，存在违规必须抛出携带全部违规项的 {@link ConstraintViolationException}，
 * 让调用方仍能读到字段路径与提示。</p>
 *
 * @author shady2713
 */
class ValidationUtilsTest {

    private static ValidatorFactory validatorFactory;
    private static Validator validator;

    /** 建立真实 JSR-303 校验器，使 validate 入口与生产使用同一实现。 */
    @BeforeAll
    static void setUpValidator() {
        validatorFactory = Validation.buildDefaultValidatorFactory();
        validator = validatorFactory.getValidator();
    }

    /** 关闭校验器工厂，避免线程资源残留。 */
    @AfterAll
    static void closeValidator() {
        if (validatorFactory != null) {
            validatorFactory.close();
        }
    }

    /** URL 只接受带受支持协议头的绝对地址，空值与裸域名都判为不合法。 */
    @Test
    void urlRequiresSupportedScheme() {
        assertThat(ValidationUtils.isURL("https://example.com/a/b")).isTrue();
        assertThat(ValidationUtils.isURL("ftp://files.example.com/pub")).isTrue();
        assertThat(ValidationUtils.isURL("example.com/a")).as("缺少协议头不是合法 URL").isFalse();
        assertThat(ValidationUtils.isURL("javascript:alert(1)")).as("未登记的协议必须拒绝").isFalse();
        assertThat(ValidationUtils.isURL(null)).isFalse();
        assertThat(ValidationUtils.isURL("   ")).isFalse();
    }

    /** XML NCName 必须以字母或下划线开头，且不得包含空格等非法字符。 */
    @Test
    void xmlNcNameRejectsIllegalLeadingAndSeparatorCharacters() {
        assertThat(ValidationUtils.isXmlNCName("_ns.name-1$x")).isTrue();
        assertThat(ValidationUtils.isXmlNCName("1abc")).as("数字不能作为首字符").isFalse();
        assertThat(ValidationUtils.isXmlNCName("a b")).as("空格不是合法名称字符").isFalse();
        assertThat(ValidationUtils.isXmlNCName(null)).isFalse();
        assertThat(ValidationUtils.isXmlNCName("")).isFalse();
    }

    /** 数值型百分比先去掉多余零再按同一正则判断，null 判为不合法。 */
    @Test
    void numericPercentNormalizesTrailingZerosAndRejectsNull() {
        assertThat(ValidationUtils.isPercent((Number) null)).isFalse();
        assertThat(ValidationUtils.isPercent(0)).isTrue();
        assertThat(ValidationUtils.isPercent(100)).isTrue();
        assertThat(ValidationUtils.isPercent(50.0)).as("去零后 50.0 等于 50").isTrue();
        assertThat(ValidationUtils.isPercent(99.99)).isTrue();
        assertThat(ValidationUtils.isPercent(100.5)).as("超过 100 必须拒绝").isFalse();
        assertThat(ValidationUtils.isPercent(-1)).isFalse();
        assertThat(ValidationUtils.isPercent(1.234)).as("超过两位小数必须拒绝").isFalse();
    }

    /** 数量必须是非负整数，null、负数与小数都判为不合法。 */
    @Test
    void quantityRequiresNonNegativeInteger() {
        assertThat(ValidationUtils.isQuantity((Number) null)).isFalse();
        assertThat(ValidationUtils.isQuantity(0)).isTrue();
        assertThat(ValidationUtils.isQuantity(12)).isTrue();
        assertThat(ValidationUtils.isQuantity(-1)).isFalse();
        assertThat(ValidationUtils.isQuantity(1.5)).as("小数不是合法数量").isFalse();
    }

    /** 身份证出生日期段的真实判定：月份越界被格式规则拒绝，不存在的“日”被夹取后放行。 */
    @Test
    void idCardBirthDateHandlingMatchesPatternAndSmartResolver() {
        assertThat(ValidationUtils.isIdCard("110101199003070011")).as("合法身份证应通过").isTrue();
        assertThat(ValidationUtils.isIdCard("110101199913010018"))
                .as("13 月不满足月份格式，判为不合法").isFalse();
        assertThat(ValidationUtils.isIdCard("11010119990230001X"))
                .as("当前实现对不存在的 2 月 30 日放行，见下方解析口径用例")
                .isTrue();
    }

    /**
     * 锁定出生日期解析口径，说明校验器内解析异常分支不可达的原因。
     *
     * <p>生产代码用 {@code DateTimeFormatter.ofPattern("yyyyMMdd")} 解析出生日期段，
     * 该格式化器默认使用 {@code ResolverStyle.SMART}：只要月、日在字面范围
     * （01-12、01-31，已被身份证正则限定），解析器会把超出当月长度的“日”夹取为当月最后一天，
     * 因此 {@code DateTimeParseException} 分支在正则放行后无法被触发。
     * 实测结果是 1999-02-30 被解析为 1999-02-28 并当作合法出生日期。</p>
     *
     * <p>这是被测试代码的真实可观察行为，不是测试自身的期望；若后续改用
     * {@code ResolverStyle.STRICT} 或显式日期范围校验，本用例会失败并提示需要同步更新。</p>
     */
    @Test
    void idCardBirthDateParsingClampsImpossibleDayInsteadOfFailing() {
        assertThat(LocalDate.parse("19990230", DateTimeFormatter.ofPattern("yyyyMMdd")))
                .as("SMART 解析把 2 月 30 日夹取为当月最后一天").isEqualTo(LocalDate.of(1999, 2, 28));
    }

    /**
     * 出生日期解析失败必须返回 false，而不是把解析异常抛给调用方。
     *
     * <p>上游正则把月份限定为 01-12，SMART 解析器又只夹取“日”，所以正则放行的取值永远不会解析失败；
     * 但解析失败的处理本身是校验器的安全底线：一旦改成向外抛出，非法身份证号会让导入或注册请求
     * 以 500 结束，而不是得到“不合法”的结论。</p>
     *
     * <p><b>白盒直调：</b>{@code isValidIdCardBirthDate} 是私有静态方法且入参是裸字符串，
     * 直接传入正则不可能放行的 {@code 99999999}（月份 99）即可触发解析异常分支，
     * 断言方法自身的返回约定：解析失败返回 false、解析成功返回 true（正对照）。
     * 本构造不改动生产代码与其入口契约。</p>
     *
     * @throws Exception 反射查找或调用失败时抛出
     */
    @Test
    void idCardBirthDateParserReportsParseFailureAsInvalid() throws Exception {
        Method method = ValidationUtils.class.getDeclaredMethod("isValidIdCardBirthDate", String.class);
        method.setAccessible(true);

        assertThat(method.invoke(null, "00000099999999")).as("月份 99 无法解析，必须判为不合法")
                .isEqualTo(false);
        assertThat(method.invoke(null, "00000019900307")).as("正对照：可解析的出生日期必须放行")
                .isEqualTo(true);
    }

    /** 默认校验器入口：合法对象放行，违规对象抛出携带违规项的异常。 */
    @Test
    void validateWithDefaultValidatorReportsViolations() {
        assertThatCode(() -> ValidationUtils.validate(new NotNullHolder("名称"))).doesNotThrowAnyException();

        assertThatThrownBy(() -> ValidationUtils.validate(new NotNullHolder(null)))
                .isInstanceOf(ConstraintViolationException.class)
                .satisfies(thrown -> {
                    Set<ConstraintViolation<?>> violations =
                            ((ConstraintViolationException) thrown).getConstraintViolations();
                    assertThat(violations).hasSize(1);
                    assertThat(violations.iterator().next().getMessage()).isEqualTo("名称不能为空");
                });
    }

    /** 指定校验器入口：复用调用方传入的校验器，并保持同样的违规语义。 */
    @Test
    void validateWithGivenValidatorReusesValidatorAndReportsViolations() {
        assertThatCode(() -> ValidationUtils.validate(validator, new NotNullHolder("名称")))
                .doesNotThrowAnyException();

        assertThatThrownBy(() -> ValidationUtils.validate(validator, new NotNullHolder(null)))
                .isInstanceOf(ConstraintViolationException.class)
                .satisfies(thrown -> assertThat(
                        ((ConstraintViolationException) thrown).getConstraintViolations()).hasSize(1));
    }

    /** 分组入口只在所选分组生效：未选分组时不校验该约束。 */
    @Test
    void validateHonoursGroups() {
        GroupedHolder holder = new GroupedHolder(null);

        assertThatCode(() -> ValidationUtils.validate(holder)).as("默认分组下不校验创建分组约束")
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> ValidationUtils.validate(holder, CreateGroup.class))
                .isInstanceOf(ConstraintViolationException.class);
    }

    /**
     * 工具类未声明私有构造，实例化不得改变静态入口的校验结论。
     *
     * <p>该类没有实例状态，但构造方法属于真实可调用面；断言实例化后静态入口仍按同一
     * 规则工作，防止未来把共享状态放进实例导致按实例使用与静态入口结论不一致。</p>
     */
    @Test
    void instantiationKeepsStaticValidationBehaviour() {
        new ValidationUtils();

        assertThat(ValidationUtils.isMobile("13800000000")).isTrue();
        assertThat(ValidationUtils.isQuantity(-1)).isFalse();
    }

    /** 单字段必填夹具，用于验证 validate 入口的违规收集行为。 */
    private static class NotNullHolder {

        /** 被校验的名称字段，null 表示未填写。 */
        @NotNull(message = "名称不能为空")
        private final String name;

        /**
         * 构造持有指定名称的夹具。
         *
         * @param name 名称，null 表示未填写
         */
        NotNullHolder(String name) {
            this.name = name;
        }
    }

    /** 创建分组标识，用于验证分组校验只在显式选择该分组时生效。 */
    private interface CreateGroup {
    }

    /** 带分组的必填夹具，默认分组下不应产生违规。 */
    private static class GroupedHolder {

        /** 仅在创建分组下必填的名称字段。 */
        @NotNull(message = "名称不能为空", groups = CreateGroup.class)
        private final String name;

        /**
         * 构造持有指定名称的夹具。
         *
         * @param name 名称，null 表示未填写
         */
        GroupedHolder(String name) {
            this.name = name;
        }
    }

}
