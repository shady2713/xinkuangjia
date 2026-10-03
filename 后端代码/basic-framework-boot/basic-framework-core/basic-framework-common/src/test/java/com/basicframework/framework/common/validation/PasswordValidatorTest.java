package com.basicframework.framework.common.validation;

import com.basicframework.framework.common.util.validation.ValidationUtils;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证密码复杂度校验器的真实边界，覆盖直接调用与注解驱动两条路径。
 *
 * <p>空值被刻意判为通过：是否必填由 {@code @NotNull} 等必填注解负责，
 * 复杂度校验器若一并拒绝，会让“未填写”的提示变成复杂度错误，误导用户。</p>
 *
 * @author shady2713
 */
class PasswordValidatorTest {

    private static ValidatorFactory validatorFactory;
    private static Validator validator;

    /** 建立真实 JSR-303 校验器，使注解路径与生产一致。 */
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

    /** 符合复杂度要求的密码必须通过。 */
    @Test
    void compliantPasswordIsAccepted() {
        assertThat(validator(new PasswordHolder("Passw0rd"))).isEmpty();
    }

    /** 缺少小写字母必须拒绝。 */
    @Test
    void passwordWithoutLowerCaseIsRejected() {
        assertThat(validator(new PasswordHolder("PASSW0RD"))).hasSize(1);
    }

    /** 缺少大写字母必须拒绝。 */
    @Test
    void passwordWithoutUpperCaseIsRejected() {
        assertThat(validator(new PasswordHolder("passw0rd"))).hasSize(1);
    }

    /** 缺少数字必须拒绝。 */
    @Test
    void passwordWithoutDigitIsRejected() {
        assertThat(validator(new PasswordHolder("Password"))).hasSize(1);
    }

    /** 长度不足 6 位必须拒绝，短密码易被暴力破解。 */
    @Test
    void tooShortPasswordIsRejected() {
        assertThat(validator(new PasswordHolder("Pw0rd"))).hasSize(1);
    }

    /** 超过 16 位必须拒绝，长度上限用于限制口令猜测成本区间。 */
    @Test
    void tooLongPasswordIsRejected() {
        assertThat(validator(new PasswordHolder("Aa0" + "b".repeat(14)))).hasSize(1);
    }

    /** 恰好 6 位与恰好 16 位是允许的边界值，必须通过。 */
    @Test
    void lengthBoundariesAreAccepted() {
        assertThat(validator(new PasswordHolder("Aa0bcd"))).isEmpty();
        assertThat(validator(new PasswordHolder("Aa0" + "b".repeat(13)))).isEmpty();
    }

    /** 特殊字符不在允许字符集内，必须拒绝，避免与后续加密或转义产生歧义。 */
    @Test
    void passwordWithSpecialCharacterIsRejected() {
        assertThat(validator(new PasswordHolder("Passw0rd!"))).hasSize(1);
        assertThat(validator(new PasswordHolder("Passw0rd@"))).hasSize(1);
        assertThat(validator(new PasswordHolder("Pass 0rd"))).hasSize(1);
    }

    /** Unicode 字符不在允许字符集内，必须拒绝。 */
    @Test
    void passwordWithUnicodeIsRejected() {
        assertThat(validator(new PasswordHolder("Passw0rd中"))).hasSize(1);
        assertThat(validator(new PasswordHolder("密码Passw0rd"))).hasSize(1);
    }

    /** 空值与空白由必填注解负责，复杂度校验器必须放行。 */
    @Test
    void blankPasswordPassesComplexityCheck() {
        assertThat(validator(new PasswordHolder(null))).isEmpty();
        assertThat(validator(new PasswordHolder(""))).isEmpty();
    }

    /** 校验器直接调用时，空值同样判为通过，保持与注解路径一致。 */
    @Test
    void directValidatorCallMatchesAnnotationBehavior() {
        PasswordValidator passwordValidator = new PasswordValidator();

        assertThat(passwordValidator.isValid(null, null)).isTrue();
        assertThat(passwordValidator.isValid("", null)).isTrue();
        assertThat(passwordValidator.isValid("Passw0rd", null)).isTrue();
        assertThat(passwordValidator.isValid("password", null)).isFalse();
    }

    /** 校验器直接调用与底层规则必须给出相同结论，避免两处规则漂移。 */
    @Test
    void directValidatorAgreesWithSharedRule() {
        PasswordValidator passwordValidator = new PasswordValidator();
        for (String candidate : new String[] {"Passw0rd", "passw0rd", "PASSW0RD", "Passw0r", "Aa0bcd",
                "Aa0" + "b".repeat(13), "Aa0" + "b".repeat(14), "Passw0rd!", "密码Passw0rd"}) {
            assertThat(passwordValidator.isValid(candidate, null))
                    .as("候选值=%s 必须与共享规则一致", candidate)
                    .isEqualTo(ValidationUtils.isPassword(candidate));
        }
    }

    /** 校验失败提示必须与注解声明一致，避免前端拿到不同文案。 */
    @Test
    void violationMessageMatchesAnnotationContract() {
        Set<ConstraintViolation<PasswordHolder>> violations = validator(new PasswordHolder("password"));

        assertThat(violations).hasSize(1);
        assertThat(violations.iterator().next().getMessage())
                .isEqualTo("密码必须为 6-16 位，且同时包含大写字母、小写字母和数字");
    }

    /** 违规路径必须指向密码字段，便于前端定位到具体输入框。 */
    @Test
    void violationTargetsPasswordProperty() {
        Set<ConstraintViolation<PasswordHolder>> violations = validator(new PasswordHolder("password"));

        assertThat(violations.iterator().next().getPropertyPath().toString()).isEqualTo("password");
    }

    /** 执行校验并返回违规集合。 */
    private static Set<ConstraintViolation<PasswordHolder>> validator(PasswordHolder holder) {
        return validator.validate(holder);
    }

    /** 密码校验样例对象。 */
    static class PasswordHolder {

        /** 待校验密码。 */
        @Password
        private final String password;

        /** 构造样例对象。 */
        PasswordHolder(String password) {
            this.password = password;
        }

        /** 供校验框架读取属性。 */
        public String getPassword() {
            return password;
        }
    }
}
