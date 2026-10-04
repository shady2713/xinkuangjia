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
import java.math.BigInteger;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证数量注解在“空值放行、非负整数通过、其它取值拒绝”三条口径上的真实行为。
 *
 * <p>数量字段既可能是包装类型的整数，也可能是前端 JSON 反序列化出的其它 {@link Number}
 * 子类，因此判定不能只认某一种具体类型；同时小数与负数必须被拒，否则“数量”会以
 * 0.5 或 -1 的形式进入库存、名额一类字段。空值刻意放行，是否必填由 {@code @NotNull}
 * 决定，避免用户漏填时收到“数量必须为非负整数”的误导提示。</p>
 *
 * <p>本用例同时走注解路径与直接调用路径：注解路径锁定提示文案，直接调用路径锁定
 * 校验器与共享规则 {@link ValidationUtils#isQuantity(Number)} 结论一致。</p>
 *
 * @author shady2713
 */
class QuantityValidatorTest {

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
        QuantityValidator direct = new QuantityValidator();

        assertThat(direct.isValid(null, null)).as("未填写不属于格式错误").isTrue();
        assertThat(violations(new QuantityHolder(null))).isEmpty();
    }

    /** 各种 {@link Number} 子类的非负整数取值都必须通过。 */
    @Test
    void nonNegativeIntegersAreAccepted() {
        QuantityValidator direct = new QuantityValidator();

        assertThat(direct.isValid(0, null)).isTrue();
        assertThat(direct.isValid(1, null)).isTrue();
        assertThat(direct.isValid(Integer.MAX_VALUE, null)).isTrue();
        assertThat(direct.isValid(0L, null)).as("Long 类型同样是合法数量").isTrue();
        assertThat(direct.isValid(BigInteger.TEN, null)).as("BigInteger 类型同样是合法数量").isTrue();
        assertThat(direct.isValid(new BigDecimal("10.00"), null))
                .as("纯小数位零值等价于整数 10").isTrue();

        assertThat(violations(new QuantityHolder(10))).isEmpty();
    }

    /** 负数与带有效小数位的取值必须被拒，注解路径同时给出声明文案。 */
    @Test
    void negativeAndFractionalValuesAreRejected() {
        QuantityValidator direct = new QuantityValidator();

        assertThat(direct.isValid(-1, null)).isFalse();
        assertThat(direct.isValid(-1L, null)).isFalse();
        assertThat(direct.isValid(new BigDecimal("-0.5"), null)).isFalse();
        assertThat(direct.isValid(new BigDecimal("0.5"), null))
                .as("有效小数位说明不是整数").isFalse();
        assertThat(direct.isValid(new BigDecimal("10.5"), null)).isFalse();

        assertThat(messages(new QuantityHolder(-1))).containsExactly("数量必须为非负整数");
        assertThat(messages(new QuantityHolder(new BigDecimal("0.5"))))
                .containsExactly("数量必须为非负整数");
    }

    /** 非 {@link Number} 的取值必须被拒，避免字符串数字绕过类型口径。 */
    @Test
    void nonNumberValuesAreRejected() {
        QuantityValidator direct = new QuantityValidator();

        assertThat(direct.isValid("10", null)).as("字符串不是数量类型").isFalse();
        assertThat(direct.isValid(Boolean.TRUE, null)).isFalse();

        assertThat(messages(new QuantityHolder("10"))).containsExactly("数量必须为非负整数");
    }

    /** 校验器结论必须与共享规则 {@link ValidationUtils#isQuantity(Number)} 完全一致。 */
    @Test
    void validatorAgreesWithSharedQuantityRule() {
        QuantityValidator direct = new QuantityValidator();
        Number[] samples = {0, 1, -1, Integer.MAX_VALUE, 0L, -1L, BigInteger.TEN,
                new BigDecimal("10.00"), new BigDecimal("0.5"), new BigDecimal("-3")};

        for (Number sample : samples) {
            assertThat(direct.isValid(sample, null))
                    .as("取值为 %s 时校验器与共享规则必须一致", sample)
                    .isEqualTo(ValidationUtils.isQuantity(sample));
        }
    }

    /** 校验对象并返回全部约束违规。 */
    private static Set<ConstraintViolation<QuantityHolder>> violations(QuantityHolder target) {
        return validator.validate(target);
    }

    /** 校验对象并返回全部违规提示文案，用于锁定前端展示口径。 */
    private static Set<String> messages(QuantityHolder target) {
        return violations(target).stream()
                .map(ConstraintViolation::getMessage)
                .collect(Collectors.toSet());
    }

    /** 声明数量字段的样例类型；字段类型为 {@link Object} 以便直接验证非数字取值的拒绝行为。 */
    static class QuantityHolder {

        /** 待校验的数量取值。 */
        @Quantity
        private Object quantity;

        /** 以指定取值构造样例。 */
        QuantityHolder(Object quantity) {
            this.quantity = quantity;
        }
    }
}
