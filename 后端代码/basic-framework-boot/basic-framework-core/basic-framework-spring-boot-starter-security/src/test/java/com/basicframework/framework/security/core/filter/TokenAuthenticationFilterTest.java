package com.basicframework.framework.security.core.filter;

import com.basicframework.framework.common.biz.system.oauth2.OAuth2TokenCommonApi;
import com.basicframework.framework.common.biz.system.oauth2.dto.OAuth2AccessTokenCheckRespDTO;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.framework.security.config.SecurityProperties;
import com.basicframework.framework.web.core.handler.GlobalExceptionHandler;
import jakarta.servlet.FilterChain;
import com.basicframework.framework.web.config.WebProperties;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 验证令牌过滤器的放行与拒绝决策。
 *
 * <p>过滤器决定"这次请求算不算已登录"。它的判定口径有三条边界：没有令牌时必须匿名放行，让免登录
 * 接口继续工作；令牌校验通过且用户类型匹配时把登录用户写入上下文；用户类型不匹配时必须拒绝，
 * 否则管理端令牌能用在应用端接口上。令牌无效属于"未登录"而不是错误响应，由后续授权链路统一决定
 * 是否放行。</p>
 *
 * <p>过滤器只转换可处理的应用异常。JVM 级 {@link Error} 必须继续传播：把它包装成鉴权响应会把进程级
 * 故障伪装成一次正常的登录失败。</p>
 *
 * @author shady2713
 */
class TokenAuthenticationFilterTest {

    /** 被测过滤器的令牌仓储替身。 */
    private OAuth2TokenCommonApi tokenApi;
    /** 被测过滤器。 */
    private TokenAuthenticationFilter filter;
    /** 本次请求。 */
    private MockHttpServletRequest request;
    /** 本次响应。 */
    private MockHttpServletResponse response;
    /** 后续过滤链替身，记录是否被放行。 */
    private FilterChain chain;
    /** 上下文替身返回的令牌校验结果；null 表示令牌无效。 */
    private OAuth2AccessTokenCheckRespDTO checkResult;
    /** 异常由异常处理器处理后写回的响应体。 */
    private CommonResult<?> handlerResult;

    /**
     * 装配 Web 端前缀配置，用户类型判定按管理端与应用端前缀从请求路径推断。
     *
     * <p>生产由容器注入该属性；单测不启动容器，因此在类初始化时静态注入。</p>
     */
    @BeforeAll
    static void initWebProperties() {
        WebProperties webProperties = new WebProperties();
        webProperties.getAdminApi().setPrefix("/admin-api");
        webProperties.getAppApi().setPrefix("/app-api");
        ReflectionTestUtils.setField(com.basicframework.framework.web.core.util.WebFrameworkUtils.class,
                "properties", webProperties);
    }

    /** 装配被测过滤器并清理线程级安全上下文。 */
    @BeforeEach
    void setUp() {
        SecurityContextHolder.clearContext();
        tokenApi = mock(OAuth2TokenCommonApi.class);
        ObjectProvider<OAuth2TokenCommonApi> provider = mock(ObjectProvider.class);
        when(provider.getObject()).thenReturn(tokenApi);
        filter = new TokenAuthenticationFilter(new SecurityProperties(), exceptionHandler(), provider);
        request = new MockHttpServletRequest("GET", "/admin-api/system/user/list");
        response = new MockHttpServletResponse();
        chain = mock(FilterChain.class);
        checkResult = accessToken(1L, 2);
        handlerResult = null;
        when(tokenApi.checkAccessToken(anyString())).thenAnswer(invocation -> checkResult);
    }

    /** 用例结束后清空线程级安全上下文，避免影响同线程的后续用例。 */
    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    /** 请求不带令牌时必须匿名放行，且完全不去校验令牌。 */
    @Test
    void requestWithoutTokenIsPassedThroughAsAnonymous() throws Exception {
        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        assertThat(appearedInChain()).isTrue();
    }

    /** 令牌有效且用户类型匹配时必须把登录用户写入安全上下文，并继续后续过滤链。 */
    @Test
    void validTokenWritesLoginUserIntoSecurityContext() throws Exception {
        request.addHeader("Authorization", "Bearer token-1");
        request.setServletPath("/admin-api/system/user/list");
        request.setAttribute("login_user_type", 2);

        filter.doFilter(request, response, chain);

        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        assertThat(authentication).isNotNull();
        com.basicframework.framework.security.core.LoginUser loginUser =
                (com.basicframework.framework.security.core.LoginUser) authentication.getPrincipal();
        assertThat(loginUser.getId()).isEqualTo(1L);
        assertThat(loginUser.getUserType()).isEqualTo(2);
        assertThat(appearedInChain()).isTrue();
    }

    /**
     * 用户类型与令牌不一致时必须拒绝访问，不得把令牌写入上下文。
     *
     * <p>拒绝消息本身不对外暴露：{@link AccessDeniedException} 被全局异常处理器翻译成统一的
     * 权限不足响应，原始消息不会进入响应体，避免把"类型不匹配"这条内部判定口径暴露给调用方。</p>
     */
    @Test
    void tokenOfAnotherUserTypeIsRejected() throws Exception {
        request.addHeader("Authorization", "Bearer token-1");
        request.setServletPath("/admin-api/system/user/list");
        request.setAttribute("login_user_type", 1);
        checkResult = accessToken(1L, 2);

        filter.doFilter(request, response, chain);

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        assertThat(appearedInChain()).as("拒绝时不得继续后续过滤链").isFalse();
        // AccessDeniedException 被全局异常处理器翻译成统一的权限不足响应，原始消息不对外暴露。
        assertThat(response.getContentAsString()).contains("\"code\":403");
        assertThat(response.getContentAsString()).doesNotContain("错误的用户类型");
    }

    /** 令牌校验按未登录处理：继续放行到授权链路，由链路统一决定是否拒绝。 */
    @Test
    void invalidTokenIsTreatedAsNotLoggedIn() throws Exception {
        request.addHeader("Authorization", "Bearer token-1");
        checkResult = null;

        filter.doFilter(request, response, chain);

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        assertThat(appearedInChain()).as("无效令牌不等于鉴权失败，由后续链路决定").isTrue();
    }

    /** 令牌仓储抛业务异常时同样按未登录处理，不得把异常抛给调用方。 */
    @Test
    void serviceExceptionFromTokenApiIsTreatedAsNotLoggedIn() throws Exception {
        request.addHeader("Authorization", "Bearer token-1");
        when(tokenApi.checkAccessToken(anyString())).thenThrow(new ServiceException(401002, "访问令牌无效"));

        filter.doFilter(request, response, chain);

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        assertThat(appearedInChain()).isTrue();
        assertThat(response.getContentAsString()).as("未登录不写错误响应体").isEmpty();
    }

    /** 请求不带用户类型时不做类型比对，内部调用的令牌同样可以写入上下文。 */
    @Test
    void tokenWithoutUserTypeRequirementIsAccepted() throws Exception {
        request.addHeader("Authorization", "Bearer token-1");
        request.setServletPath("/internal/report");
        checkResult = accessToken(1L, 2);

        filter.doFilter(request, response, chain);

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNotNull();
        assertThat(appearedInChain()).isTrue();
    }

    /** 令牌仓储抛出非业务异常时必须按错误响应返回，并且不继续后续过滤链。 */
    @Test
    void unexpectedFailureIsReturnedAsErrorResponse() throws Exception {
        request.addHeader("Authorization", "Bearer token-1");
        when(tokenApi.checkAccessToken(anyString())).thenThrow(new IllegalStateException("数据库不可用"));

        filter.doFilter(request, response, chain);

        assertThat(appearedInChain()).as("出错后不得继续后续过滤链").isFalse();
        assertThat(response.getContentAsString()).isNotEmpty();
        assertThat(JsonUtils.parseObject(response.getContentAsString(), CommonResult.class).getCode())
                .as("必须返回统一错误结构而不是静默放行").isNotEqualTo(0);
    }

    /** JVM 级 Error 必须继续传播，不能被包装成鉴权响应。 */
    @Test
    void jvmErrorPropagatesInsteadOfBecomingAnAuthResponse() {
        request.addHeader("Authorization", "Bearer token-1");
        when(tokenApi.checkAccessToken(anyString())).thenThrow(new StackOverflowError("JVM 级故障"));

        Throwable thrown = org.junit.jupiter.api.Assertions.assertThrows(StackOverflowError.class,
                () -> filter.doFilter(request, response, chain));

        assertThat(thrown).isInstanceOf(StackOverflowError.class);
        assertThat(appearedInChain()).isFalse();
    }

    /** 登录用户的权限范围与附加信息必须原样透传，鉴权链路据此做接口级授权。 */
    @Test
    void loginUserCarriesScopesAndAdditionalInfo() throws Exception {
        request.addHeader("Authorization", "Bearer token-1");
        checkResult = accessToken(7L, 2);
        checkResult.setScopes(List.of("user.read", "sms:send"));
        checkResult.setUserInfo(java.util.Map.of("tenantId", "3"));
        checkResult.setExpiresTime(LocalDateTime.now().plusHours(1));

        filter.doFilter(request, response, chain);

        com.basicframework.framework.security.core.LoginUser loginUser =
                (com.basicframework.framework.security.core.LoginUser)
                        SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        assertThat(loginUser.getId()).isEqualTo(7L);
        assertThat(loginUser.getUserType()).isEqualTo(2);
        assertThat(loginUser.getScopes()).containsExactly("user.read", "sms:send");
        assertThat(loginUser.getInfo()).containsEntry("tenantId", "3");
        assertThat(loginUser.getExpiresTime()).isNotNull();
    }

    /**
     * 构造一个只用于被测过滤链的异常处理器：错误日志接口为替身，不参与断言。
     *
     * @return 异常处理器实例
     */
    private static GlobalExceptionHandler exceptionHandler() {
        return new GlobalExceptionHandler("test",
                mock(com.basicframework.framework.common.biz.infra.logger.ApiErrorLogCommonApi.class));
    }

    /**
     * 判断后续过滤链是否被调用。
     *
     * @return 被调用时为真
     */
    private boolean appearedInChain() {
        try {
            org.mockito.Mockito.verify(chain).doFilter(request, response);
            return true;
        } catch (Throwable verificationFailure) {
            return false;
        }
    }

    /**
     * 构造一条校验通过的令牌结果。
     *
     * @param userId 用户编号
     * @param userType 用户类型
     * @return 令牌校验结果
     */
    private OAuth2AccessTokenCheckRespDTO accessToken(Long userId, Integer userType) {
        OAuth2AccessTokenCheckRespDTO dto = new OAuth2AccessTokenCheckRespDTO();
        dto.setUserId(userId);
        dto.setUserType(userType);
        dto.setExpiresTime(LocalDateTime.now().plusHours(1));
        return dto;
    }

}