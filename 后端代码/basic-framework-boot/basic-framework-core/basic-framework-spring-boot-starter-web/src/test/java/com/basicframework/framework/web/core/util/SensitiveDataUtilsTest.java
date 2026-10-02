package com.basicframework.framework.web.core.util;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 Web 日志敏感字段的统一识别规则。
 *
 * @author 李杰
 */
class SensitiveDataUtilsTest {

    /**
     * 验证大小写和连接符变化不能绕过默认敏感字段识别。
     */
    @Test
    void shouldRecognizeDefaultSensitiveKeyVariants() {
        assertThat(SensitiveDataUtils.isSensitiveKey("Password")).isTrue();
        assertThat(SensitiveDataUtils.isSensitiveKey("access_token")).isTrue();
        assertThat(SensitiveDataUtils.isSensitiveKey("client-secret")).isTrue();
        assertThat(SensitiveDataUtils.isSensitiveKey("Authorization")).isTrue();
        assertThat(SensitiveDataUtils.isSensitiveKey("x-api-key")).isTrue();
    }

    /**
     * 验证调用方追加字段采用相同的归一化比较规则。
     */
    @Test
    void shouldRecognizeAdditionalSensitiveKeyVariants() {
        assertThat(SensitiveDataUtils.isSensitiveKey("identity_no", "identityNo")).isTrue();
        assertThat(SensitiveDataUtils.isSensitiveKey("userName", "identityNo")).isFalse();
    }

    /**
     * 验证空字段和普通业务字段不会被误判。
     */
    @Test
    void shouldIgnoreEmptyAndOrdinaryKeys() {
        assertThat(SensitiveDataUtils.isSensitiveKey(null)).isFalse();
        assertThat(SensitiveDataUtils.isSensitiveKey(" ")).isFalse();
        assertThat(SensitiveDataUtils.isSensitiveKey("userName")).isFalse();
    }
}
