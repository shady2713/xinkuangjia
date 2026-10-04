package com.basicframework.framework.web.core.filter;

import com.basicframework.framework.common.util.servlet.ServletUtils;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 校验请求体缓存过滤器的排除范围与“JSON 请求体可重复读取”契约。
 *
 * <p>该过滤器把 JSON 请求体读入内存后再交给下游，使控制器、幂等校验与访问日志可以多次
 * 读取同一请求体。排除项只针对 Spring Boot Admin 控制台与 Actuator 端点：这些连接可能
 * 被客户端提前中断，缓存请求体会放大异常；业务接口（包含 {@code /admin-api} 这类前缀）
 * 必须继续缓存，否则依赖二次读取的链路会拿到空请求体。</p>
 *
 * @author shady2713
 */
class CacheRequestBodyFilterTest {

    /** 被测过滤器，无状态可跨用例复用。 */
    private static final CacheRequestBodyFilter FILTER = new CacheRequestBodyFilter();

    /** 管理控制台与 Actuator 请求必须跳过缓存，避免客户端中断放大异常。 */
    @Test
    void adminAndActuatorRequestsAreSkipped() {
        assertThat(FILTER.shouldNotFilter(jsonRequest("/admin/applications"))).isTrue();
        assertThat(FILTER.shouldNotFilter(jsonRequest("/actuator/health"))).isTrue();
    }

    /** 业务接口必须缓存，尤其是前缀相近的 /admin-api 不能被误排除。 */
    @Test
    void businessJsonRequestsAreNotSkipped() {
        assertThat(FILTER.shouldNotFilter(jsonRequest("/admin-api/system/user/get")))
                .as("管理端接口前缀不是控制台路径，必须继续缓存请求体").isFalse();
        assertThat(FILTER.shouldNotFilter(jsonRequest("/app-api/order/create"))).isFalse();
    }

    /** 非 JSON 请求没有可重复读取的语义，必须跳过缓存。 */
    @Test
    void nonJsonRequestsAreSkipped() {
        MockHttpServletRequest textRequest = new MockHttpServletRequest("POST", "/app-api/notify/callback");
        textRequest.setContentType(MediaType.TEXT_PLAIN_VALUE);
        textRequest.setContent("plain".getBytes(StandardCharsets.UTF_8));

        MockHttpServletRequest missingContentType = new MockHttpServletRequest("POST", "/app-api/notify/callback");

        assertThat(FILTER.shouldNotFilter(textRequest)).isTrue();
        assertThat(FILTER.shouldNotFilter(missingContentType))
                .as("缺少 Content-Type 时不得按 JSON 处理").isTrue();
    }

    /** 过滤后下游拿到的是缓存包装，同一请求体可被重复读取且长度一致。 */
    @Test
    void downstreamReceivesWrapperWithRepeatableBody() throws Exception {
        String body = "{\"name\":\"张三\"}";
        MockHttpServletRequest request = jsonRequest("/app-api/order/create");
        request.setContent(body.getBytes(StandardCharsets.UTF_8));
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicReference<HttpServletRequest> downstreamRequest = new AtomicReference<>();
        FilterChain chain = (chainRequest, chainResponse) -> downstreamRequest.set((HttpServletRequest) chainRequest);

        FILTER.doFilter(request, response, chain);

        HttpServletRequest wrapped = downstreamRequest.get();
        assertThat(wrapped).isInstanceOf(CacheRequestBodyWrapper.class);
        assertThat(ServletUtils.getBody(wrapped)).as("首次读取得到完整请求体").isEqualTo(body);
        assertThat(ServletUtils.getBody(wrapped)).as("二次读取必须仍能拿到同一请求体").isEqualTo(body);
        assertThat(wrapped.getContentLength()).as("缓存后长度按请求体真实长度上报")
                .isEqualTo(body.getBytes(StandardCharsets.UTF_8).length);
        assertThat(wrapped.getContentLengthLong()).isEqualTo(body.getBytes(StandardCharsets.UTF_8).length);
    }

    /** 被排除的请求必须原样传给下游，不得被包装。 */
    @Test
    void skippedRequestIsPassedThroughWithoutWrapper() throws Exception {
        MockHttpServletRequest request = jsonRequest("/admin/applications");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicReference<HttpServletRequest> downstreamRequest = new AtomicReference<>();
        FilterChain chain = (chainRequest, chainResponse) -> downstreamRequest.set((HttpServletRequest) chainRequest);

        FILTER.doFilter(request, response, chain);

        assertThat(downstreamRequest.get()).isSameAs(request);
    }

    /**
     * 构造 JSON 请求。
     *
     * @param uri 请求路径
     * @return 带 application/json 内容类型的 POST 请求
     */
    private static MockHttpServletRequest jsonRequest(String uri) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", uri);
        request.setContentType(MediaType.APPLICATION_JSON_VALUE);
        return request;
    }
}
