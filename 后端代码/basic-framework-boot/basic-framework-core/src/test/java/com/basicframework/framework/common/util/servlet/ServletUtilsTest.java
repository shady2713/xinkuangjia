package com.basicframework.framework.common.util.servlet;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 {@link ServletUtils} 客户端 IP 提取对非受信直连伪造转发头的防护与环回地址归一化。
 *
 * @author shady
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

    /** 验证多级反向代理场景下按从右向左剔除私网代理并忽略左侧客户端伪造的 XFF 前缀。 */
    @Test
    void extractsRightmostPublicIpAndIgnoresSpoofedXffPrefix() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("172.18.0.5");
        request.addHeader("X-Forwarded-For", "1.2.3.4, 203.0.113.50, 10.0.0.2, 172.18.0.5");
        request.addHeader("X-Real-IP", "10.0.0.2");

        assertThat(ServletUtils.getClientIP(request)).isEqualTo("203.0.113.50");
    }

    /** 验证内网客户端经过多层代理转发时全部节点均为私网 IP，应回退最左侧合法地址。 */
    @Test
    void fallsBackToLeftmostValidIntranetIpWhenAllXffHopsAreTrustedProxies() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("172.18.0.5");
        request.addHeader("X-Forwarded-For", "10.1.2.3, 192.168.10.1, 172.18.0.5");

        assertThat(ServletUtils.getClientIP(request)).isEqualTo("10.1.2.3");
    }

    /** 验证包含非法字符串或超长注入载荷的 XFF / X-Real-IP 会被拒绝并回退直连地址或合法 IPv6。 */
    @Test
    void rejectsMalformedForwardedHeadersAndSupportsIpv6Clients() {
        MockHttpServletRequest malformed = new MockHttpServletRequest();
        malformed.setRemoteAddr("172.18.0.5");
        malformed.addHeader("X-Forwarded-For", "unknown, not-an-ip, 999.999.999.999");
        malformed.addHeader("X-Real-IP", "evil-host.example.com");
        assertThat(ServletUtils.getClientIP(malformed)).isEqualTo("172.18.0.5");

        MockHttpServletRequest ipv6Client = new MockHttpServletRequest();
        ipv6Client.setRemoteAddr("fd00:10::5");
        ipv6Client.addHeader("X-Forwarded-For", "2001:db8::1, 172.18.0.5");
        assertThat(ServletUtils.getClientIP(ipv6Client)).isEqualTo("2001:db8::1");
    }

}
