package com.basicframework.framework.web.core.filter;

import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.util.servlet.ServletUtils;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Request Body 缓存过滤器，支持 JSON 请求体在鉴权与审计链路中安全重复读取。
 *
 * <p>为防止未认证请求利用大体积 JSON 或无 Content-Length 分块流放大堆内存，
 * 本过滤器强制限制单次缓存上限为 {@link #MAX_CACHE_BODY_BYTES}。</p>
 *
 * @author 李杰
 */
public class CacheRequestBodyFilter extends OncePerRequestFilter {

    /** 单次 JSON 请求体允许缓存的最大字节数（2 MB）。 */
    public static final int MAX_CACHE_BODY_BYTES = 2 * 1024 * 1024;

    /** 排除监控探针路径，避免长连接或探针流被提前消费。 */
    private static final String[] IGNORE_URIS = {"/admin/", "/actuator/"};

    /**
     * 在有界容量内包装 JSON 请求体；超出上限时直接返回 413 拒绝处理。
     *
     * @param request 当前 HTTP 请求
     * @param response 当前 HTTP 响应
     * @param filterChain Servlet 过滤器链
     * @throws IOException IO 异常
     * @throws ServletException Servlet 异常
     */
    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws IOException, ServletException {
        if (request.getContentLengthLong() > MAX_CACHE_BODY_BYTES) {
            writePayloadTooLarge(response);
            return;
        }
        CacheRequestBodyWrapper wrapper;
        try {
            wrapper = new CacheRequestBodyWrapper(request, MAX_CACHE_BODY_BYTES);
        } catch (CacheRequestBodyWrapper.RequestBodyTooLargeException ex) {
            writePayloadTooLarge(response);
            return;
        }
        filterChain.doFilter(wrapper, response);
    }

    /**
     * 判断当前请求是否跳过 JSON 请求体缓存。
     *
     * @param request 当前 HTTP 请求
     * @return 非 JSON 请求或命中排除前缀时返回 true
     */
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String requestURI = request.getRequestURI();
        if (StrUtil.startWithAny(requestURI, IGNORE_URIS)) {
            return true;
        }
        return !ServletUtils.isJsonRequest(request);
    }

    /**
     * 写出 413 请求体过大错误响应。
     *
     * @param response HTTP 响应
     */
    private static void writePayloadTooLarge(HttpServletResponse response) {
        response.setStatus(HttpStatus.PAYLOAD_TOO_LARGE.value());
        ServletUtils.writeJSON(response, CommonResult.error(
                GlobalErrorCodeConstants.BAD_REQUEST.getCode(), "JSON 请求体不能超过 2MB"));
    }

}
