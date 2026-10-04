package com.basicframework.framework.xss.core.filter;

import com.basicframework.framework.xss.config.XssProperties;
import com.basicframework.framework.xss.core.clean.JsoupXssCleaner;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.util.AntPathMatcher;

import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 校验 XSS 过滤器的跳过判定与“下游拿到已清理请求”的契约。
 *
 * <p>过滤器默认开启，只有显式关闭或命中排除名单时才跳过；排除名单按 Ant 风格路径匹配，
 * 通常用于接收第三方回调原文的接口。开启时下游必须拿到包装后的请求，参数、请求头等入口
 * 读取到的 HTML 已被白名单清理，避免脚本与事件属性进入业务数据；关闭时必须原样放行原始
 * 请求，不能因为包装而改变请求身份或读取语义。</p>
 *
 * @author shady2713
 */
class XssFilterTest {

    /** 请求路径匹配器，与生产使用同一 Ant 实现。 */
    private static final AntPathMatcher PATH_MATCHER = new AntPathMatcher();

    /** 关闭过滤开关后必须跳过所有请求。 */
    @Test
    void disabledFilterSkipsEveryRequest() {
        XssProperties properties = new XssProperties();
        properties.setEnable(false);
        XssFilter filter = new XssFilter(properties, PATH_MATCHER, new JsoupXssCleaner());

        assertThat(filter.shouldNotFilter(new MockHttpServletRequest("GET", "/app-api/order"))).isTrue();
    }

    /** 命中排除名单的路径必须跳过，未命中的路径必须继续过滤。 */
    @Test
    void excludedUrlsAreSkipped() {
        XssProperties properties = new XssProperties();
        properties.setExcludeUrls(List.of("/app-api/notify/**"));
        XssFilter filter = new XssFilter(properties, PATH_MATCHER, new JsoupXssCleaner());

        assertThat(filter.shouldNotFilter(new MockHttpServletRequest("POST", "/app-api/notify/callback")))
                .as("排除名单内的回调接口必须放行原文").isTrue();
        assertThat(filter.shouldNotFilter(new MockHttpServletRequest("POST", "/app-api/order/create")))
                .isFalse();
    }

    /** 默认配置（未声明排除名单）不得跳过任何路径。 */
    @Test
    void emptyExcludeListFiltersEveryRequest() {
        XssFilter filter = new XssFilter(new XssProperties(), PATH_MATCHER, new JsoupXssCleaner());

        assertThat(new XssProperties().getExcludeUrls()).isEmpty();
        assertThat(filter.shouldNotFilter(new MockHttpServletRequest("GET", "/app-api/order"))).isFalse();
    }

    /** 开启过滤时下游必须拿到清理后的包装请求，原始请求不受影响。 */
    @Test
    void downstreamReceivesCleanedRequestWrapper() throws Exception {
        XssFilter filter = new XssFilter(new XssProperties(), PATH_MATCHER, new JsoupXssCleaner());
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/app-api/order/create");
        request.addParameter("remark", "<script>alert(1)</script>备注");
        request.addHeader("X-Remark", "<script>alert(2)</script>");
        AtomicReference<HttpServletRequest> downstreamRequest = new AtomicReference<>();
        FilterChain chain = (chainRequest, chainResponse) -> downstreamRequest.set((HttpServletRequest) chainRequest);

        filter.doFilter(request, new MockHttpServletResponse(), chain);

        HttpServletRequest wrapped = downstreamRequest.get();
        assertThat(wrapped).isInstanceOf(XssRequestWrapper.class);
        assertThat(wrapped.getParameter("remark")).as("脚本标签及其内容必须被清除").isEqualTo("备注");
        assertThat(wrapped.getHeader("X-Remark")).as("请求头同样需要清理").isEmpty();
        assertThat(wrapped.getParameter("missing")).as("缺失参数仍返回 null").isNull();
    }

    /** 关闭过滤时下游必须拿到原始请求对象，不做任何包装。 */
    @Test
    void disabledFilterPassesOriginalRequestThrough() throws Exception {
        XssProperties properties = new XssProperties();
        properties.setEnable(false);
        XssFilter filter = new XssFilter(properties, PATH_MATCHER, new JsoupXssCleaner());
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/app-api/order/create");
        request.addParameter("remark", "<script>alert(1)</script>备注");
        AtomicReference<HttpServletRequest> downstreamRequest = new AtomicReference<>();
        FilterChain chain = (chainRequest, chainResponse) -> downstreamRequest.set((HttpServletRequest) chainRequest);

        filter.doFilter(request, new MockHttpServletResponse(), chain);

        assertThat(downstreamRequest.get()).isSameAs(request);
        assertThat(downstreamRequest.get().getParameter("remark")).isEqualTo("<script>alert(1)</script>备注");
    }
}
