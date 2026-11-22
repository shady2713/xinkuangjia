package com.basicframework.framework.common.util.validation;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证等保二级密码复杂度的正常、边界和失败输入。
 *
 * @author shady2713
 */
class PasswordPolicyTest {

    /** 验证 8 位和 32 位边界及三类字符组合通过。 */
    @Test
    void acceptsValidPasswords() {
        assertThat(ValidationUtils.isPassword("Abcdef12")).isTrue();
        assertThat(ValidationUtils.isPassword("Abcdef1#")).isTrue();
        assertThat(ValidationUtils.isPassword("aB3$efgh")).isTrue();
        assertThat(ValidationUtils.isPassword("A1!" + "x".repeat(29))).isTrue();
    }

    /** 验证长度、字符类别、空格和非 ASCII 字符的失败输入。 */
    @Test
    void rejectsInvalidPasswords() {
        assertThat(ValidationUtils.isPassword(null)).isFalse();
        assertThat(ValidationUtils.isPassword("")).isFalse();
        assertThat(ValidationUtils.isPassword("Ab1#efg")).isFalse();
        assertThat(ValidationUtils.isPassword("A1!" + "x".repeat(30))).isFalse();
        assertThat(ValidationUtils.isPassword("abcdefgh")).isFalse();
        assertThat(ValidationUtils.isPassword("ABCDEFGH")).isFalse();
        assertThat(ValidationUtils.isPassword("12345678")).isFalse();
        assertThat(ValidationUtils.isPassword("Abcdefgh")).isFalse();
        assertThat(ValidationUtils.isPassword("Abcdef 1")).isFalse();
        assertThat(ValidationUtils.isPassword("Abcdef1中")).isFalse();
    }
}
