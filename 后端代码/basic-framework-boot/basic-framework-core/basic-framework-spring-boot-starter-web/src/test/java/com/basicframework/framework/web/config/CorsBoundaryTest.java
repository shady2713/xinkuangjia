package com.basicframework.framework.web.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.context.ConfigurationPropertiesAutoConfiguration;
import org.springframework.boot.autoconfigure.validation.ValidationAutoConfiguration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;

/** 验证实际 CORS 过滤器与配置绑定在默认拒绝的同时允许明确授权的开发源。 */
class CorsBoundaryTest {

    /** 默认配置拒绝任意跨域请求且不会触发业务处理。 */
    @Test
    void defaultRejectsCrossOrigin() throws Exception {
        assertThat(filter(List.of(), "https://outside.example", false).getStatus()).isEqualTo(403);
    }

    /** 精确白名单允许 Bearer 预检，不返回凭据许可或任意源。 */
    @Test
    void explicitDevelopmentOriginAllowsAuthorizationPreflight() throws Exception {
        MockHttpServletResponse response = filter(List.of("http://localhost:5175"), "http://localhost:5175", true);
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getHeader("Access-Control-Allow-Origin")).isEqualTo("http://localhost:5175");
        assertThat(response.getHeader("Access-Control-Allow-Headers"))
                .contains("Authorization", "Content-Type", "Content-Disposition");
        assertThat(response.getHeader("Access-Control-Expose-Headers")).contains("Content-Disposition");
        assertThat(response.getHeader("Access-Control-Allow-Credentials")).isNull();
    }

    /** 源的端口或域名改变都必须重新获得白名单许可。 */
    @Test
    void refusesSimilarOrigins() throws Exception {
        assertThat(filter(List.of("http://localhost:5175"), "http://localhost:5176", false).getStatus()).isEqualTo(403);
        assertThat(filter(List.of("https://admin.example"), "https://admin.example.attacker.test", true).getStatus())
                .isEqualTo(403);
    }

    /** 同源请求和无 Origin 的服务端调用无需跨域授权，继续进入业务链。 */
    @Test
    void sameOriginAndNonBrowserRequestsContinue() throws Exception {
        assertThat(filter(List.of(), "http://localhost", false).getStatus()).isEqualTo(204);
        assertThat(filter(List.of(), null, false).getStatus()).isEqualTo(204);
    }

    /** 缺省或空环境变量绑定为空列表，不意外恢复通配符。 */
    @Test
    void emptyBindingRemainsClosed() {
        runner().withPropertyValues("basic-framework.web.cors-allowed-origins=").run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context.getBean(WebProperties.class).getCorsAllowedOrigins()).isEmpty();
        });
    }

    /** 启动阶段拒绝通配符、路径和非 HTTP 源，避免误配置静默放宽访问范围。 */
    @ParameterizedTest
    @ValueSource(strings = {"*", "https://*.example.com", "null", "https://admin.example/", "https://admin.example/path",
            "https://user@admin.example", "https://admin.example?x=1", "https://admin.example#x", "file://host", "https://host:65536"})
    void rejectsUnsafeOriginsDuringBinding(String origin) {
        runner().withPropertyValues("basic-framework.web.cors-allowed-origins=" + origin)
                .run(context -> assertThat(context).hasFailed());
    }

    /** 构造只加载 Web 配置校验的上下文，避免业务模块和外部服务影响结果。 */
    private ApplicationContextRunner runner() {
        return new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(ConfigurationPropertiesAutoConfiguration.class,
                        ValidationAutoConfiguration.class))
                .withUserConfiguration(TestConfiguration.class)
                .withPropertyValues("basic-framework.web.admin-ui.url=http://localhost:5175");
    }

    /**
     * 执行生产过滤器，使用业务链标记区分放行与预检终止。
     *
     * @param origins 明确允许的源
     * @param origin 请求源；null 表示非浏览器请求
     * @param preflight 是否为携带认证与 JSON 请求头的预检
     * @return 过滤器实际响应
     * @throws Exception 过滤器处理失败时抛出
     */
    private MockHttpServletResponse filter(List<String> origins, String origin, boolean preflight) throws Exception {
        WebProperties properties = new WebProperties();
        properties.setCorsAllowedOrigins(origins);
        MockHttpServletRequest request = new MockHttpServletRequest(preflight ? "OPTIONS" : "GET", "/admin-api/users");
        if (origin != null) {
            request.addHeader("Origin", origin);
        }
        if (preflight) {
            request.addHeader("Access-Control-Request-Method", "POST");
            request.addHeader("Access-Control-Request-Headers", "Authorization, Content-Type, Content-Disposition");
        }
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean invoked = new AtomicBoolean();
        new BasicFrameworkWebAutoConfiguration().corsFilterBean(properties).getFilter().doFilter(request, response,
                (ignoredRequest, ignoredResponse) -> {
                    invoked.set(true);
                    response.setStatus(204);
                });
        assertThat(invoked.get()).isEqualTo(response.getStatus() == 204);
        return response;
    }

    /** 仅注册待验证配置，不启用完整 Web 自动装配。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(WebProperties.class)
    static class TestConfiguration {
    }
}
