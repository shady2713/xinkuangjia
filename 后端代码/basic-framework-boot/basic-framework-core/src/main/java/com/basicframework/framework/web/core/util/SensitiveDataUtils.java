package com.basicframework.framework.web.core.util;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.map.MapUtil;
import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.util.json.JsonUtils;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;

import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Web 日志敏感字段识别与请求、响应负载脱敏工具，统一处理大小写、连接符差异与解析降级契约。
 *
 * @author shady
 */
@Slf4j
public final class SensitiveDataUtils {

    /** JSON 解析失败或根节点非容器结构时使用的安全占位内容。 */
    public static final String SANITIZE_FAILURE_PLACEHOLDER = "{\"_sanitized\":true}";

    private static final Set<String> SENSITIVE_KEY_FRAGMENTS = Set.of(
            "password", "passwd", "pwd", "token", "secret", "authorization",
            "apikey", "credential", "privatekey", "cookie");

    /**
     * 工具类不允许实例化。
     */
    private SensitiveDataUtils() {
    }

    /**
     * 判断字段名是否属于默认或调用方追加的敏感字段。
     *
     * <p>比较前会移除连接符等非字母数字字符并统一为小写，避免通过大小写、下划线或短横线绕过脱敏；
     * 追加字段中的 null 或空白项会被忽略，防止与空字段名发生误匹配。</p>
     *
     * @param key 待判断字段名
     * @param additionalKeys 调用方追加的敏感字段名
     * @return 字段是否必须从日志中移除
     */
    public static boolean isSensitiveKey(String key, String... additionalKeys) {
        String normalizedKey = normalizeKey(key);
        if (normalizedKey.isEmpty()) {
            return false;
        }
        for (String sensitiveFragment : SENSITIVE_KEY_FRAGMENTS) {
            if (normalizedKey.contains(sensitiveFragment)) {
                return true;
            }
        }
        if (additionalKeys == null) {
            return false;
        }
        for (String additionalKey : additionalKeys) {
            String normalizedAdditional = normalizeKey(additionalKey);
            if (!normalizedAdditional.isEmpty() && normalizedKey.equals(normalizedAdditional)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 移除键值映射中的默认及自定义敏感字段后序列化为 JSON。
     *
     * <p>该方法在副本上过滤，不修改调用方传入的原 Map。</p>
     *
     * @param map 待脱敏键值映射
     * @param additionalKeys 调用方追加的敏感字段名
     * @return 脱敏后的 JSON；入参为 null 或空映射时返回 null
     */
    public static String sanitizeMap(Map<String, ?> map, String... additionalKeys) {
        if (CollUtil.isEmpty(map)) {
            return null;
        }
        Map<String, Object> sanitizedMap = MapUtil.newHashMap(map.size());
        sanitizedMap.putAll(map);
        sanitizedMap.keySet().removeIf(key -> isSensitiveKey(key, additionalKeys));
        return JsonUtils.toJsonString(sanitizedMap);
    }

    /**
     * 严格解析 JSON 字符串并递归移除对象或数组中的敏感字段。
     *
     * <p>null 或空白输入返回 null；合法 JSON {@code null} 字面量返回 {@code "null"}；
     * 格式错误、存在尾随非空白 token 或根节点为原始标量文本（如纯字符串）时，统一降级为
     * {@link #SANITIZE_FAILURE_PLACEHOLDER}，避免未结构化内容原样落库。</p>
     *
     * @param jsonString 原始 JSON 文本
     * @param additionalKeys 调用方追加的敏感字段名
     * @return 脱敏后的 JSON；解析失败或非容器根节点返回安全占位内容
     */
    public static String sanitizeJson(String jsonString, String... additionalKeys) {
        if (StrUtil.isBlank(jsonString)) {
            return null;
        }
        try {
            JsonNode rootNode = parseStrictTree(jsonString);
            if (rootNode == null || rootNode.isNull()) {
                return "null";
            }
            if (!rootNode.isContainerNode()) {
                return SANITIZE_FAILURE_PLACEHOLDER;
            }
            sanitizeJsonNode(rootNode, additionalKeys);
            return JsonUtils.toJsonString(rootNode);
        } catch (Exception ex) {
            log.warn("[sanitizeJson][payloadLength({}) 脱敏失败，降级为占位内容，exception({})]",
                    jsonString.length(), ex.getClass().getSimpleName());
            return SANITIZE_FAILURE_PLACEHOLDER;
        }
    }

    /**
     * 递归移除通用响应对象 {@code data} 负载中的敏感字段后序列化为 JSON。
     *
     * <p>保留外层 {@code code}/{@code msg} 及标量 {@code data}，仅对对象或数组结构的 {@code data} 执行递归脱敏；
     * 序列化或解析异常时降级为 {@link #SANITIZE_FAILURE_PLACEHOLDER}。</p>
     *
     * @param commonResult 通用响应对象
     * @param additionalKeys 调用方追加的敏感字段名
     * @return 脱敏后的 JSON；入参为 null 时返回 null
     */
    public static String sanitizeCommonResult(CommonResult<?> commonResult, String... additionalKeys) {
        if (commonResult == null) {
            return null;
        }
        String jsonString = null;
        try {
            jsonString = JsonUtils.toJsonString(commonResult);
            JsonNode rootNode = parseStrictTree(jsonString);
            if (rootNode == null || !rootNode.isObject()) {
                return SANITIZE_FAILURE_PLACEHOLDER;
            }
            sanitizeJsonNode(rootNode.get("data"), additionalKeys);
            return JsonUtils.toJsonString(rootNode);
        } catch (Exception ex) {
            int payloadLength = jsonString != null ? jsonString.length() : -1;
            log.warn("[sanitizeCommonResult][resultCode({}) payloadLength({}) 脱敏失败，降级为占位内容，exception({})]",
                    commonResult.getCode(), payloadLength, ex.getClass().getSimpleName());
            return SANITIZE_FAILURE_PLACEHOLDER;
        }
    }

    /**
     * 使用严格 Jackson Reader 解析整段 JSON 文本并拒绝尾随无效内容。
     *
     * @param jsonString JSON 文本
     * @return 解析后的 JSON 语法树根节点
     * @throws Exception JSON 解析或反序列化失败时抛出
     */
    private static JsonNode parseStrictTree(String jsonString) throws Exception {
        return JsonUtils.getObjectMapper()
                .reader()
                .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                .readTree(jsonString);
    }

    /**
     * 遍历 JSON 节点树并原地移除命中敏感规则的对象属性。
     *
     * @param node JSON 节点
     * @param additionalKeys 调用方追加的敏感字段名
     */
    private static void sanitizeJsonNode(JsonNode node, String... additionalKeys) {
        if (node == null) {
            return;
        }
        if (node.isArray()) {
            for (JsonNode childNode : node) {
                sanitizeJsonNode(childNode, additionalKeys);
            }
            return;
        }
        if (!node.isObject()) {
            return;
        }
        Iterator<Map.Entry<String, JsonNode>> iterator = node.properties().iterator();
        while (iterator.hasNext()) {
            Map.Entry<String, JsonNode> entry = iterator.next();
            if (isSensitiveKey(entry.getKey(), additionalKeys)) {
                iterator.remove();
                continue;
            }
            sanitizeJsonNode(entry.getValue(), additionalKeys);
        }
    }

    /**
     * 将字段名归一化为仅包含小写字母和数字的形式。
     *
     * @param key 原始字段名
     * @return 归一化字段名；空字段返回空字符串
     */
    private static String normalizeKey(String key) {
        if (key == null || key.isBlank()) {
            return "";
        }
        StringBuilder normalizedKey = new StringBuilder(key.length());
        for (int index = 0; index < key.length(); index++) {
            char current = key.charAt(index);
            if (Character.isLetterOrDigit(current)) {
                normalizedKey.append(current);
            }
        }
        return normalizedKey.toString().toLowerCase(Locale.ROOT);
    }
}
