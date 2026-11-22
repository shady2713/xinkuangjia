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
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.util.Map;

/**
 * 客户端工具类
 *
 * @author 李杰
 */
public class ServletUtils {

    /** 合法 IPv4/IPv6 字面量最大长度（含 IPv4 映射 IPv6 形式，45 字符）。 */
    private static final int MAX_IP_LITERAL_LENGTH = 45;
    /** 转发头中代理标记的未知地址占位文本。 */
    private static final String UNKNOWN_IP = "unknown";

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
     * <p>仅当直连对端 {@code remoteAddr} 属于本机环回或内网反向代理网段时才解析转发头；
     * 解析 {@code X-Forwarded-For} 时按规范从右向左剥离受信代理节点并校验纯字面量格式，
     * 防止公网客户端直连或前缀伪造头注入绕过限流与审计。</p>
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
        String forwardedIp = resolveClientIpFromForwardedFor(request);
        if (forwardedIp != null) {
            return forwardedIp;
        }
        String xRealIp = normalizeIp(request.getHeader("X-Real-IP"));
        if (isValidIpLiteral(xRealIp)) {
            return xRealIp;
        }
        return remoteAddr;
    }

    /**
     * 从 {@code X-Forwarded-For} 请求头链中按从右向左顺序提取首个非受信代理的合法客户端 IP。
     *
     * <p>若链路中的全部合法 IP 均属于私网代理（内网直访场景），回退返回最左侧的合法 IP；
     * 若无任何合法 IP 字面量则返回 {@code null}。</p>
     *
     * @param request 请求对象
     * @return 解析得到的客户端 IP；未命中合法转发节点时返回 {@code null}
     */
    private static String resolveClientIpFromForwardedFor(HttpServletRequest request) {
        List<String> candidates = new ArrayList<>();
        Enumeration<String> headers = request.getHeaders("X-Forwarded-For");
        if (headers != null) {
            while (headers.hasMoreElements()) {
                appendForwardedSegments(headers.nextElement(), candidates);
            }
        }
        if (candidates.isEmpty()) {
            appendForwardedSegments(request.getHeader("X-Forwarded-For"), candidates);
        }
        String leftmostValidIp = null;
        for (int i = candidates.size() - 1; i >= 0; i--) {
            String normalized = normalizeIp(candidates.get(i));
            if (!isValidIpLiteral(normalized)) {
                continue;
            }
            leftmostValidIp = normalized;
            if (!isTrustedProxyAddress(normalized)) {
                return normalized;
            }
        }
        return leftmostValidIp;
    }

    /**
     * 将单个 {@code X-Forwarded-For} 头部按逗号拆分为非空、非 {@code unknown} 的候选片段列表。
     *
     * @param headerValue 单个请求头值
     * @param target      目标候选列表
     */
    private static void appendForwardedSegments(String headerValue, List<String> target) {
        if (StrUtil.isBlank(headerValue)) {
            return;
        }
        for (String segment : StrUtil.splitTrim(headerValue, ',')) {
            if (StrUtil.isNotBlank(segment) && !UNKNOWN_IP.equalsIgnoreCase(segment)) {
                target.add(segment);
            }
        }
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
     * 判断字符串是否为合法 IPv4 或 IPv6 地址字面量（纯内存解析，不触发任何 DNS 查询）。
     *
     * @param ip 候选地址字符串
     * @return 合法 IPv4/IPv6 字面量返回 true
     */
    private static boolean isValidIpLiteral(String ip) {
        if (StrUtil.isBlank(ip) || ip.length() > MAX_IP_LITERAL_LENGTH) {
            return false;
        }
        if (parseIpv4Octets(ip) != null) {
            return true;
        }
        return isValidIpv6Literal(ip);
    }

    /**
     * 纯内存校验 IPv6 字面量格式（含零压缩 {@code ::} 及末尾内嵌 IPv4 形式）。
     *
     * @param ip 候选 IPv6 字符串
     * @return 合法 IPv6 字面量返回 true
     */
    private static boolean isValidIpv6Literal(String ip) {
        if (ip.indexOf(':') < 0 || ip.indexOf('%') >= 0) {
            return false;
        }
        int doubleColonIdx = ip.indexOf("::");
        if (doubleColonIdx >= 0 && ip.indexOf("::", doubleColonIdx + 2) >= 0) {
            return false;
        }
        if (doubleColonIdx >= 0) {
            String left = ip.substring(0, doubleColonIdx);
            String right = ip.substring(doubleColonIdx + 2);
            int leftGroups = countIpv6SideGroups(left, false);
            int rightGroups = countIpv6SideGroups(right, true);
            return leftGroups >= 0 && rightGroups >= 0 && leftGroups + rightGroups < 8;
        }
        return countIpv6SideGroups(ip, true) == 8;
    }

    /**
     * 校验并统计 IPv6 地址单侧（或完整未压缩地址）的 16 位分段数量，格式非法返回 -1。
     *
     * @param side          待解析分段串
     * @param allowEmbedded 是否允许末段出现内嵌点分十进制 IPv4
     * @return 合法分段总数（含内嵌 IPv4 占 2 段）；非法返回 -1
     */
    private static int countIpv6SideGroups(String side, boolean allowEmbedded) {
        if (side.isEmpty()) {
            return 0;
        }
        String[] parts = side.split(":", -1);
        int count = 0;
        for (int i = 0; i < parts.length; i++) {
            String part = parts[i];
            if (part.isEmpty()) {
                return -1;
            }
            if (part.indexOf('.') >= 0) {
                if (!allowEmbedded || i != parts.length - 1 || parseIpv4Octets(part) == null) {
                    return -1;
                }
                count += 2;
            } else {
                if (!isHexHextet(part)) {
                    return -1;
                }
                count++;
            }
        }
        return count;
    }

    /**
     * 判断单个 IPv6 分段是否为 1 至 4 位十六进制数。
     *
     * @param part 单个冒号分隔片段
     * @return 合法返回 true
     */
    private static boolean isHexHextet(String part) {
        if (part.isEmpty() || part.length() > 4) {
            return false;
        }
        for (int i = 0; i < part.length(); i++) {
            char ch = part.charAt(i);
            boolean hex = (ch >= '0' && ch <= '9')
                    || (ch >= 'a' && ch <= 'f')
                    || (ch >= 'A' && ch <= 'F');
            if (!hex) {
                return false;
            }
        }
        return true;
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
     * 判断地址是否属于本机环回或内网反向代理网段（IPv4 RFC1918 / IPv6 ULA 与链路本地）。
     *
     * @param ip 已规范化的 IP 字面量
     * @return 属于受信内网代理地址返回 true
     */
    static boolean isTrustedProxyAddress(String ip) {
        int[] octets = parseIpv4Octets(ip);
        if (octets != null) {
            int first = octets[0];
            int second = octets[1];
            return first == 127
                    || first == 10
                    || (first == 172 && second >= 16 && second <= 31)
                    || (first == 192 && second == 168);
        }
        return isTrustedIpv6ProxyAddress(ip);
    }

    /**
     * 判断合法 IPv6 地址是否属于唯一的本地地址（fc00::/7）或链路本地地址（fe80::/10）。
     *
     * @param ip 候选 IPv6 字符串
     * @return 属于内网 IPv6 代理地址返回 true
     */
    private static boolean isTrustedIpv6ProxyAddress(String ip) {
        if (StrUtil.isBlank(ip) || !isValidIpv6Literal(ip) || ip.startsWith("::")) {
            return false;
        }
        int colonIdx = ip.indexOf(':');
        String firstGroup = ip.substring(0, colonIdx);
        int value = Integer.parseInt(firstGroup, 16);
        return (value & 0xFE00) == 0xFC00 || (value & 0xFFC0) == 0xFE80;
    }

    /**
     * 纯内存解析点分十进制 IPv4 字面量的四段数值；格式非法时返回 null。
     *
     * @param ip 点分十进制 IPv4 字符串
     * @return 长度 4 的字节值数组；非法格式返回 {@code null}
     */
    private static int[] parseIpv4Octets(String ip) {
        if (StrUtil.isBlank(ip)) {
            return null;
        }
        String[] parts = ip.trim().split("\\.", -1);
        if (parts.length != 4) {
            return null;
        }
        int[] octets = new int[4];
        for (int i = 0; i < 4; i++) {
            String part = parts[i];
            if (part.isEmpty() || part.length() > 3) {
                return null;
            }
            int val = 0;
            for (int j = 0; j < part.length(); j++) {
                char ch = part.charAt(j);
                if (ch < '0' || ch > '9') {
                    return null;
                }
                val = val * 10 + ch - '0';
            }
            if (val > 255) {
                return null;
            }
            octets[i] = val;
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
