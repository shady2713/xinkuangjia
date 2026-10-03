package com.basicframework.server;

import com.basicframework.framework.common.util.servlet.ServletUtils;
import com.basicframework.server.config.TrustedProxyConfiguration;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.autoconfigure.web.ServerProperties;
import org.springframework.boot.autoconfigure.web.embedded.TomcatWebServerFactoryCustomizer;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServer;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import java.util.regex.PatternSyntaxException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 使用真实 Tomcat 监听回环端口，验证请求地址只能由可信容器边界重写。 */
class TrustedProxyBoundaryTest {

    @TempDir
    Path temporaryDirectory;

    /** 默认无可信代理时，任意转发头都不改变实际 TCP 客户端地址或协议。 */
    @Test
    void defaultsIgnoreSpoofedHeaders() throws Exception {
        assertThat(request(Map.of(), "192.0.2.1", "https")).isEqualTo("127.0.0.1|http");
    }

    /** 显式信任连接来源后，IPv6 客户端地址通过容器处理供业务工具读取。 */
    @Test
    void trustedProxySuppliesActualIpv6Client() throws Exception {
        assertThat(request(Map.of("TRUSTED_PROXY_REGEX", "127\\.0\\.0\\.1"), "2001:db8::7", "https"))
                .isEqualTo("2001:db8::7|https");
    }

    /** 反向遍历受控代理链，停在首个不受信任的地址，忽略客户端伪造的左侧前缀。 */
    @Test
    void trustedChainStopsBeforeForgedPrefix() throws Exception {
        assertThat(request(Map.of("TRUSTED_PROXY_REGEX", "127\\.0\\.0\\.1|10\\.0\\.0\\.2"),
                "192.0.2.99, 198.51.100.7, 10.0.0.2", "https"))
                .isEqualTo("198.51.100.7|https");
    }

    /** 仅列出其他代理不能使当前非可信来源获得转发头权限。 */
    @Test
    void unrelatedTrustEntryDoesNotPermitCurrentPeer() throws Exception {
        assertThat(request(Map.of("TRUSTED_PROXY_REGEX", "10\\.0\\.0\\.2"), "192.0.2.1", "https"))
                .isEqualTo("127.0.0.1|http");
    }

    /** 可信代理可携带非标准 HTTPS 端口，避免同源判断和重定向回退到 443。 */
    @Test
    void forwardedPortRequiresTrustedPeer() throws Exception {
        assertThat(request(Map.of("TRUSTED_PROXY_REGEX", "127\\.0\\.0\\.1"), "192.0.2.1", "https", "8443"))
                .isEqualTo("192.0.2.1|https|8443");
        assertThat(request(Map.of(), "192.0.2.1", "https", "8443"))
                .startsWith("127.0.0.1|http|").doesNotEndWith("|8443");
    }

    /** 禁止切换到无来源限制的框架转发头解析，避免绕过容器信任规则。 */
    @Test
    void frameworkStrategyFailsBeforeListening() throws IOException {
        ServerProperties properties = properties(environment(Map.of("server.forward-headers-strategy", "framework")));
        assertThatThrownBy(() -> new TrustedProxyConfiguration().trustedProxyGuard(properties)
                .customize(new TomcatServletWebServerFactory())).isInstanceOf(IllegalStateException.class);
    }

    /** 空代理正则在 Tomcat 表示信任全部，必须阻止启动；非法正则也不能静默降级。 */
    @Test
    void emptyOrMalformedProxyRulesFail() throws IOException {
        ServerProperties properties = properties(environment(Map.of("TRUSTED_PROXY_REGEX", "")));
        assertThatThrownBy(() -> new TrustedProxyConfiguration().trustedProxyGuard(properties)
                .customize(new TomcatServletWebServerFactory())).isInstanceOf(IllegalStateException.class);
        properties.getTomcat().getRemoteip().setInternalProxies("[");
        assertThatThrownBy(() -> new TrustedProxyConfiguration().trustedProxyGuard(properties)
                .customize(new TomcatServletWebServerFactory())).isInstanceOf(PatternSyntaxException.class);
    }

    /**
     * 用当前 YAML 和生产自定义器启动独立 Tomcat 并经真实 socket 发起请求。
     *
     * @param overrides 测试独有的环境覆盖
     * @param forwardedFor 待校验的代理链
     * @param protocol 客户端声明的协议
     * @return 容器与公共地址工具实际交付给业务的地址和协议
     * @throws Exception 配置、监听、请求或服务停止失败时抛出
     */
    private String request(Map<String, Object> overrides, String forwardedFor, String protocol) throws Exception {
        return request(overrides, forwardedFor, protocol, null);
    }

    /** 在相同真实连接上附加可选端口头，验证它和地址、协议使用同一代理信任边界。 */
    private String request(Map<String, Object> overrides, String forwardedFor, String protocol,
                           String forwardedPort) throws Exception {
        StandardEnvironment environment = environment(overrides);
        ServerProperties properties = properties(environment);
        TomcatServletWebServerFactory factory = new TomcatServletWebServerFactory(0);
        factory.setAddress(InetAddress.getByName("127.0.0.1"));
        factory.setBaseDirectory(temporaryDirectory.toFile());
        new TrustedProxyConfiguration().trustedProxyGuard(properties).customize(factory);
        new TomcatWebServerFactoryCustomizer(environment, properties).customize(factory);
        WebServer server = factory.getWebServer(context -> context.addServlet("client-address", new HttpServlet() {
            /** 将容器可信地址与协议作为测试响应，验证业务读取路径。 */
            @Override
            protected void doGet(HttpServletRequest request, HttpServletResponse response) throws IOException {
                response.getWriter().write(ServletUtils.getClientIP(request) + "|" + request.getScheme());
                if (request.getHeader("X-Forwarded-Port") != null) {
                    response.getWriter().write("|" + request.getServerPort());
                }
            }
        }).addMapping("/*"));
        try {
            server.start();
            HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + server.getPort() + "/client"))
                    .timeout(Duration.ofSeconds(10)).header("X-Forwarded-For", forwardedFor)
                    .header("X-Forwarded-Proto", protocol).header("X-Real-IP", "192.0.2.200")
                    .header("Forwarded", "for=192.0.2.201;proto=https");
            if (forwardedPort != null) {
                request.header("X-Forwarded-Port", forwardedPort);
            }
            HttpResponse<String> response = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()
                    .send(request.build(), HttpResponse.BodyHandlers.ofString());
            assertThat(response.statusCode()).isEqualTo(200);
            return response.body();
        } finally {
            server.stop();
        }
    }

    /** 绑定实际 ServerProperties，保持与 Spring Boot 生产装配一致的字段语义。 */
    private ServerProperties properties(StandardEnvironment environment) {
        return Binder.get(environment).bind("server", ServerProperties.class).orElseThrow(IllegalStateException::new);
    }

    /** 从应用 YAML 加载隔离配置，不继承本机真实环境或凭据。 */
    private StandardEnvironment environment(Map<String, Object> overrides) throws IOException {
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
        environment.getPropertySources().remove(StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
        environment.getPropertySources().addFirst(new MapPropertySource("proxy-test", overrides));
        new YamlPropertySourceLoader().load("application-test", new ClassPathResource("application.yaml"))
                .forEach(environment.getPropertySources()::addLast);
        return environment;
    }
}
