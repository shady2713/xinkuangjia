package com.basicframework.framework.common.util.servlet;

import cn.hutool.core.util.StrUtil;
import cn.hutool.extra.servlet.JakartaServletUtil;
import com.basicframework.framework.common.util.json.JsonUtils;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.net.InetAddress;
import java.util.Map;

/**
 * 客户端工具类
 *
 * @author 李杰
 */
public class ServletUtils {

    /**
     * 返回 JSON 字符串
     *
     * @param response 响应
     * @param object   对象，会序列化成 JSON 字符串
     */
    @SuppressWarnings("deprecation") // 必须使用 APPLICATION_JSON_UTF8_VALUE，否则会乱码
    public static void writeJSON(HttpServletResponse response, Object object) {
        String content = JsonUtils.toJsonString(object);
        JakartaServletUtil.write(response, content, MediaType.APPLICATION_JSON_UTF8_VALUE);
    }

    /**
     * @param request 请求
     * @return ua
     */
    public static String getUserAgent(HttpServletRequest request) {
        String ua = request.getHeader("User-Agent");
        return ua != null ? ua : "";
    }

    /**
     * 获得请求
     *
     * @return HttpServletRequest
     */
    public static HttpServletRequest getRequest() {
        RequestAttributes requestAttributes = RequestContextHolder.getRequestAttributes();
        if (!(requestAttributes instanceof ServletRequestAttributes)) {
            return null;
        }
        return ((ServletRequestAttributes) requestAttributes).getRequest();
    }

    /**
     * 从当前请求上下文获取 User-Agent。
     *
     * @return User-Agent；当前线程无请求时返回 null
     */
    public static String getUserAgent() {
        HttpServletRequest request = getRequest();
        if (request == null) {
            return null;
        }
        return getUserAgent(request);
    }

    /**
     * 从当前请求上下文获取客户端 IP。
     *
     * @return 客户端 IP；当前线程无请求时返回 null
     */
    public static String getClientIP() {
        HttpServletRequest request = getRequest();
        if (request == null) {
            return null;
        }
        return getClientIP(request);
    }

    /**
     * 判断请求 Content-Type 是否为 JSON。
     *
     * @param request 请求对象
     * @return 是否为 JSON 请求
     */
    public static boolean isJsonRequest(ServletRequest request) {
        return StrUtil.startWithIgnoreCase(request.getContentType(), MediaType.APPLICATION_JSON_VALUE);
    }

    /**
     * 读取 JSON 请求体字符串；仅 JSON 请求支持重复读取缓存。
     *
     * @param request 请求对象
     * @return 请求体字符串；非 JSON 请求返回 null
     */
    public static String getBody(HttpServletRequest request) {
        // 只有 JSON 请求才读取，因为只有 CacheRequestBodyFilter 会缓存请求体，支持重复读取。
        if (isJsonRequest(request)) {
            return JakartaServletUtil.getBody(request);
        }
        return null;
    }

    /**
     * 读取 JSON 请求体字节数组；仅 JSON 请求支持重复读取缓存。
     *
     * @param request 请求对象
     * @return 请求体字节数组；非 JSON 请求返回 null
     */
    public static byte[] getBodyBytes(HttpServletRequest request) {
        // 只有 JSON 请求才读取，因为只有 CacheRequestBodyFilter 会缓存请求体，支持重复读取。
        if (isJsonRequest(request)) {
            return JakartaServletUtil.getBodyBytes(request);
        }
        return null;
    }

    /**
     * 获取指定请求的真实客户端 IP。
     *
     * <p>仅当直连对端 {@code remoteAddr} 属于本机环回或内网反向代理网段时才解析转发头，
     * 防止外部客户端直接访问应用端口时伪造 {@code X-Forwarded-For} 绕过限流与审计。</p>
     *
     * @param request 请求对象
     * @return 规范化后的客户端 IP
     */
    public static String getClientIP(HttpServletRequest request) {
        if (request == null) {
            return null;
        }
        String remoteAddr = normalizeIp(request.getRemoteAddr());
        if (!isTrustedProxyAddress(remoteAddr)) {
            return remoteAddr;
        }
        String xRealIp = StrUtil.trim(request.getHeader("X-Real-IP"));
        if (StrUtil.isNotBlank(xRealIp) && !"unknown".equalsIgnoreCase(xRealIp)) {
            return normalizeIp(xRealIp);
        }
        String xff = request.getHeader("X-Forwarded-For");
        if (StrUtil.isNotBlank(xff)) {
            for (String segment : StrUtil.splitTrim(xff, ',')) {
                if (StrUtil.isNotBlank(segment) && !"unknown".equalsIgnoreCase(segment)) {
                    return normalizeIp(segment);
                }
            }
        }
        return remoteAddr;
    }

    /**
     * 规范化本机 IPv6 环回表示，避免短字段存储超长及同机双栈限流键分裂。
     *
     * @param ip 原始 IP 字符串
     * @return 规范化后的 IP 字符串
     */
    private static String normalizeIp(String ip) {
        if (ip == null) {
            return "";
        }
        String trimmed = ip.trim();
        if (isIpv6LoopbackLiteral(trimmed)) {
            return InetAddress.getLoopbackAddress().getHostAddress();
        }
        return trimmed;
    }

    /**
     * 判断字面量是否为 IPv6 本机环回地址（含压缩形式与展开形式），不触发任何 DNS 查询。
     */
    private static boolean isIpv6LoopbackLiteral(String value) {
        if (value.indexOf(':') < 0) {
            return false;
        }
        if (value.startsWith("::") && value.length() == 3 && value.charAt(2) == '1') {
            return true;
        }
        String[] parts = value.split(":");
        if (parts.length != 8) {
            return false;
        }
        for (int i = 0; i < 7; i++) {
            if (!isZeroHexGroup(parts[i])) {
                return false;
            }
        }
        return isOneHexGroup(parts[7]);
    }

    /**
     * 判断 IPv6 分段是否为全 0 十六进制组。
     */
    private static boolean isZeroHexGroup(String group) {
        if (group.isEmpty() || group.length() > 4) {
            return false;
        }
        for (int i = 0; i < group.length(); i++) {
            if (group.charAt(i) != '0') {
                return false;
            }
        }
        return true;
    }

    /**
     * 判断 IPv6 末段是否为数值 1（允许前导 0）。
     */
    private static boolean isOneHexGroup(String group) {
        if (group.isEmpty() || group.length() > 4) {
            return false;
        }
        for (int i = 0; i < group.length() - 1; i++) {
            if (group.charAt(i) != '0') {
                return false;
            }
        }
        return group.charAt(group.length() - 1) == '1';
    }

    /**
     * 判断直连来源地址是否属于本机环回或 RFC1918 私有反向代理网段。
     *
     * @param ip 已规范化的直连 IP
     * @return 属于受信内网代理地址返回 true
     */
    static boolean isTrustedProxyAddress(String ip) {
        int[] octets = parseIpv4Octets(ip);
        if (octets == null) {
            return false;
        }
        int first = octets[0];
        int second = octets[1];
        return first == 127
                || first == 10
                || (first == 172 && second >= 16 && second <= 31)
                || (first == 192 && second == 168);
    }

    /**
     * 纯内存解析点分十进制 IPv4 字面量的四段数值；格式非法时返回 null。
     */
    private static int[] parseIpv4Octets(String ip) {
        if (StrUtil.isBlank(ip)) {
            return null;
        }
        String[] parts = ip.trim().split("\\.");
        if (parts.length != 4) {
            return null;
        }
        int[] octets = new int[4];
        for (int i = 0; i < 4; i++) {
            try {
                int val = Integer.parseInt(parts[i]);
                if (val < 0 || val > 255) {
                    return null;
                }
                octets[i] = val;
            } catch (NumberFormatException ex) {
                return null;
            }
        }
        return octets;
    }

    /**
     * 获取请求参数 Map。
     *
     * @param request 请求对象
     * @return 请求参数 Map
     */
    public static Map<String, String> getParamMap(HttpServletRequest request) {
        return JakartaServletUtil.getParamMap(request);
    }

    /**
     * 获取请求头 Map。
     *
     * @param request 请求对象
     * @return 请求头 Map
     */
    public static Map<String, String> getHeaderMap(HttpServletRequest request) {
        return JakartaServletUtil.getHeaderMap(request);
    }

}
