package com.basicframework.framework.common.util.servlet;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import static org.assertj.core.api.Assertions.assertThat;

/** 验证审计与限流共享的地址工具只使用容器认可的地址。 */
class ServletUtilsClientIpTest {

    /** 客户端自报的转发头不能改变两个工具入口的地址判定。 */
    @Test
    void ignoresUntrustedForwardingHeaders() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("2001:db8::7");
        request.addHeader("X-Forwarded-For", "192.0.2.1");
        request.addHeader("X-Real-IP", "192.0.2.2");
        request.addHeader("Forwarded", "for=192.0.2.3");
        RequestAttributes original = RequestContextHolder.getRequestAttributes();
        try {
            RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
            assertThat(ServletUtils.getClientIP(request)).isEqualTo("2001:db8::7");
            assertThat(ServletUtils.getClientIP()).isEqualTo("2001:db8::7");
            RequestContextHolder.resetRequestAttributes();
            assertThat(ServletUtils.getClientIP()).isNull();
        } finally {
            RequestContextHolder.setRequestAttributes(original);
        }
    }
}
