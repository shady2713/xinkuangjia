package com.basicframework.module.system.controller.admin.oauth2;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.oauth2.vo.token.OAuth2AccessTokenPageReqVO;
import com.basicframework.module.system.controller.admin.oauth2.vo.token.OAuth2AccessTokenRespVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.enums.logger.LoginLogTypeEnum;
import com.basicframework.module.system.service.auth.AdminAuthService;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证 OAuth2 令牌管理入口的分页映射与撤销委派契约。
 *
 * <p>令牌分页只返回有效期内的令牌，字段裁剪与转换必须完整（客户端编号、用户、过期时间），
 * 否则运营无法判断会话归属。撤销入口必须按“删除令牌”这一登录日志类型调用认证服务：
 * 类型写错会把强制下线记成普通退出，审计口径失真；批量撤销必须逐个撤销而不是只处理第一个，
 * 空列表则不得产生任何副作用。</p>
 *
 * @author shady2713
 */
class OAuth2TokenControllerTest {

    /** 被测控制器。 */
    private final OAuth2TokenController controller = new OAuth2TokenController();

    /** 令牌服务替身。 */
    private final OAuth2TokenService tokenService = mock(OAuth2TokenService.class);
    /** 认证服务替身，用于观察退出副作用。 */
    private final AdminAuthService authService = mock(AdminAuthService.class);

    /** 分页入口把 DO 分页完整映射为响应分页，并把请求原样交给服务。 */
    @Test
    void accessTokenPageMapsFieldsAndDelegates() {
        injectDependencies();
        OAuth2AccessTokenPageReqVO reqVO = new OAuth2AccessTokenPageReqVO();
        reqVO.setUserId(5L);
        reqVO.setClientId("client-alpha");
        when(tokenService.getAccessTokenPage(reqVO)).thenReturn(new PageResult<>(
                List.of(accessToken("DUMMY-ACCESS-ALPHA", 5L, LocalDateTime.of(2026, 1, 2, 3, 4, 5))), 1L));

        CommonResult<PageResult<OAuth2AccessTokenRespVO>> result = controller.getAccessTokenPage(reqVO);

        assertThat(result.getCode()).isZero();
        assertThat(result.getData().getTotal()).isEqualTo(1L);
        OAuth2AccessTokenRespVO row = result.getData().getList().get(0);
        assertThat(row.getAccessToken()).isEqualTo("DUMMY-ACCESS-ALPHA");
        assertThat(row.getClientId()).isEqualTo("client-alpha");
        assertThat(row.getUserId()).isEqualTo(5L);
        assertThat(row.getExpiresTime()).isEqualTo(LocalDateTime.of(2026, 1, 2, 3, 4, 5));
        verify(tokenService).getAccessTokenPage(reqVO);
    }

    /** 单个撤销必须按“删除令牌”类型记录退出，并返回成功。 */
    @Test
    void deleteAccessTokenLogsOutWithDeleteType() {
        injectDependencies();

        CommonResult<Boolean> result = controller.deleteAccessToken("DUMMY-ACCESS-ALPHA");

        assertThat(result.getData()).isTrue();
        verify(authService).logout("DUMMY-ACCESS-ALPHA", LoginLogTypeEnum.LOGOUT_DELETE.getType());
    }

    /** 批量撤销必须逐个处理每个令牌，不得只撤销第一个。 */
    @Test
    void deleteAccessTokenListLogsOutEveryToken() {
        injectDependencies();

        CommonResult<Boolean> result = controller.deleteAccessTokenList(
                List.of("DUMMY-ACCESS-ALPHA", "DUMMY-ACCESS-BETA"));

        assertThat(result.getData()).isTrue();
        verify(authService).logout("DUMMY-ACCESS-ALPHA", LoginLogTypeEnum.LOGOUT_DELETE.getType());
        verify(authService).logout("DUMMY-ACCESS-BETA", LoginLogTypeEnum.LOGOUT_DELETE.getType());
        verify(authService, times(2)).logout(anyString(),
                anyInt());
    }

    /** 空列表批量撤销必须直接成功且不调用认证服务。 */
    @Test
    void deleteEmptyAccessTokenListHasNoSideEffect() {
        injectDependencies();

        assertThat(controller.deleteAccessTokenList(List.of()).getData()).isTrue();
        verify(authService, never()).logout(anyString(),
                anyInt());
    }

    /** 注入服务替身，保证控制器只访问受控边界。 */
    private void injectDependencies() {
        ReflectionTestUtils.setField(controller, "oauth2TokenService", tokenService);
        ReflectionTestUtils.setField(controller, "authService", authService);
    }

    /**
     * 构造访问令牌记录。
     *
     * @param accessToken 访问令牌
     * @param userId 用户编号
     * @param expiresTime 过期时间
     * @return 访问令牌记录
     */
    private static OAuth2AccessTokenDO accessToken(String accessToken, Long userId, LocalDateTime expiresTime) {
        OAuth2AccessTokenDO token = new OAuth2AccessTokenDO();
        token.setAccessToken(accessToken);
        token.setRefreshToken("DUMMY-REFRESH-ALPHA");
        token.setUserId(userId);
        token.setUserType(1);
        token.setClientId("client-alpha");
        token.setScopes(List.of("user.read"));
        token.setExpiresTime(expiresTime);
        return token;
    }

}
