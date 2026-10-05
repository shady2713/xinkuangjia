package com.basicframework.module.system.service.oauth2;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.oauth2.vo.token.OAuth2AccessTokenPageReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2ClientDO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2RefreshTokenDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2AccessTokenMapper;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2RefreshTokenMapper;
import com.basicframework.module.system.dal.mysql.user.AdminUserMapper;
import com.basicframework.module.system.dal.redis.oauth2.OAuth2AccessTokenRedisDAO;
import com.basicframework.module.system.enums.oauth2.OAuth2MachineToken;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.lang.reflect.Method;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证访问令牌服务在刷新、校验、撤销与分页入口上的真实失败语义与副作用。
 *
 * <p>这些分支决定会话安全：刷新令牌的客户端不匹配时必须拒绝且**保留**原会话（拒绝却顺手撤销，
 * 会让一次错误请求变成强制下线）；刷新令牌已过期时必须删除该刷新记录再报错，避免过期凭据
 * 长期留存；访问令牌过期必须按 401 拒绝；撤销未知令牌必须返回 null 而不是抛错（调用方按幂等处理）；
 * 机器令牌使用共享哨兵刷新值，撤销时只能精确删除本行，按哨兵值批量删除会连带撤销所有机器会话。</p>
 *
 * <p>分页入口必须把管理端请求原样交给 Mapper，不得在服务层改写条件。</p>
 *
 * @author shady2713
 */
class OAuth2TokenServiceImplTest {

    /** 被测服务。 */
    private final OAuth2TokenServiceImpl tokenService = new OAuth2TokenServiceImpl();

    /** 访问令牌 Mapper 替身。 */
    private final OAuth2AccessTokenMapper accessTokenMapper = mock(OAuth2AccessTokenMapper.class);
    /** 刷新令牌 Mapper 替身。 */
    private final OAuth2RefreshTokenMapper refreshTokenMapper = mock(OAuth2RefreshTokenMapper.class);
    /** 管理员 Mapper 替身。 */
    private final AdminUserMapper adminUserMapper = mock(AdminUserMapper.class);
    /** 旧版令牌缓存 DAO 替身。 */
    private final OAuth2AccessTokenRedisDAO accessTokenRedisDAO = mock(OAuth2AccessTokenRedisDAO.class);
    /** 客户端服务替身。 */
    private final OAuth2ClientService clientService = mock(OAuth2ClientService.class);
    /** 管理员服务替身。 */
    private final AdminUserService adminUserService = mock(AdminUserService.class);

    /** 刷新令牌的客户端与请求不一致时必须拒绝，且不得撤销原会话。 */
    @Test
    void refreshRejectsClientMismatchWithoutRevokingSession() {
        injectDependencies();
        OAuth2RefreshTokenDO refreshToken = refreshToken(9L, 5L, "client-alpha",
                LocalDateTime.now().plusHours(1));
        when(refreshTokenMapper.selectByRefreshToken("DUMMY-REFRESH-ALPHA")).thenReturn(refreshToken);
        when(refreshTokenMapper.selectByRefreshTokenForUpdate("DUMMY-REFRESH-ALPHA")).thenReturn(refreshToken);
        when(adminUserMapper.selectByIdForUpdate(5L)).thenReturn(enabledUser(5L));
        when(clientService.validOAuthClientFromCache("client-beta")).thenReturn(client("client-beta"));

        assertThatThrownBy(() -> tokenService.refreshAccessToken("DUMMY-REFRESH-ALPHA", "client-beta"))
                .isInstanceOf(ServiceException.class)
                .hasMessage("刷新令牌的客户端编号不正确")
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(400);
        verify(accessTokenMapper, never()).deleteByRefreshToken(anyString());
        verify(refreshTokenMapper, never()).deleteById(anyLong());
    }

    /** 刷新令牌已过期时必须先删除该刷新记录再报 401，避免过期凭据留存。 */
    @Test
    void refreshDeletesExpiredSessionAndRejects() {
        injectDependencies();
        OAuth2RefreshTokenDO expired = refreshToken(11L, 5L, "client-alpha", LocalDateTime.now().minusMinutes(1));
        when(refreshTokenMapper.selectByRefreshToken("DUMMY-REFRESH-EXPIRED")).thenReturn(expired);
        when(refreshTokenMapper.selectByRefreshTokenForUpdate("DUMMY-REFRESH-EXPIRED")).thenReturn(expired);
        when(adminUserMapper.selectByIdForUpdate(5L)).thenReturn(enabledUser(5L));
        when(clientService.validOAuthClientFromCache("client-alpha")).thenReturn(client("client-alpha"));
        when(accessTokenMapper.selectListByRefreshToken("DUMMY-REFRESH-EXPIRED")).thenReturn(List.of());

        assertThatThrownBy(() -> tokenService.refreshAccessToken("DUMMY-REFRESH-EXPIRED", "client-alpha"))
                .isInstanceOf(ServiceException.class)
                .hasMessage("刷新令牌已过期")
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(401);
        verify(refreshTokenMapper).deleteById(11L);
        verify(accessTokenMapper).deleteByRefreshToken("DUMMY-REFRESH-EXPIRED");
    }

    /** 访问令牌已过期时必须按 401 拒绝，不得放行过期会话。 */
    @Test
    void checkAccessTokenRejectsExpiredToken() {
        injectDependencies();
        OAuth2AccessTokenDO expired = accessToken("DUMMY-ACCESS-EXPIRED", 5L, "DUMMY-REFRESH-ALPHA",
                LocalDateTime.now().minusSeconds(1));
        when(accessTokenMapper.selectByAccessToken("DUMMY-ACCESS-EXPIRED")).thenReturn(expired);

        assertThatThrownBy(() -> tokenService.checkAccessToken("DUMMY-ACCESS-EXPIRED"))
                .isInstanceOf(ServiceException.class)
                .hasMessage("访问令牌已过期")
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(401);
    }

    /** 撤销未知令牌必须返回 null，让调用方按幂等成功处理。 */
    @Test
    void removeUnknownAccessTokenReturnsNull() {
        injectDependencies();
        when(accessTokenMapper.selectByAccessToken("DUMMY-ACCESS-ABSENT")).thenReturn(null);

        assertThat(inTransaction(() -> tokenService.removeAccessToken("DUMMY-ACCESS-ABSENT"))).isNull();
        verify(accessTokenMapper, never()).deleteById(anyLong());
        verify(refreshTokenMapper, never()).deleteByRefreshToken(anyString());
    }

    /**
     * 机器主体（空编号或非正编号）不得查询用户信息，必须直接返回空用户信息。
     *
     * <p>机器令牌使用非正编号作为哨兵，刷新流程的公开入口都会先用同一判定拦下它们；
     * 若这里漏掉守卫，刷新机器令牌会带着哨兵编号去查用户表，要么拿到无关账号的信息，
     * 要么以空指针失败。用例直接断言“返回空映射且不查询用户服务”。</p>
     *
     * <p><b>白盒直调：</b>{@code buildUserInfo} 私有，且唯一调用点位于机器主体守卫之后，
     * 生产路径不可达；反射直调传入哨兵编号即可验证该守卫本身的契约。</p>
     *
     * @throws Exception 反射查找或调用失败时抛出
     */
    @Test
    @SuppressWarnings("unchecked")
    void buildUserInfoReturnsEmptyMapForMachinePrincipal() throws Exception {
        Method method = OAuth2TokenServiceImpl.class.getDeclaredMethod("buildUserInfo", Long.class, Integer.class);
        method.setAccessible(true);

        assertThat((Map<String, String>) method.invoke(tokenService, null, UserTypeEnum.ADMIN.getValue()))
                .as("空编号属于机器主体，必须返回空用户信息").isEmpty();
        assertThat((Map<String, String>) method.invoke(tokenService, 0L, UserTypeEnum.ADMIN.getValue()))
                .as("编号 0 属于机器主体哨兵").isEmpty();
        assertThat((Map<String, String>) method.invoke(tokenService, -1L, UserTypeEnum.ADMIN.getValue()))
                .as("负编号同样属于机器主体").isEmpty();
        verify(adminUserService, never()).getUser(anyLong());
    }

    /** 机器令牌按哨兵刷新值只能精确删除本行，不得按哨兵值批量撤销其它机器会话。 */
    @Test
    void removeMachineAccessTokenDeletesSingleRowOnly() {
        injectDependencies();
        OAuth2AccessTokenDO machineToken = accessToken("DUMMY-ACCESS-MACHINE", 0L,
                OAuth2MachineToken.MACHINE_NO_REFRESH_TOKEN, LocalDateTime.now().plusMinutes(5));
        machineToken.setId(21L);
        when(accessTokenMapper.selectByAccessToken("DUMMY-ACCESS-MACHINE")).thenReturn(machineToken);

        assertThat(inTransaction(() -> tokenService.removeAccessToken("DUMMY-ACCESS-MACHINE")))
                .isSameAs(machineToken);
        verify(accessTokenMapper).deleteById(21L);
        verify(accessTokenMapper, never()).deleteByRefreshToken(anyString());
        verify(refreshTokenMapper, never()).deleteByRefreshToken(anyString());
    }

    /** 真实用户会话撤销必须同时删除访问令牌与刷新令牌，避免退出后仍可续期。 */
    @Test
    void removeRealUserAccessTokenRevokesWholeSession() {
        injectDependencies();
        OAuth2AccessTokenDO accessToken = accessToken("DUMMY-ACCESS-ALPHA", 5L, "DUMMY-REFRESH-ALPHA",
                LocalDateTime.now().plusMinutes(5));
        accessToken.setId(22L);
        when(accessTokenMapper.selectByAccessToken("DUMMY-ACCESS-ALPHA")).thenReturn(accessToken);
        when(adminUserMapper.selectByIdForUpdate(5L)).thenReturn(enabledUser(5L));

        assertThat(inTransaction(() -> tokenService.removeAccessToken("DUMMY-ACCESS-ALPHA")))
                .isSameAs(accessToken);
        verify(accessTokenMapper).deleteByRefreshToken("DUMMY-REFRESH-ALPHA");
        verify(refreshTokenMapper).deleteByRefreshToken("DUMMY-REFRESH-ALPHA");
        verify(accessTokenMapper, never()).deleteById(anyLong());
    }

    /** 分页入口必须把管理端请求原样交给 Mapper，不在服务层改写条件。 */
    @Test
    void accessTokenPageDelegatesToMapper() {
        injectDependencies();
        OAuth2AccessTokenPageReqVO reqVO = new OAuth2AccessTokenPageReqVO();
        reqVO.setUserId(5L);
        reqVO.setUserType(UserTypeEnum.ADMIN.getValue());
        reqVO.setClientId("client-alpha");
        PageResult<OAuth2AccessTokenDO> expected = new PageResult<>(List.of(
                accessToken("DUMMY-ACCESS-ALPHA", 5L, "DUMMY-REFRESH-ALPHA", LocalDateTime.now().plusMinutes(5))), 1L);
        when(accessTokenMapper.selectPage(reqVO)).thenReturn(expected);

        assertThat(tokenService.getAccessTokenPage(reqVO)).isSameAs(expected);
        verify(accessTokenMapper).selectPage(reqVO);
    }

    /**
     * 在真实事务同步上下文中执行撤销操作。
     *
     * <p>撤销流程会在提交成功后注册缓存清理回调，未开启事务同步时会直接失败；
     * 这里显式建立并清理同步上下文，使调用条件与生产事务内调用一致。</p>
     *
     * @param action 待执行操作
     * @param <T> 返回类型
     * @return 操作结果
     */
    private static <T> T inTransaction(java.util.function.Supplier<T> action) {
        TransactionSynchronizationManager.initSynchronization();
        try {
            return action.get();
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    /** 注入全部依赖替身，保证被测服务只访问受控边界。 */
    private void injectDependencies() {
        ReflectionTestUtils.setField(tokenService, "oauth2AccessTokenMapper", accessTokenMapper);
        ReflectionTestUtils.setField(tokenService, "oauth2RefreshTokenMapper", refreshTokenMapper);
        ReflectionTestUtils.setField(tokenService, "adminUserMapper", adminUserMapper);
        ReflectionTestUtils.setField(tokenService, "oauth2AccessTokenRedisDAO", accessTokenRedisDAO);
        ReflectionTestUtils.setField(tokenService, "oauth2ClientService", clientService);
        ReflectionTestUtils.setField(tokenService, "adminUserService", adminUserService);
    }

    /**
     * 构造刷新令牌记录。
     *
     * @param id 记录编号
     * @param userId 用户编号
     * @param clientId 客户端编号
     * @param expiresTime 过期时间
     * @return 刷新令牌记录
     */
    private static OAuth2RefreshTokenDO refreshToken(Long id, Long userId, String clientId, LocalDateTime expiresTime) {
        OAuth2RefreshTokenDO token = new OAuth2RefreshTokenDO();
        token.setId(id);
        token.setRefreshToken("DUMMY-REFRESH-ALPHA");
        token.setUserId(userId);
        token.setUserType(UserTypeEnum.ADMIN.getValue());
        token.setClientId(clientId);
        token.setScopes(List.of("user.read"));
        token.setExpiresTime(expiresTime);
        return token;
    }

    /**
     * 构造访问令牌记录。
     *
     * @param accessToken 访问令牌
     * @param userId 用户编号
     * @param refreshToken 刷新令牌或机器哨兵值
     * @param expiresTime 过期时间
     * @return 访问令牌记录
     */
    private static OAuth2AccessTokenDO accessToken(String accessToken, Long userId, String refreshToken,
                                                   LocalDateTime expiresTime) {
        OAuth2AccessTokenDO token = new OAuth2AccessTokenDO();
        token.setAccessToken(accessToken);
        token.setRefreshToken(refreshToken);
        token.setUserId(userId);
        token.setUserType(UserTypeEnum.ADMIN.getValue());
        token.setClientId("client-alpha");
        token.setScopes(List.of("user.read"));
        token.setExpiresTime(expiresTime);
        return token;
    }

    /**
     * 构造已启用的管理员记录。
     *
     * @param id 用户编号
     * @return 管理员记录
     */
    private static AdminUserDO enabledUser(Long id) {
        AdminUserDO user = new AdminUserDO();
        user.setId(id);
        user.setStatus(CommonStatusEnum.ENABLE.getStatus());
        return user;
    }

    /**
     * 构造 OAuth2 客户端记录。
     *
     * @param clientId 客户端编号
     * @return 客户端记录
     */
    private static OAuth2ClientDO client(String clientId) {
        OAuth2ClientDO client = new OAuth2ClientDO();
        client.setClientId(clientId);
        client.setAccessTokenValiditySeconds(1800);
        client.setRefreshTokenValiditySeconds(2592000);
        return client;
    }

    /**
     * 会员类型刷新成功但不装配用户信息，避免为未实现的会员读取打穿下游。
     *
     * <p>会员登录尚未实现用户读取，签发时必须给出空用户信息而不是空指针或错误的昵称。</p>
     */
    @Test
    void refreshForMemberTypeIssuesTokenWithEmptyUserInfo() {
        injectDependencies();
        OAuth2RefreshTokenDO refreshToken = refreshToken(12L, 6L, "client-alpha", LocalDateTime.now().plusHours(1));
        refreshToken.setUserType(UserTypeEnum.MEMBER.getValue());
        when(refreshTokenMapper.selectByRefreshToken("DUMMY-REFRESH-ALPHA")).thenReturn(refreshToken);
        when(refreshTokenMapper.selectByRefreshTokenForUpdate("DUMMY-REFRESH-ALPHA")).thenReturn(refreshToken);
        when(clientService.validOAuthClientFromCache("client-alpha")).thenReturn(client("client-alpha"));
        when(accessTokenMapper.selectListByRefreshToken("DUMMY-REFRESH-ALPHA")).thenReturn(List.of());

        OAuth2AccessTokenDO issued = tokenService.refreshAccessToken("DUMMY-REFRESH-ALPHA", "client-alpha");

        assertThat(issued.getUserInfo()).as("会员信息暂不读取，必须为空映射").isEmpty();
        assertThat(issued.getUserId()).isEqualTo(6L);
        assertThat(issued.getRefreshToken()).isEqualTo("DUMMY-REFRESH-ALPHA");
        verify(accessTokenMapper).insert(issued);
        verify(adminUserService, never()).getUser(anyLong());
    }

    /** 刷新记录出现未知用户类型时必须明确失败，不能签发主体不明的令牌。 */
    @Test
    void refreshWithUnknownUserTypeFails() {
        injectDependencies();
        OAuth2RefreshTokenDO refreshToken = refreshToken(13L, 7L, "client-alpha", LocalDateTime.now().plusHours(1));
        refreshToken.setUserType(99);
        when(refreshTokenMapper.selectByRefreshToken("DUMMY-REFRESH-ALPHA")).thenReturn(refreshToken);
        when(refreshTokenMapper.selectByRefreshTokenForUpdate("DUMMY-REFRESH-ALPHA")).thenReturn(refreshToken);
        when(clientService.validOAuthClientFromCache("client-alpha")).thenReturn(client("client-alpha"));
        when(accessTokenMapper.selectListByRefreshToken("DUMMY-REFRESH-ALPHA")).thenReturn(List.of());

        assertThatThrownBy(() -> tokenService.refreshAccessToken("DUMMY-REFRESH-ALPHA", "client-alpha"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("未知用户类型：99");
        verify(accessTokenMapper, never()).insert(any(OAuth2AccessTokenDO.class));
    }

}
