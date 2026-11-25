package com.basicframework.framework.security.core.filter;

import com.basicframework.framework.common.biz.system.oauth2.OAuth2TokenCommonApi;
import com.basicframework.framework.common.biz.system.oauth2.dto.OAuth2AccessTokenCheckRespDTO;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.security.config.SecurityProperties;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.basicframework.framework.web.config.WebProperties;
import com.basicframework.framework.web.core.handler.GlobalExceptionHandler;
import com.basicframework.framework.web.core.util.WebFrameworkUtils;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;

import static com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants.FORBIDDEN;
import static com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants.UNAUTHORIZED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证 {@link TokenAuthenticationFilter} 的令牌认证、用户类型边界校验与异常降级行为。
 *
 * @author shady
 */
class TokenAuthenticationFilterTest {

    /**
     * 初始化 Web 前缀路由属性，使测试环境还原真实 API 路径前缀推断。
     */
    @BeforeAll
    static void initWebProperties() {
        new WebFrameworkUtils(new WebProperties());
    }

    /**
     * 清理每次用例写入的 Spring Security 线程上下文，防止跨用例污染。
     */
    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    /**
     * 验证有效访问令牌解析后会将 {@link LoginUser} 写入安全上下文并继续过滤链。
     */
    @Test
    void populatesLoginUserWhenAccessTokenIsValid() throws Exception {
        OAuth2TokenCommonApi tokenApi = mock(OAuth2TokenCommonApi.class);
        OAuth2AccessTokenCheckRespDTO dto = new OAuth2AccessTokenCheckRespDTO();
        dto.setUserId(100L);
        dto.setUserType(UserTypeEnum.ADMIN.getValue());
        dto.setScopes(List.of("user.read"));
        when(tokenApi.checkAccessToken("valid-token")).thenReturn(dto);

        TokenAuthenticationFilter filter = buildFilter(tokenApi, mock(GlobalExceptionHandler.class));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/system/user/get");
        request.addHeader("Authorization", "Bearer valid-token");
        WebFrameworkUtils.setLoginUserType(request, UserTypeEnum.ADMIN.getValue());
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter.doFilter(request, response, chain);

        LoginUser loginUser = SecurityFrameworkUtils.getLoginUser();
        assertThat(loginUser).isNotNull();
        assertThat(loginUser.getId()).isEqualTo(100L);
        assertThat(loginUser.getUserType()).isEqualTo(UserTypeEnum.ADMIN.getValue());
        verify(chain).doFilter(request, response);
    }

    /**
     * 验证令牌校验抛出 {@link ServiceException} 时按未认证继续过滤链，交由后续权限规则决策。
     */
    @Test
    void continuesUnauthenticatedWhenTokenCheckThrowsServiceException() throws Exception {
        OAuth2TokenCommonApi tokenApi = mock(OAuth2TokenCommonApi.class);
        when(tokenApi.checkAccessToken("expired-token"))
                .thenThrow(new ServiceException(UNAUTHORIZED.getCode(), "令牌已过期"));

        TokenAuthenticationFilter filter = buildFilter(tokenApi, mock(GlobalExceptionHandler.class));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/system/auth/get-permission-info");
        request.addHeader("Authorization", "Bearer expired-token");
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter.doFilter(request, response, chain);

        assertThat(SecurityFrameworkUtils.getLoginUser()).isNull();
        verify(chain).doFilter(request, response);
    }

    /**
     * 验证访问令牌的用户类型与当前 API 前缀不匹配时立即拦截并返回 403 JSON 响应。
     */
    @Test
    void writesForbiddenResponseWhenUserTypeMismatchesEndpoint() throws Exception {
        OAuth2TokenCommonApi tokenApi = mock(OAuth2TokenCommonApi.class);
        OAuth2AccessTokenCheckRespDTO dto = new OAuth2AccessTokenCheckRespDTO();
        dto.setUserId(200L);
        dto.setUserType(UserTypeEnum.MEMBER.getValue());
        when(tokenApi.checkAccessToken("member-token")).thenReturn(dto);

        GlobalExceptionHandler exceptionHandler = mock(GlobalExceptionHandler.class);
        when(exceptionHandler.allExceptionHandler(any(), any(AccessDeniedException.class)))
                .thenReturn(CommonResult.error(FORBIDDEN));

        TokenAuthenticationFilter filter = buildFilter(tokenApi, exceptionHandler);
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/system/user/page");
        request.addHeader("Authorization", "Bearer member-token");
        WebFrameworkUtils.setLoginUserType(request, UserTypeEnum.ADMIN.getValue());
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter.doFilter(request, response, chain);

        assertThat(SecurityFrameworkUtils.getLoginUser()).isNull();
        assertThat(response.getContentAsString()).contains(String.valueOf(FORBIDDEN.getCode()));
        verify(exceptionHandler).allExceptionHandler(eq(request), any(AccessDeniedException.class));
        verify(chain, never()).doFilter(any(), any());
    }

    /**
     * 验证 {@code userId = 0} 的客户端凭据令牌无权访问 {@code /admin-api/**} 管理后台端点。
     */
    @Test
    void writesForbiddenResponseWhenClientCredentialsTokenTargetsAdminApi() throws Exception {
        OAuth2TokenCommonApi tokenApi = mock(OAuth2TokenCommonApi.class);
        OAuth2AccessTokenCheckRespDTO dto = new OAuth2AccessTokenCheckRespDTO();
        dto.setUserId(0L);
        dto.setUserType(UserTypeEnum.ADMIN.getValue());
        when(tokenApi.checkAccessToken("client-token")).thenReturn(dto);

        GlobalExceptionHandler exceptionHandler = mock(GlobalExceptionHandler.class);
        when(exceptionHandler.allExceptionHandler(any(), any(AccessDeniedException.class)))
                .thenReturn(CommonResult.error(FORBIDDEN));

        TokenAuthenticationFilter filter = buildFilter(tokenApi, exceptionHandler);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/admin-api/infra/file/upload");
        request.addHeader("Authorization", "Bearer client-token");
        WebFrameworkUtils.setLoginUserType(request, UserTypeEnum.ADMIN.getValue());
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter.doFilter(request, response, chain);

        assertThat(SecurityFrameworkUtils.getLoginUser()).isNull();
        assertThat(response.getContentAsString()).contains(String.valueOf(FORBIDDEN.getCode()));
        verify(chain, never()).doFilter(any(), any());
    }

    /**
     * 构造带受控依赖的过滤器实例。
     */
    @SuppressWarnings("unchecked")
    private static TokenAuthenticationFilter buildFilter(OAuth2TokenCommonApi tokenApi,
                                                         GlobalExceptionHandler exceptionHandler) {
        ObjectProvider<OAuth2TokenCommonApi> provider = mock(ObjectProvider.class);
        when(provider.getObject()).thenReturn(tokenApi);
        return new TokenAuthenticationFilter(new SecurityProperties(), exceptionHandler, provider);
    }

}
