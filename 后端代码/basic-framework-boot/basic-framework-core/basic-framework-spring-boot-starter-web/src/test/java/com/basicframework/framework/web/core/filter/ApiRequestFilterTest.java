package com.basicframework.framework.web.core.filter;

import com.basicframework.framework.apilog.core.filter.ApiAccessLogFilter;
import com.basicframework.framework.common.biz.infra.logger.ApiAccessLogCommonApi;
import com.basicframework.framework.web.config.WebProperties;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 {@link ApiRequestFilter#shouldNotFilter} 的路径判定契约（经真实消费方
 * {@link ApiAccessLogFilter} 继承的同一个实现）。
 *
 * <p>该判定决定访问日志、加密等 API 过滤器是否作用于当前请求：把非 API 请求纳入过滤会污染日志，
 * 把 API 请求漏出过滤则丢失访问记录或加密保护。前缀来自可配置的 {@link WebProperties}，
 * 且部署在非根上下文时请求 URI 带上下文路径，因此这里同时锁定默认前缀、自定义前缀与上下文路径三种情况。</p>
 *
 * @author shady2713
 */
class ApiRequestFilterTest {

    /** 管理端 API 请求必须被过滤，用于记录后台操作。 */
    @Test
    void adminApiRequestIsFiltered() {
        assertThat(shouldNotFilter(defaultFilter(), request("/admin-api/system/user/page", ""))).isFalse();
    }

    /** 应用端 API 请求同样必须被过滤。 */
    @Test
    void appApiRequestIsFiltered() {
        assertThat(shouldNotFilter(defaultFilter(), request("/app-api/system/dict/data/list", ""))).isFalse();
    }

    /** 非 API 请求必须跳过，避免静态资源、Actuator 等请求进入业务过滤链。 */
    @Test
    void nonApiRequestIsSkipped() {
        assertThat(shouldNotFilter(defaultFilter(), request("/actuator/health", ""))).isTrue();
        assertThat(shouldNotFilter(defaultFilter(), request("/", ""))).isTrue();
    }

    /**
     * 部署在非根上下文时，必须先剥掉上下文路径再匹配前缀。
     *
     * <p>容器收到的请求 URI 含上下文路径（如 {@code /admin/admin-api/...}），
     * 直接匹配会让生产环境下的 API 请求全部漏出过滤。</p>
     */
    @Test
    void contextPathIsStrippedBeforeMatching() {
        assertThat(shouldNotFilter(defaultFilter(), request("/admin/admin-api/system/user/page", "/admin")))
                .isFalse();
        assertThat(shouldNotFilter(defaultFilter(), request("/admin/actuator/health", "/admin")))
                .isTrue();
    }

    /** 自定义前缀必须真实生效，否则改了配置仍按内置前缀放行或过滤。 */
    @Test
    void customPrefixIsRespected() {
        WebProperties properties = new WebProperties();
        properties.getAdminApi().setPrefix("/manage-api");
        properties.getAppApi().setPrefix("/client-api");

        assertThat(shouldNotFilter(filter(properties), request("/manage-api/system/user/page", ""))).isFalse();
        assertThat(shouldNotFilter(filter(properties), request("/client-api/system/dict/data/list", ""))).isFalse();
        assertThat(shouldNotFilter(filter(properties), request("/admin-api/system/user/page", "")))
                .as("旧前缀不在配置内，必须被跳过").isTrue();
    }

    /**
     * 调用真实过滤器继承的跳过判定。
     *
     * @param filter  真实消费方过滤器
     * @param request 待判定请求
     * @return true 表示跳过该过滤器
     */
    private boolean shouldNotFilter(ApiAccessLogFilter filter, MockHttpServletRequest request) {
        return filter.shouldNotFilter(request);
    }

    /**
     * 构造请求，覆盖含上下文路径的真实容器行为。
     *
     * @param requestUri  完整请求 URI（含上下文路径）
     * @param contextPath 上下文路径；根上下文传空串
     * @return 模拟请求
     */
    private MockHttpServletRequest request(String requestUri, String contextPath) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", requestUri);
        request.setContextPath(contextPath);
        request.setRequestURI(requestUri);
        return request;
    }

    /** 使用默认 API 前缀构造过滤器。 */
    private ApiAccessLogFilter defaultFilter() {
        return filter(new WebProperties());
    }

    /**
     * 使用指定 Web 配置构造访问日志过滤器。
     *
     * @param properties Web 路径配置
     * @return 过滤器实例，日志 API 用空实现占位（本用例不触发写入）
     */
    private ApiAccessLogFilter filter(WebProperties properties) {
        ApiAccessLogCommonApi noopApi = createDTO -> {
        };
        return new ApiAccessLogFilter(properties, "basic-framework-test", noopApi);
    }

}
