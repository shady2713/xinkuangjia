package com.basicframework.framework.common.util.servlet;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 {@link ServletUtils} 客户端 IP 提取对非受信直连伪造转发头的防护与环回地址归一化。
 *
 * @author shady2713
 */
class ServletUtilsTest {

    /**
     * 验证公网直连请求携带伪造 {@code X-Forwarded-For} 时被忽略，返回真实直连地址。
     */
    @Test
    void ignoresSpoofedForwardedHeadersFromUntrustedRemoteAddress() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("203.0.113.15");
        request.addHeader("X-Forwarded-For", "198.51.100.99");
        request.addHeader("X-Real-IP", "198.51.100.88");

        assertThat(ServletUtils.getClientIP(request)).isEqualTo("203.0.113.15");
    }

    /**
     * 验证来自内网反向代理网段的请求正常解析 {@code X-Forwarded-For} 首跳地址，且 IPv6 环回地址归一化。
     */
    @Test
    void resolvesForwardedIpFromTrustedProxyAndNormalizesIpv6Loopback() {
        MockHttpServletRequest proxied = new MockHttpServletRequest();
        proxied.setRemoteAddr("172.18.0.5");
        proxied.addHeader("X-Forwarded-For", "198.51.100.42, 172.18.0.5");
        assertThat(ServletUtils.getClientIP(proxied)).isEqualTo("198.51.100.42");

        MockHttpServletRequest loopback = new MockHttpServletRequest();
        loopback.setRemoteAddr("0:0:0:0:0:0:0:1");
        assertThat(ServletUtils.getClientIP(loopback)).isEqualTo("127.0.0.1");
    }

}
