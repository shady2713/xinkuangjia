package com.basicframework.module.system.framework.security.login;

import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.basicframework.framework.web.config.WebProperties;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.service.user.AdminUserService;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * 验证首次改密后端拦截器只放行必要入口。
 *
 * @author shady2713
 */
@ExtendWith(MockitoExtension.class)
class PasswordChangeRequiredFilterTest {

    @Mock
    private AdminUserService adminUserService;

    /**
     * 清理线程安全上下文，避免影响其他测试。
     */
    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    /** 验证强制改密时业务接口返回 403 且不继续调用后续链。 */
    @Test
    void blocksBusinessRequestWhenPasswordChangeRequired() throws Exception {
        AdminUserDO user = buildUser(true);
        when(adminUserService.getUser(1L)).thenReturn(user);
        MockHttpServletRequest request = authenticatedRequest("GET", "/admin-api/system/user/page");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean invoked = new AtomicBoolean(false);
        FilterChain chain = (req, res) -> invoked.set(true);

        new PasswordChangeRequiredFilter(new WebProperties(), adminUserService)
                .doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(response.getContentAsString()).contains("首次登录或密码被重置");
        assertThat(invoked).isFalse();
    }

    /** 验证修改密码和权限信息等必要入口仍可访问。 */
    @Test
    void allowsPasswordChangeRequest() throws Exception {
        when(adminUserService.getUser(1L)).thenReturn(buildUser(true));
        MockHttpServletRequest request = authenticatedRequest("PUT",
                "/admin-api/system/user/profile/update-password");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean invoked = new AtomicBoolean(false);
        FilterChain chain = (req, res) -> invoked.set(true);

        new PasswordChangeRequiredFilter(new WebProperties(), adminUserService)
                .doFilter(request, response, chain);

        assertThat(invoked).isTrue();
        assertThat(response.getStatus()).isEqualTo(200);
    }

    /** 验证不需要改密的用户不会被拦截。 */
    @Test
    void allowsNormalUser() throws Exception {
        when(adminUserService.getUser(1L)).thenReturn(buildUser(false));
        MockHttpServletRequest request = authenticatedRequest("GET", "/admin-api/system/user/page");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean invoked = new AtomicBoolean(false);
        FilterChain chain = (req, res) -> invoked.set(true);

        new PasswordChangeRequiredFilter(new WebProperties(), adminUserService)
                .doFilter(request, response, chain);

        assertThat(invoked).isTrue();
    }

    /**
     * 构造已登录请求。
     *
     * @param method HTTP 方法
     * @param uri 请求地址
     * @return 已写入登录上下文的请求
     */
    private static MockHttpServletRequest authenticatedRequest(String method, String uri) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, uri);
        LoginUser loginUser = new LoginUser();
        loginUser.setId(1L);
        loginUser.setUserType(UserTypeEnum.ADMIN.getValue());
        SecurityFrameworkUtils.setLoginUser(loginUser, request);
        return request;
    }

    /**
     * 构造带改密标志的用户。
     *
     * @param required 是否要求改密
     * @return 用户数据
     */
    private static AdminUserDO buildUser(boolean required) {
        AdminUserDO user = new AdminUserDO();
        user.setId(1L);
        user.setPasswordChangeRequired(required);
        return user;
    }
}
