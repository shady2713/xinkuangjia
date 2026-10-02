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
        return JakartaServletUtil.getClientIP(request);
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
     * 获取指定请求的客户端 IP。
     *
     * @param request 请求对象
     * @return 客户端 IP
     */
    public static String getClientIP(HttpServletRequest request) {
        return JakartaServletUtil.getClientIP(request);
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
