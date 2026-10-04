package com.basicframework.module.system.api.oauth2;

import com.basicframework.framework.common.biz.system.oauth2.dto.OAuth2AccessTokenCheckRespDTO;
import com.basicframework.framework.common.biz.system.oauth2.dto.OAuth2AccessTokenCreateReqDTO;
import com.basicframework.framework.common.biz.system.oauth2.dto.OAuth2AccessTokenRespDTO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证令牌跨模块 API 只做契约转换：原样转发请求字段、原样映射返回字段。
 *
 * <p>该 API 是其它模块读写令牌的唯一入口。创建令牌时必须把请求里的用户、用户类型、
 * 客户端与授权范围完整传给令牌服务，否则签出的令牌会绑定到错误的身份或缺少授权范围；
 * 返回时必须保留访问令牌、刷新令牌、用户身份与过期时间，调用方才能完成续期与鉴权。
 * 令牌不存在时映射结果必须为 null，让调用方按“令牌无效”处理而不是拿到一个空令牌对象。</p>
 *
 * @author shady2713
 */
class OAuth2TokenApiImplTest {

    /** 被测 API 实现，令牌服务按外部边界替换为可观察替身。 */
    private OAuth2TokenApiImpl tokenApi;
    /** 记录调用参数的令牌服务替身。 */
    private OAuth2TokenService oauth2TokenService;

    /** 为每个用例创建独立 API 与令牌服务替身，避免用例之间共享调用记录。 */
    @BeforeEach
    void setUp() {
        tokenApi = new OAuth2TokenApiImpl();
        oauth2TokenService = mock(OAuth2TokenService.class);
        ReflectionTestUtils.setField(tokenApi, "oauth2TokenService", oauth2TokenService);
    }

    /** 创建令牌必须转发用户身份、客户端与授权范围，并映射出可用的返回字段。 */
    @Test
    void createAccessTokenForwardsRequestAndMapsResult() {
        OAuth2AccessTokenCreateReqDTO reqDTO = new OAuth2AccessTokenCreateReqDTO();
        reqDTO.setUserId(1024L);
        reqDTO.setUserType(2);
        reqDTO.setClientId("default");
        reqDTO.setScopes(List.of("user.read", "user.write"));
        LocalDateTime expiresTime = LocalDateTime.of(2026, 10, 3, 12, 0);
        when(oauth2TokenService.createAccessToken(1024L, 2, "default", List.of("user.read", "user.write")))
                .thenReturn(accessToken(1L, "access-1", "refresh-1", 1024L, 2, "default", expiresTime));

        OAuth2AccessTokenRespDTO result = tokenApi.createAccessToken(reqDTO);

        verify(oauth2TokenService).createAccessToken(1024L, 2, "default", List.of("user.read", "user.write"));
        assertThat(result.getAccessToken()).isEqualTo("access-1");
        assertThat(result.getRefreshToken()).isEqualTo("refresh-1");
        assertThat(result.getUserId()).isEqualTo(1024L);
        assertThat(result.getUserType()).isEqualTo(2);
        assertThat(result.getExpiresTime()).isEqualTo(expiresTime);
    }

    /** 移除令牌必须返回被移除的令牌信息，供调用方记录撤销结果。 */
    @Test
    void removeAccessTokenReturnsRemovedToken() {
        when(oauth2TokenService.removeAccessToken("access-1"))
                .thenReturn(accessToken(1L, "access-1", "refresh-1", 1024L, 2, "default", null));

        OAuth2AccessTokenRespDTO result = tokenApi.removeAccessToken("access-1");

        assertThat(result.getAccessToken()).isEqualTo("access-1");
        assertThat(result.getRefreshToken()).isEqualTo("refresh-1");
        assertThat(result.getUserId()).as("撤销结果保留原用户身份").isEqualTo(1024L);
    }

    /** 刷新令牌必须把刷新令牌与客户端一并转发，防止跨客户端刷新。 */
    @Test
    void refreshAccessTokenForwardsRefreshTokenAndClientId() {
        LocalDateTime expiresTime = LocalDateTime.of(2026, 10, 3, 13, 0);
        when(oauth2TokenService.refreshAccessToken("refresh-1", "default"))
                .thenReturn(accessToken(2L, "access-2", "refresh-2", 1024L, 2, "default", expiresTime));

        OAuth2AccessTokenRespDTO result = tokenApi.refreshAccessToken("refresh-1", "default");

        verify(oauth2TokenService).refreshAccessToken("refresh-1", "default");
        assertThat(result.getAccessToken()).isEqualTo("access-2");
        assertThat(result.getExpiresTime()).isEqualTo(expiresTime);
    }

    /** 校验令牌必须返回身份、客户端与授权范围，供鉴权与数据范围使用。 */
    @Test
    void checkAccessTokenMapsIdentityAndScopes() {
        OAuth2AccessTokenDO token = accessToken(1L, "access-1", "refresh-1", 1024L, 2, "default", null);
        token.setUserInfo(Map.of("nickname", "张三"));
        token.setScopes(List.of("user.read"));
        when(oauth2TokenService.checkAccessToken("access-1")).thenReturn(token);

        OAuth2AccessTokenCheckRespDTO result = tokenApi.checkAccessToken("access-1");

        assertThat(result.getUserId()).isEqualTo(1024L);
        assertThat(result.getUserType()).isEqualTo(2);
        assertThat(result.getClientId()).isEqualTo("default");
        assertThat(result.getScopes()).containsExactly("user.read");
        assertThat(result.getUserInfo()).containsEntry("nickname", "张三");
    }

    /** 令牌无效时校验结果必须为 null，调用方据此拒绝请求。 */
    @Test
    void checkAccessTokenMapsMissingTokenToNull() {
        when(oauth2TokenService.checkAccessToken("missing")).thenReturn(null);

        assertThat(tokenApi.checkAccessToken("missing")).isNull();
    }

    /** 服务层返回空令牌时必须映射为 null，调用方据此判为令牌无效。 */
    @Test
    void emptyTokenMapsToNull() {
        when(oauth2TokenService.removeAccessToken("missing")).thenReturn(null);
        when(oauth2TokenService.refreshAccessToken("missing", "default")).thenReturn(null);

        assertThat(tokenApi.removeAccessToken("missing")).isNull();
        assertThat(tokenApi.refreshAccessToken("missing", "default")).isNull();
    }

    /** 构造只填充本用例断言所需字段的访问令牌。 */
    private static OAuth2AccessTokenDO accessToken(Long id, String accessToken, String refreshToken,
                                                  Long userId, Integer userType, String clientId,
                                                  LocalDateTime expiresTime) {
        OAuth2AccessTokenDO token = new OAuth2AccessTokenDO();
        token.setId(id);
        token.setAccessToken(accessToken);
        token.setRefreshToken(refreshToken);
        token.setUserId(userId);
        token.setUserType(userType);
        token.setClientId(clientId);
        token.setExpiresTime(expiresTime);
        return token;
    }
}
