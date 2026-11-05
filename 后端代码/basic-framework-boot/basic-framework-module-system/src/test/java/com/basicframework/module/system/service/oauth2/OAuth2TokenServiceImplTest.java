package com.basicframework.module.system.service.oauth2;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.security.config.SecurityProperties;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2ClientDO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2RefreshTokenDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2AccessTokenMapper;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2RefreshTokenMapper;
import com.basicframework.module.system.dal.redis.oauth2.OAuth2AccessTokenRedisDAO;
import com.basicframework.module.system.enums.oauth2.OAuth2ClientConstants;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;

import static com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants.UNAUTHORIZED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证内部会话客户端、令牌空闲超时校验与按用户统一吊销。
 *
 * @author shady2713
 */
@ExtendWith(MockitoExtension.class)
class OAuth2TokenServiceImplTest {

    /** 用例用户编号。 */
    private static final Long USER_ID = 1024L;

    @Mock
    private OAuth2AccessTokenMapper oauth2AccessTokenMapper;
    @Mock
    private OAuth2RefreshTokenMapper oauth2RefreshTokenMapper;
    @Mock
    private OAuth2AccessTokenRedisDAO oauth2AccessTokenRedisDAO;
    @Mock
    private OAuth2ClientService oauth2ClientService;
    @Mock
    private AdminUserService adminUserService;

    private SecurityProperties securityProperties;

    private OAuth2TokenServiceImpl tokenService;

    /**
     * 构造 30 分钟空闲超时、30 分钟访问令牌、30 天刷新令牌的会话配置。
     */
    @BeforeEach
    void setUp() {
        securityProperties = new SecurityProperties();
        securityProperties.getSession().setIdleTimeout(Duration.ofMinutes(30));
        securityProperties.getSession().setAccessTokenValidity(Duration.ofMinutes(30));
        securityProperties.getSession().setRefreshTokenValidity(Duration.ofDays(30));
        tokenService = new OAuth2TokenServiceImpl();
        org.springframework.test.util.ReflectionTestUtils.setField(tokenService, "oauth2AccessTokenMapper",
                oauth2AccessTokenMapper);
        org.springframework.test.util.ReflectionTestUtils.setField(tokenService, "oauth2RefreshTokenMapper",
                oauth2RefreshTokenMapper);
        org.springframework.test.util.ReflectionTestUtils.setField(tokenService, "oauth2AccessTokenRedisDAO",
                oauth2AccessTokenRedisDAO);
        org.springframework.test.util.ReflectionTestUtils.setField(tokenService, "oauth2ClientService",
                oauth2ClientService);
        org.springframework.test.util.ReflectionTestUtils.setField(tokenService, "adminUserService",
                adminUserService);
        org.springframework.test.util.ReflectionTestUtils.setField(tokenService, "securityProperties",
                securityProperties);
        lenient().when(oauth2ClientService.getSystemClient()).thenReturn(buildSystemClient());
        lenient().when(adminUserService.getUser(anyLong())).thenReturn(buildAdminUser());
    }

    /** 验证内部会话客户端签发令牌时写入活动标记，且不查持久化客户端。 */
    @Test
    void createAccessTokenMarksActivityForInternalClient() {
        OAuth2AccessTokenDO accessToken = tokenService.createAccessToken(USER_ID, 2,
                OAuth2ClientConstants.CLIENT_ID_SYSTEM, null);

        assertThat(accessToken.getClientId()).isEqualTo(OAuth2ClientConstants.CLIENT_ID_SYSTEM);
        verify(oauth2AccessTokenRedisDAO).setActive(eq(accessToken.getAccessToken()),
                eq(Duration.ofMinutes(30)));
        verify(oauth2ClientService, never()).validOAuthClientFromCache(anyString());
    }

    /** 验证访问令牌缺少活动标记时按空闲超时拒绝。 */
    @Test
    void checkAccessTokenRejectsIdleSession() {
        when(oauth2AccessTokenRedisDAO.get("access-token")).thenReturn(buildAccessToken("access-token"));
        when(oauth2AccessTokenRedisDAO.refreshActive("access-token", Duration.ofMinutes(30)))
                .thenReturn(false);

        assertThatThrownBy(() -> tokenService.checkAccessToken("access-token"))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(UNAUTHORIZED.getCode()));
    }

    /** 验证活跃会话通过校验并顺延空闲计时。 */
    @Test
    void checkAccessTokenRefreshesActiveSession() {
        OAuth2AccessTokenDO accessToken = buildAccessToken("access-token");
        when(oauth2AccessTokenRedisDAO.get("access-token")).thenReturn(accessToken);
        when(oauth2AccessTokenRedisDAO.refreshActive("access-token", Duration.ofMinutes(30)))
                .thenReturn(true);

        assertThat(tokenService.checkAccessToken("access-token")).isSameAs(accessToken);
    }

    /** 验证开放接口客户端的令牌不受管理后台空闲超时影响。 */
    @Test
    void checkAccessTokenSkipsIdleCheckForPublicClient() {
        OAuth2AccessTokenDO accessToken = buildAccessToken("public-token");
        accessToken.setClientId("open-client");
        when(oauth2AccessTokenRedisDAO.get("public-token")).thenReturn(accessToken);

        assertThat(tokenService.checkAccessToken("public-token")).isSameAs(accessToken);
        verify(oauth2AccessTokenRedisDAO, never()).refreshActive(anyString(), any(Duration.class));
    }

    /** 验证历史 default 客户端的残留访问令牌立即失效。 */
    @Test
    void checkAccessTokenRejectsLegacyDefaultClientToken() {
        OAuth2AccessTokenDO accessToken = buildAccessToken("legacy-token");
        accessToken.setClientId(OAuth2ClientConstants.CLIENT_ID_LEGACY_DEFAULT);
        when(oauth2AccessTokenRedisDAO.get("legacy-token")).thenReturn(accessToken);

        assertThatThrownBy(() -> tokenService.checkAccessToken("legacy-token"))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(UNAUTHORIZED.getCode()));
    }

    /** 验证历史 default 客户端的刷新令牌不能再换发访问令牌。 */
    @Test
    void refreshAccessTokenRejectsLegacyDefaultClientToken() {
        OAuth2RefreshTokenDO refreshToken = buildRefreshToken("legacy-refresh-token");
        refreshToken.setClientId(OAuth2ClientConstants.CLIENT_ID_LEGACY_DEFAULT);
        when(oauth2RefreshTokenMapper.selectByRefreshToken("legacy-refresh-token"))
                .thenReturn(refreshToken);

        assertThatThrownBy(() -> tokenService.refreshAccessToken("legacy-refresh-token",
                OAuth2ClientConstants.CLIENT_ID_SYSTEM))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(UNAUTHORIZED.getCode()));
    }

    /** 验证空闲超时关闭后不再依赖活动标记。 */
    @Test
    void checkAccessTokenSkipsIdleCheckWhenDisabled() {
        securityProperties.getSession().setIdleTimeout(Duration.ZERO);
        when(oauth2AccessTokenRedisDAO.get("access-token")).thenReturn(buildAccessToken("access-token"));

        assertThat(tokenService.checkAccessToken("access-token")).isNotNull();
        verify(oauth2AccessTokenRedisDAO, never()).refreshActive(anyString(), any(Duration.class));
    }

    /** 验证空闲会话不能通过刷新令牌续期，旧访问令牌也不会被删除。 */
    @Test
    void refreshAccessTokenRejectsIdleSession() {
        when(oauth2RefreshTokenMapper.selectByRefreshToken("refresh-token"))
                .thenReturn(buildRefreshToken("refresh-token"));
        when(oauth2AccessTokenMapper.selectListByRefreshToken("refresh-token"))
                .thenReturn(List.of(buildAccessToken("old-access-token")));
        when(oauth2AccessTokenRedisDAO.isActive("old-access-token")).thenReturn(false);

        assertThatThrownBy(() -> tokenService.refreshAccessToken("refresh-token",
                OAuth2ClientConstants.CLIENT_ID_SYSTEM))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(UNAUTHORIZED.getCode()));
        verify(oauth2AccessTokenMapper, never()).deleteByIds(any());
    }

    /** 验证活跃会话刷新成功后签发新令牌并写入活动标记。 */
    @Test
    void refreshAccessTokenIssuesNewTokenForActiveSession() {
        when(oauth2RefreshTokenMapper.selectByRefreshToken("refresh-token"))
                .thenReturn(buildRefreshToken("refresh-token"));
        when(oauth2AccessTokenMapper.selectListByRefreshToken("refresh-token"))
                .thenReturn(List.of(buildAccessToken("old-access-token")));
        when(oauth2AccessTokenRedisDAO.isActive("old-access-token")).thenReturn(true);

        OAuth2AccessTokenDO newToken = tokenService.refreshAccessToken("refresh-token",
                OAuth2ClientConstants.CLIENT_ID_SYSTEM);

        assertThat(newToken.getClientId()).isEqualTo(OAuth2ClientConstants.CLIENT_ID_SYSTEM);
        verify(oauth2AccessTokenMapper).deleteByIds(any());
        verify(oauth2AccessTokenRedisDAO).deleteList(any());
        verify(oauth2AccessTokenRedisDAO).setActive(eq(newToken.getAccessToken()),
                eq(Duration.ofMinutes(30)));
    }

    /** 验证按用户吊销时删除访问令牌、刷新令牌、令牌缓存和活动标记。 */
    @Test
    void removeAccessTokenByUserRevokesAllTokens() {
        when(oauth2AccessTokenMapper.selectListByUserIdAndUserType(USER_ID, 2))
                .thenReturn(List.of(buildAccessToken("access-token")));

        tokenService.removeAccessToken(USER_ID, 2);

        verify(oauth2AccessTokenMapper).deleteByIds(any());
        verify(oauth2AccessTokenRedisDAO).deleteList(any());
        verify(oauth2RefreshTokenMapper).deleteByUserIdAndUserType(USER_ID, 2);
    }

    /** 验证没有访问令牌时仍删除该用户残留的刷新令牌。 */
    @Test
    void removeAccessTokenByUserDeletesOrphanRefreshTokens() {
        when(oauth2AccessTokenMapper.selectListByUserIdAndUserType(USER_ID, 2)).thenReturn(List.of());

        tokenService.removeAccessToken(USER_ID, 2);

        verify(oauth2AccessTokenMapper, never()).deleteByIds(any());
        verify(oauth2AccessTokenRedisDAO, never()).deleteList(any());
        verify(oauth2RefreshTokenMapper).deleteByUserIdAndUserType(USER_ID, 2);
    }

    /** 验证注销单个令牌时同步删除活动标记。 */
    @Test
    void removeAccessTokenDeletesActivityMarker() {
        when(oauth2AccessTokenMapper.selectByAccessToken("access-token"))
                .thenReturn(buildAccessToken("access-token"));

        assertThat(tokenService.removeAccessToken("access-token")).isNotNull();

        verify(oauth2AccessTokenRedisDAO).delete("access-token");
        verify(oauth2AccessTokenRedisDAO).deleteActive("access-token");
        verify(oauth2RefreshTokenMapper).deleteByRefreshToken("refresh-token");
    }

    /**
     * 构造内部会话客户端。
     *
     * @return 客户端配置
     */
    private static OAuth2ClientDO buildSystemClient() {
        OAuth2ClientDO client = new OAuth2ClientDO();
        client.setClientId(OAuth2ClientConstants.CLIENT_ID_SYSTEM);
        client.setStatus(0);
        client.setAccessTokenValiditySeconds((int) Duration.ofMinutes(30).toSeconds());
        client.setRefreshTokenValiditySeconds((int) Duration.ofDays(30).toSeconds());
        return client;
    }

    /**
     * 构造启用状态的管理员用户。
     *
     * @return 用户数据
     */
    private static AdminUserDO buildAdminUser() {
        AdminUserDO user = new AdminUserDO();
        user.setId(USER_ID);
        user.setNickname("测试用户");
        return user;
    }

    /**
     * 构造未过期的访问令牌。
     *
     * @param accessToken 访问令牌值
     * @return 访问令牌数据
     */
    private static OAuth2AccessTokenDO buildAccessToken(String accessToken) {
        OAuth2AccessTokenDO token = new OAuth2AccessTokenDO();
        token.setId(1L);
        token.setUserId(USER_ID);
        token.setUserType(2);
        token.setClientId(OAuth2ClientConstants.CLIENT_ID_SYSTEM);
        token.setAccessToken(accessToken);
        token.setRefreshToken("refresh-token");
        token.setExpiresTime(LocalDateTime.now().plusMinutes(30));
        return token;
    }

    /**
     * 构造未过期的刷新令牌。
     *
     * @param refreshToken 刷新令牌值
     * @return 刷新令牌数据
     */
    private static OAuth2RefreshTokenDO buildRefreshToken(String refreshToken) {
        OAuth2RefreshTokenDO token = new OAuth2RefreshTokenDO();
        token.setId(1L);
        token.setUserId(USER_ID);
        token.setUserType(2);
        token.setClientId(OAuth2ClientConstants.CLIENT_ID_SYSTEM);
        token.setRefreshToken(refreshToken);
        token.setExpiresTime(LocalDateTime.now().plusDays(30));
        return token;
    }
}
