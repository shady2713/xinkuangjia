package com.basicframework.framework.security.core.util;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * 验证 {@link SecurityFrameworkUtils} 令牌提取边界：Header 优先、Bearer 剥离及空白参数禁用 Query 传参。
 *
 * @author shady2713
 */
class SecurityFrameworkUtilsTest {

    /** 当 tokenParameter 为空或空白字符串时，即使 URL 携带查询令牌也必须忽略。 */
    @Test
    void obtainAuthorizationIgnoresQueryParameterWhenParameterNameIsBlank() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setParameter("token", "query-secret-token");

        assertNull(SecurityFrameworkUtils.obtainAuthorization(request, "Authorization", ""));
        assertNull(SecurityFrameworkUtils.obtainAuthorization(request, "Authorization", "   "));
        assertNull(SecurityFrameworkUtils.obtainAuthorization(request, "Authorization", null));
    }

    /** 当配置了有效 tokenParameter 且 Header 缺失时，仍允许按配置读取参数并在存在 Header 时优先取 Header。 */
    @Test
    void obtainAuthorizationPrefersHeaderOverQueryParameter() {
        MockHttpServletRequest queryOnly = new MockHttpServletRequest();
        queryOnly.setParameter("token", "Bearer fallback-token");
        assertEquals("fallback-token",
                SecurityFrameworkUtils.obtainAuthorization(queryOnly, "Authorization", "token"));

        MockHttpServletRequest withHeader = new MockHttpServletRequest();
        withHeader.addHeader("Authorization", "Bearer header-token");
        withHeader.setParameter("token", "fallback-token");
        assertEquals("header-token",
                SecurityFrameworkUtils.obtainAuthorization(withHeader, "Authorization", "token"));
    }

}
