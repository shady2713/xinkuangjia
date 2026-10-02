package com.basicframework.framework.web.core.util;

import java.util.Locale;
import java.util.Set;

/**
 * Web 日志敏感字段判定工具，统一处理大小写与连接符差异。
 *
 * @author 李杰
 */
public final class SensitiveDataUtils {

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
     * <p>比较前会移除连接符等非字母数字字符并统一为小写，避免通过大小写、下划线或短横线绕过脱敏。</p>
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
            if (normalizedKey.equals(normalizeKey(additionalKey))) {
                return true;
            }
        }
        return false;
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
