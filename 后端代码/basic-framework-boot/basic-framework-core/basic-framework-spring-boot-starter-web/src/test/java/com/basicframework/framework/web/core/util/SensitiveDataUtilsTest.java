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

    /**
     * 验证调用方整体缺失追加字段（显式传入 null 数组）时按“没有追加字段”处理。
     *
     * <p>追加字段来自调用方配置，可能整份缺失。该方法运行在日志脱敏路径上，
     * 抛出空指针会让日志写入失败，并可能把原始字段名带进错误日志；
     * 同时默认敏感字段的识别不能因为追加字段缺失而失效。</p>
     */
    @Test
    void shouldTreatNullAdditionalKeysAsAbsent() {
        assertThat(SensitiveDataUtils.isSensitiveKey("userName", (String[]) null)).isFalse();
        assertThat(SensitiveDataUtils.isSensitiveKey("password", (String[]) null)).isTrue();
    }
}
