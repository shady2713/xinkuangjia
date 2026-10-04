package com.basicframework.framework.common.validation;

import com.basicframework.framework.common.util.validation.ValidationUtils;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证百分比注解在“空值放行、0-100 且最多两位小数通过、其它取值拒绝”三条口径上的真实行为。
 *
 * <p>百分比字段在接口入参里既可能来自 JSON 数值，也可能来自表单文本，因此数值与字符序列
 * 都必须支持；但布尔、集合一类非百分比取值必须被拒，避免类型误用被静默接受。空值刻意放行，
 * 是否必填由 {@code @NotNull} 决定，避免漏填时收到“百分比必须在 0-100 之间”的误导提示。</p>
 *
 * <p>本用例同时走注解路径与直接调用路径：注解路径锁定提示文案与前端展示口径，直接调用路径
 * 锁定校验器与共享规则 {@link ValidationUtils#isPercent(Number)}、{@link ValidationUtils#isPercent(String)}
 * 的结论一致，防止两处规则漂移。</p>
 *
 * @author shady2713
 */
class PercentValidatorTest {

    /** 真实校验器工厂，本类独占并负责关闭。 */
    private static ValidatorFactory validatorFactory;
    /** 与接口入参一致的校验器。 */
    private static Validator validator;

    /** 建立真实 Bean Validation 校验器，使注解路径与生产接口一致。 */
    @BeforeAll
    static void createValidator() {
        validatorFactory = Validation.buildDefaultValidatorFactory();
        validator = validatorFactory.getValidator();
    }

    /** 关闭校验器工厂，释放其持有的资源。 */
    @AfterAll
    static void closeValidator() {
        validatorFactory.close();
    }

    /** 空值必须放行，是否必填由必填类注解单独承担。 */
    @Test
    void nullValueIsAccepted() {
        PercentValidator direct = new PercentValidator();

        assertThat(direct.isValid(null, null)).as("未填写不属于格式错误").isTrue();
        assertThat(violations(new PercentHolder(null))).isEmpty();
    }

    /** 范围内且最多两位小数的数值与文本都必须通过。 */
    @Test
    void validPercentsAreAccepted() {
        PercentValidator direct = new PercentValidator();

        assertThat(direct.isValid(0, null)).isTrue();
        assertThat(direct.isValid(100, null)).as("100 是闭区间上界").isTrue();
        assertThat(direct.isValid(99.99D, null)).isTrue();
        assertThat(direct.isValid(100.0D, null)).as("整数位零值等价于 100").isTrue();
        assertThat(direct.isValid(new BigDecimal("100.00"), null)).isTrue();
        assertThat(direct.isValid(50L, null)).as("其它 Number 子类同样合法").isTrue();

        assertThat(direct.isValid("0", null)).isTrue();
        assertThat(direct.isValid("0.5", null)).isTrue();
        assertThat(direct.isValid("100.00", null)).isTrue();
        assertThat(direct.isValid(new StringBuilder("50"), null))
                .as("其它 CharSequence 实现同样按文本校验").isTrue();

        assertThat(violations(new PercentHolder(50))).isEmpty();
        assertThat(violations(new PercentHolder("99.99"))).isEmpty();
    }

    /** 越界、超出两位小数与非数字文本都必须被拒，注解路径同时给出声明文案。 */
    @Test
    void outOfRangeAndMalformedValuesAreRejected() {
        PercentValidator direct = new PercentValidator();

        assertThat(direct.isValid(101, null)).isFalse();
        assertThat(direct.isValid(-1, null)).isFalse();
        assertThat(direct.isValid(100.01D, null)).as("超过 100 的两位小数仍越界").isFalse();
        assertThat(direct.isValid("100.001", null)).as("最多两位小数").isFalse();
        assertThat(direct.isValid("50.123", null)).isFalse();
        assertThat(direct.isValid("abc", null)).isFalse();
        assertThat(direct.isValid("", null)).isFalse();
        assertThat(direct.isValid("  ", null)).as("空白文本不是百分比").isFalse();
        assertThat(direct.isValid("1e2", null)).as("科学计数法文本不被接受").isFalse();

        assertThat(messages(new PercentHolder(101))).containsExactly("百分比必须在 0-100 之间，最多保留两位小数");
        assertThat(messages(new PercentHolder("50.123"))).containsExactly("百分比必须在 0-100 之间，最多保留两位小数");
    }

    /** 既不是数值也不是字符序列的取值必须被拒，避免类型误用被接受。 */
    @Test
    void nonNumericValuesAreRejected() {
        PercentValidator direct = new PercentValidator();

        assertThat(direct.isValid(Boolean.TRUE, null)).isFalse();
        assertThat(direct.isValid(new Object(), null)).isFalse();

        assertThat(messages(new PercentHolder(Boolean.TRUE))).containsExactly("百分比必须在 0-100 之间，最多保留两位小数");
    }

    /** 校验器结论必须与共享规则在数值与文本两条入口上完全一致。 */
    @Test
    void validatorAgreesWithSharedPercentRule() {
        PercentValidator direct = new PercentValidator();
        Number[] numbers = {0, 100, 101, -1, 99.99D, 100.0D, 100.01D, 50L, new BigDecimal("100.00")};
        String[] texts = {"0", "0.5", "99.99", "100", "100.00", "100.001", "101", "-1", "abc", ""};

        for (Number sample : numbers) {
            assertThat(direct.isValid(sample, null))
                    .as("数值 %s 的校验器结论必须与共享规则一致", sample)
                    .isEqualTo(ValidationUtils.isPercent(sample));
        }
        for (String sample : texts) {
            assertThat(direct.isValid(sample, null))
                    .as("文本 %s 的校验器结论必须与共享规则一致", sample)
                    .isEqualTo(ValidationUtils.isPercent(sample));
        }
    }

    /** 校验对象并返回全部约束违规。 */
    private static Set<ConstraintViolation<PercentHolder>> violations(PercentHolder target) {
        return validator.validate(target);
    }

    /** 校验对象并返回全部违规提示文案，用于锁定前端展示口径。 */
    private static Set<String> messages(PercentHolder target) {
        return violations(target).stream()
                .map(ConstraintViolation::getMessage)
                .collect(Collectors.toSet());
    }

    /** 声明百分比字段的样例类型；字段类型为 {@link Object} 以便直接验证非数字取值的拒绝行为。 */
    static class PercentHolder {

        /** 待校验的百分比取值。 */
        @Percent
        private Object percent;

        /** 以指定取值构造样例。 */
        PercentHolder(Object percent) {
            this.percent = percent;
        }
    }
}
