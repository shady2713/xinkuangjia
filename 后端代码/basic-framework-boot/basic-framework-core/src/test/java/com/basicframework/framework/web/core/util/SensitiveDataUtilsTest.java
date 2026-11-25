package com.basicframework.framework.web.core.util;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.util.json.JsonUtils;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 Web 日志敏感字段识别及请求、响应负载的统一脱敏契约。
 *
 * @author shady
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
     * 验证调用方追加字段采用相同的归一化比较规则，且空白自定义键不会误伤普通字段。
     */
    @Test
    void shouldRecognizeAdditionalSensitiveKeyVariants() {
        assertThat(SensitiveDataUtils.isSensitiveKey("identity_no", "identityNo")).isTrue();
        assertThat(SensitiveDataUtils.isSensitiveKey("userName", "identityNo", null, " ", "---")).isFalse();
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
     * 验证 Map 脱敏会处理空映射、剥离默认及自定义敏感键且不修改原始 Map。
     */
    @Test
    void shouldSanitizeMapWithoutMutatingInput() {
        assertThat(SensitiveDataUtils.sanitizeMap(null)).isNull();
        assertThat(SensitiveDataUtils.sanitizeMap(Collections.emptyMap())).isNull();

        Map<String, String> source = new LinkedHashMap<>();
        source.put("username", "alice");
        source.put("access_token", "tok-123");
        source.put("identity_no", "110101");
        source.put("pageNo", "1");

        String sanitized = SensitiveDataUtils.sanitizeMap(source, "identityNo");

        assertThat(source).containsKeys("access_token", "identity_no");
        JsonNode tree = JsonUtils.parseTree(sanitized);
        assertThat(tree.get("username").asText()).isEqualTo("alice");
        assertThat(tree.get("pageNo").asText()).isEqualTo("1");
        assertThat(tree.has("access_token")).isFalse();
        assertThat(tree.has("identity_no")).isFalse();
    }

    /**
     * 验证 JSON 字符串脱敏对空白、嵌套结构及各类非法输入严格遵守契约。
     */
    @Test
    void shouldSanitizeJsonAndDegradeInvalidPayloads() {
        assertThat(SensitiveDataUtils.sanitizeJson(null)).isNull();
        assertThat(SensitiveDataUtils.sanitizeJson("")).isNull();
        assertThat(SensitiveDataUtils.sanitizeJson("   ")).isNull();
        assertThat(SensitiveDataUtils.sanitizeJson("null")).isEqualTo("null");

        String nestedPayload = "{\"username\":\"alice\",\"password\":\"raw-pwd\","
                + "\"items\":[{\"refresh_token\":\"rt-1\",\"identity_no\":\"110101\",\"ok\":true}]}";
        String sanitized = SensitiveDataUtils.sanitizeJson(nestedPayload, "identityNo");
        assertThat(sanitized).doesNotContain("raw-pwd", "rt-1", "110101");
        JsonNode tree = JsonUtils.parseTree(sanitized);
        assertThat(tree.get("username").asText()).isEqualTo("alice");
        assertThat(tree.get("items").get(0).get("ok").asBoolean()).isTrue();

        assertThat(SensitiveDataUtils.sanitizeJson("{broken")).isEqualTo(SensitiveDataUtils.SANITIZE_FAILURE_PLACEHOLDER);
        assertThat(SensitiveDataUtils.sanitizeJson("plain text")).isEqualTo(SensitiveDataUtils.SANITIZE_FAILURE_PLACEHOLDER);
        assertThat(SensitiveDataUtils.sanitizeJson("{\"password\":\"raw\"} trailing"))
                .isEqualTo(SensitiveDataUtils.SANITIZE_FAILURE_PLACEHOLDER);
        assertThat(SensitiveDataUtils.sanitizeJson("\"plain-secret-string\""))
                .isEqualTo(SensitiveDataUtils.SANITIZE_FAILURE_PLACEHOLDER);
    }

    /**
     * 验证 CommonResult 脱敏在剥离响应 data 内敏感字段的同时保留标量结果。
     */
    @Test
    void shouldSanitizeCommonResultData() {
        assertThat(SensitiveDataUtils.sanitizeCommonResult(null)).isNull();
        assertThat(SensitiveDataUtils.sanitizeCommonResult(CommonResult.success(true)))
                .contains("\"data\":true");

        Map<String, Object> item = new LinkedHashMap<>();
        item.put("username", "bob");
        item.put("secret", "top-secret");
        item.put("mobile", "13800001111");
        CommonResult<List<Map<String, Object>>> result = CommonResult.success(List.of(item));

        String sanitized = SensitiveDataUtils.sanitizeCommonResult(result, "mobile");
        assertThat(sanitized).doesNotContain("top-secret", "13800001111");
        assertThat(sanitized).contains("bob");
    }
}
