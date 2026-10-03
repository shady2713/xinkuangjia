package com.basicframework.framework.security.core.handler;

import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.security.core.context.SecurityContextHolder;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证未认证与已认证但无权限两种拒绝路径的真实响应体。
 *
 * <p>两者必须使用不同错误码：统一成同一个码会让前端把“需要登录”和“权限不足”
 * 都引导到重新登录，掩盖真实的授权问题。</p>
 *
 * @author shady2713
 */
class SecurityExceptionHandlerTest {

    /** 每例从空上下文开始。 */
    @BeforeEach
    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    /** 未认证访问受保护资源必须返回未授权码，并带上真实错误提示。 */
    @Test
    void entryPointReturnsUnauthorizedCode() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/system/user/page");
        MockHttpServletResponse response = new MockHttpServletResponse();

        new AuthenticationEntryPointImpl().commence(request, response,
                new InsufficientAuthenticationException("需要登录"));

        JsonNode body = JsonUtils.parseObject(response.getContentAsString(), JsonNode.class);
        assertThat(body.get("code").asInt()).isEqualTo(401);
        assertThat(body.get("msg").asText()).isEqualTo("账号未登录");
        assertThat(response.getContentType()).contains("application/json");
    }

    /** 已认证但无权限必须返回禁止访问码。 */
    @Test
    void accessDeniedHandlerReturnsForbiddenCode() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/system/user/page");
        MockHttpServletResponse response = new MockHttpServletResponse();

        new AccessDeniedHandlerImpl().handle(request, response, new AccessDeniedException("权限不足"));

        JsonNode body = JsonUtils.parseObject(response.getContentAsString(), JsonNode.class);
        assertThat(body.get("code").asInt()).isEqualTo(403);
        assertThat(body.get("msg").asText()).isEqualTo("没有该操作权限");
    }

    /** 两种拒绝必须返回不同错误码，否则前端无法区分登录与授权问题。 */
    @Test
    void denialCodesAreDistinct() throws Exception {
        JsonNode unauthorized = JsonUtils.parseObject(
                invokeEntryPoint().getContentAsString(), JsonNode.class);
        JsonNode forbidden = JsonUtils.parseObject(
                invokeAccessDenied().getContentAsString(), JsonNode.class);

        assertThat(unauthorized.get("code").asInt()).isNotEqualTo(forbidden.get("code").asInt());
        assertThat(forbidden.get("code").asInt()).isEqualTo(403);
    }

    /**
     * 记录已登录但无权限时处理器仍能完成响应，且不泄露内部异常信息。
     * 响应体若包含异常消息，会把内部实现细节暴露给调用方。
     */
    @Test
    void accessDeniedResponseDoesNotLeakExceptionDetail() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        new AccessDeniedHandlerImpl().handle(new MockHttpServletRequest("GET", "/admin-api/system/user/page"),
                response, new AccessDeniedException("内部表名 system_users_leak"));

        String content = response.getContentAsString();
        assertThat(content).doesNotContain("system_users_leak");
        assertThat(content).doesNotContain("java.lang");
    }

    /** 未认证响应同样不得携带异常细节。 */
    @Test
    void unauthorizedResponseDoesNotLeakExceptionDetail() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        new AuthenticationEntryPointImpl().commence(
                new MockHttpServletRequest("GET", "/admin-api/system/user/page"), response,
                new InsufficientAuthenticationException("内部路径 /internal/secret"));

        String content = response.getContentAsString();
        assertThat(content).doesNotContain("/internal/secret");
        assertThat(content).doesNotContain("java.lang");
    }

    /** 有登录态时无权限响应必须照常写出，不能因读取用户信息失败而中断。 */
    @Test
    void accessDeniedWorksWithLoginContext() throws Exception {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(5L);
        loginUser.setUserType(UserTypeEnum.ADMIN.getValue());
        SecurityFrameworkUtils.setLoginUser(loginUser, new MockHttpServletRequest());
        MockHttpServletResponse response = new MockHttpServletResponse();

        new AccessDeniedHandlerImpl().handle(new MockHttpServletRequest("GET", "/admin-api/system/user/page"),
                response, new AccessDeniedException("权限不足"));

        assertThat(JsonUtils.parseObject(response.getContentAsString(), JsonNode.class)
                .get("code").asInt()).isEqualTo(403);
    }

    /** 触发未认证处理器并返回响应对象。 */
    private MockHttpServletResponse invokeEntryPoint() {
        MockHttpServletResponse response = new MockHttpServletResponse();
        new AuthenticationEntryPointImpl().commence(
                new MockHttpServletRequest("GET", "/admin-api/system/user/page"), response,
                new InsufficientAuthenticationException("需要登录"));
        return response;
    }

    /** 触发无权限处理器并返回响应对象。 */
    private MockHttpServletResponse invokeAccessDenied() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        new AccessDeniedHandlerImpl().handle(new MockHttpServletRequest("GET", "/admin-api/system/user/page"),
                response, new AccessDeniedException("权限不足"));
        return response;
    }
}
