package com.basicframework.module.system.service.oauth2;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.service.auth.AdminAuthService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证 OAuth2 各授权方式的令牌签发与撤销口径。
 *
 * <p>隐式授权与刷新授权都必须把客户端标识带到令牌服务，刷新令牌失效或归属客户端不一致时
 * 必须拒绝，否则 A 客户端的刷新令牌能换到 B 客户端的访问令牌。撤销令牌必须先查后删并校验
 * 客户端归属，客户端不匹配时返回 false 而不是删除他人令牌；删除未命中同样返回 false，
 * 让接口层如实反映“没有撤销到任何令牌”。密码授权必须使用认证得到的真实用户编号与管理端
 * 用户类型，客户端凭据授权没有真实用户，只能使用 0 号占位主体。</p>
 *
 * @author shady2713
 */
class OAuth2GrantServiceImplTest {

    /** 刷新令牌无效的业务错误码。 */
    private static final Integer REFRESH_TOKEN_INVALID_CODE = 1_002_021_003;

    /** 被测服务，令牌服务与认证服务按外部边界替换为替身。 */
    private OAuth2GrantServiceImpl grantService;
    /** 令牌服务替身。 */
    private OAuth2TokenService oauth2TokenService;
    /** 管理端认证服务替身。 */
    private AdminAuthService adminAuthService;

    /** 为每个用例创建独立服务与替身，避免用例之间共享调用记录。 */
    @BeforeEach
    void setUp() {
        grantService = new OAuth2GrantServiceImpl();
        oauth2TokenService = mock(OAuth2TokenService.class);
        adminAuthService = mock(AdminAuthService.class);
        ReflectionTestUtils.setField(grantService, "oauth2TokenService", oauth2TokenService);
        ReflectionTestUtils.setField(grantService, "adminAuthService", adminAuthService);
    }

    /** 隐式授权必须原样转发用户、用户类型、客户端与授权范围。 */
    @Test
    void grantImplicitForwardsIdentityAndScopes() {
        OAuth2AccessTokenDO token = token("access-1", "default");
        when(oauth2TokenService.createAccessToken(1024L, 2, "default", List.of("user.read")))
                .thenReturn(token);

        assertThat(grantService.grantImplicit(1024L, 2, "default", List.of("user.read"))).isSameAs(token);
    }

    /** 密码授权必须使用认证得到的用户编号与管理端用户类型签发令牌。 */
    @Test
    void grantPasswordUsesAuthenticatedUserIdentity() {
        AdminUserDO user = new AdminUserDO();
        user.setId(2048L);
        when(adminAuthService.authenticate("admin", "encoded-password")).thenReturn(user);
        OAuth2AccessTokenDO token = token("access-2", "default");
        when(oauth2TokenService.createAccessToken(2048L, 2, "default", List.of("user.read")))
                .thenReturn(token);

        assertThat(grantService.grantPassword("admin", "encoded-password", "default", List.of("user.read")))
                .isSameAs(token);
    }

    /** 认证结果为 null 时必须拒绝签发，不能签出无主体令牌。 */
    @Test
    void grantPasswordRejectsMissingUser() {
        when(adminAuthService.authenticate("admin", "encoded-password")).thenReturn(null);

        assertThatThrownBy(() -> grantService.grantPassword("admin", "encoded-password", "default", List.of()))
                .isInstanceOf(IllegalArgumentException.class);
        verify(oauth2TokenService, never()).createAccessToken(anyLong(), any(), any(), any());
    }

    /** 客户端凭据授权没有真实用户，必须使用 0 号占位主体与管理端用户类型。 */
    @Test
    void grantClientCredentialsUsesPlaceholderUser() {
        OAuth2AccessTokenDO token = token("access-3", "default");
        when(oauth2TokenService.createAccessToken(0L, 2, "default", List.of("machine.read")))
                .thenReturn(token);

        assertThat(grantService.grantClientCredentials("default", List.of("machine.read"))).isSameAs(token);
    }

    /** 刷新令牌有效且归属客户端一致时必须返回新令牌。 */
    @Test
    void grantRefreshTokenReturnsTokenOfSameClient() {
        OAuth2AccessTokenDO token = token("access-4", "default");
        when(oauth2TokenService.refreshAccessToken("refresh-4", "default")).thenReturn(token);

        assertThat(grantService.grantRefreshToken("refresh-4", "default")).isSameAs(token);
    }

    /** 刷新令牌不存在或归属其它客户端时必须抛“无效的刷新令牌”。 */
    @Test
    void grantRefreshTokenRejectsInvalidOrForeignToken() {
        when(oauth2TokenService.refreshAccessToken("missing", "default")).thenReturn(null);
        when(oauth2TokenService.refreshAccessToken("foreign", "default")).thenReturn(token("access-5", "other"));

        assertThatThrownBy(() -> grantService.grantRefreshToken("missing", "default"))
                .isInstanceOf(ServiceException.class)
                .hasMessage("无效的刷新令牌")
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(REFRESH_TOKEN_INVALID_CODE);
        assertThatThrownBy(() -> grantService.grantRefreshToken("foreign", "default"))
                .isInstanceOf(ServiceException.class)
                .hasMessage("无效的刷新令牌");
    }

    /** 撤销令牌时客户端归属一致才允许删除，删除未命中返回 false。 */
    @Test
    void revokeTokenRequiresSameClientAndRealRemoval() {
        when(oauth2TokenService.getAccessToken("access-6")).thenReturn(token("access-6", "default"));
        when(oauth2TokenService.removeAccessToken("access-6")).thenReturn(token("access-6", "default"));
        when(oauth2TokenService.getAccessToken("access-7")).thenReturn(token("access-7", "other"));

        assertThat(grantService.revokeToken("default", "access-6")).isTrue();
        assertThat(grantService.revokeToken("default", "access-7"))
                .as("客户端不匹配时不得删除他人令牌").isFalse();
        verify(oauth2TokenService, never()).removeAccessToken("access-7");
    }

    /** 令牌不存在或删除未命中时必须返回 false，不能假装撤销成功。 */
    @Test
    void revokeTokenReportsFailureWhenNothingRemoved() {
        when(oauth2TokenService.getAccessToken("missing")).thenReturn(null);
        when(oauth2TokenService.getAccessToken("access-8")).thenReturn(token("access-8", "default"));
        when(oauth2TokenService.removeAccessToken("access-8")).thenReturn(null);

        assertThat(grantService.revokeToken("default", "missing")).isFalse();
        assertThat(grantService.revokeToken("default", "access-8")).isFalse();
    }

    /** 构造只填充客户端归属的访问令牌。 */
    private static OAuth2AccessTokenDO token(String accessToken, String clientId) {
        OAuth2AccessTokenDO token = new OAuth2AccessTokenDO();
        token.setAccessToken(accessToken);
        token.setClientId(clientId);
        return token;
    }
}
