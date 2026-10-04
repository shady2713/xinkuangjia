package com.basicframework.framework.datasource.core.filter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 校验 Druid 广告过滤器“先放行下游，再用去过广告的 common.js 覆盖响应体”的真实行为。
 *
 * <p>过滤器挂在监控页的 common.js 路径上：它不能拦截或改写下游的其它处理，只能在链路
 * 执行完毕后丢弃下游写入的响应体，改为输出从 Druid 资源读取并去除底部广告的脚本。缓冲区
 * 重置不影响响应头，因此下游已写入的头与状态码必须保留，否则监控页的缓存、内容类型等
 * 响应元信息会被破坏。</p>
 *
 * @author shady2713
 */
class DruidAdRemoveFilterTest {

    /** 响应体必须被替换为去除广告的真实 common.js，且替换发生在下游执行之后。 */
    @Test
    void replacesDownstreamBodyWithAdFreeCommonJs() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/druid/js/common.js");
        MockHttpServletResponse response = new MockHttpServletResponse();
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        AtomicBoolean downstreamInvoked = new AtomicBoolean(false);
        FilterChain chain = (chainRequest, chainResponse) -> {
            downstreamInvoked.set(true);
            assertThat(((MockHttpServletResponse) chainResponse).getContentAsString())
                    .as("过滤器必须先放行下游，再改写响应体").isEmpty();
            ((HttpServletResponse) chainResponse).getWriter().write("DOWNSTREAM-BODY");
        };

        new DruidAdRemoveFilter().doFilter(request, response, chain);

        assertThat(downstreamInvoked).isTrue();
        String content = response.getContentAsString();
        assertThat(content).as("下游写入的响应体必须被丢弃").doesNotContain("DOWNSTREAM-BODY");
        assertThat(content).as("必须输出真实的 Druid common.js").contains("druid.common");
        assertThat(content).as("底部广告与整段 powered by 署名必须被移除")
                .doesNotContain("druid_banner").doesNotContain("shrek.wang")
                .doesNotContain("powered by").doesNotContain("Alibaba");
        assertThat(content).as("仅移除广告，脚本主体必须保留")
                .contains("buildFooter").contains("druid.lang");
    }

    /** 重置缓冲区不得影响响应头与状态码，只有响应体被替换。 */
    @Test
    void keepsResponseMetadataWhileReplacingBody() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/druid/js/common.js");
        MockHttpServletResponse response = new MockHttpServletResponse();
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        FilterChain chain = (chainRequest, chainResponse) -> {
            HttpServletResponse servletResponse = (HttpServletResponse) chainResponse;
            servletResponse.setStatus(HttpServletResponse.SC_OK);
            servletResponse.setHeader("X-Downstream", "kept");
            servletResponse.setContentType("application/javascript;charset=UTF-8");
            servletResponse.getWriter().write("DOWNSTREAM-BODY");
        };

        new DruidAdRemoveFilter().doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_OK);
        assertThat(response.getHeader("X-Downstream")).as("响应头不应被重置").isEqualTo("kept");
        assertThat(response.getContentType()).isEqualTo("application/javascript;charset=UTF-8");
        assertThat(response.getContentAsString()).doesNotContain("DOWNSTREAM-BODY");
    }
}
