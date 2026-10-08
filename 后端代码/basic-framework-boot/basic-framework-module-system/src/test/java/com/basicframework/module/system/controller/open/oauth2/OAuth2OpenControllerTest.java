package com.basicframework.module.system.controller.open.oauth2;

import cn.hutool.core.codec.Base64;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.module.system.controller.open.oauth2.vo.OAuth2OpenTokenRespVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.enums.oauth2.OAuth2GrantTypeEnum;
import com.basicframework.module.system.enums.oauth2.OAuth2MachineToken;
import com.basicframework.module.system.service.oauth2.OAuth2ClientService;
import com.basicframework.module.system.service.oauth2.OAuth2GrantService;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;

import static com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants.BAD_REQUEST;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证开放令牌入口的凭据来源优先级、授权范围清洗与机器主体刷新令牌映射。
 *
 * <p>这是匿名可访问的签发入口，任何一处放宽都会直接变成凭据泄露：Basic 头与表单参数同时存在时若没有
 * 明确优先级，攻击者可以用一个合法账号的 Basic 头搭配另一个账号的密钥去试探；授权范围若不去重与清洗，
 * 第三方可以把任意范围写进令牌；机器主体在库内用哨兵值满足非空约束，若原样返回，第三方会把它当成
 * 真实凭据长期保存，而刷新入口必然拒绝它——这类"看起来可用、实际永远失败"的凭据最难排查。</p>
 *
 * <p>HTTP 请求与两个服务都按进程外边界替换为替身，入口内的取值优先级、授权范围拆分去重、刷新令牌
 * 映射与剩余有效期下限全部真实执行；断言核对真实错误码、响应四个字段，以及服务替身实际收到的
 * 客户编号与授权范围。</p>
 *
 * @author shady2713
 */
class OAuth2OpenControllerTest {

    /** 唯一允许的授权类型。 */
    private static final String CLIENT_CREDENTIALS = "client_credentials";

    /** 被测控制器。 */
    private OAuth2OpenController controller;
    /** 客户端校验服务替身。 */
    private OAuth2ClientService oauth2ClientService;
    /** 令牌签发服务替身。 */
    private OAuth2GrantService oauth2GrantService;
    /** HTTP 请求替身。 */
    private HttpServletRequest request;

    /**
     * 装配控制器与全部替身。
     */
    @BeforeEach
    void setUp() {
        controller = new OAuth2OpenController();
        oauth2ClientService = mock(OAuth2ClientService.class);
        oauth2GrantService = mock(OAuth2GrantService.class);
        request = mock(HttpServletRequest.class);
        ReflectionTestUtils.setField(controller, "oauth2ClientService", oauth2ClientService);
        ReflectionTestUtils.setField(controller, "oauth2GrantService", oauth2GrantService);
    }

    /**
     * 让请求替身返回带 Basic 认证头的凭据。
     *
     * @param clientId 客户端编号
     * @param clientSecret 客户端密钥
     */
    private void givenBasicAuth(String clientId, String clientSecret) {
        when(request.getHeader("Authorization"))
                .thenReturn("Basic " + Base64.encode(clientId + ":" + clientSecret));
    }

    /**
     * 让签发服务返回一条可用的访问令牌。
     *
     * @param expiresTime 过期时间
     * @param refreshToken 库内刷新令牌列值
     */
    private void givenIssuedToken(LocalDateTime expiresTime, String refreshToken) {
        OAuth2AccessTokenDO accessToken = new OAuth2AccessTokenDO();
        accessToken.setAccessToken("access-token-value");
        accessToken.setRefreshToken(refreshToken);
        accessToken.setExpiresTime(expiresTime);
        when(oauth2GrantService.grantClientCredentials(anyString(), anyList())).thenReturn(accessToken);
    }

    /** 正常签发时校验先于签发执行，响应带访问令牌、Bearer 方案、剩余秒数与授权范围。 */
    @Test
    void tokenValidatesBeforeIssuingAndReturnsBearerToken() {
        givenIssuedToken(LocalDateTime.now().plusSeconds(3600), OAuth2MachineToken.MACHINE_NO_REFRESH_TOKEN);

        CommonResult<OAuth2OpenTokenRespVO> result = controller.token(
                CLIENT_CREDENTIALS, "client-1", "secret-1", "sms:send user:read", request);

        assertThat(result.getCode()).isEqualTo(0);
        assertThat(result.getData().accessToken()).isEqualTo("access-token-value");
        assertThat(result.getData().tokenType()).isEqualTo("Bearer");
        assertThat(result.getData().expiresIn()).isBetween(3500L, 3600L);
        assertThat(result.getData().scope()).isEqualTo("sms:send user:read");
        org.mockito.InOrder inOrder = inOrder(oauth2ClientService, oauth2GrantService);
        inOrder.verify(oauth2ClientService).validOAuthClientFromCache(
                eq("client-1"), eq("secret-1"), eq(CLIENT_CREDENTIALS), eq(Arrays.asList("sms:send", "user:read")), eq(null));
        inOrder.verify(oauth2GrantService).grantClientCredentials(eq("client-1"), eq(Arrays.asList("sms:send", "user:read")));
    }

    /** Basic 认证头优先于表单参数，表单里伪造的凭据不能覆盖认证头。 */
    @Test
    void tokenPrefersBasicAuthorizationHeaderOverFormParams() {
        givenBasicAuth("header-client", "header-secret");
        givenIssuedToken(LocalDateTime.now().plusSeconds(60), OAuth2MachineToken.MACHINE_NO_REFRESH_TOKEN);

        controller.token(CLIENT_CREDENTIALS, "form-client", "form-secret", "sms:send", request);

        verify(oauth2ClientService).validOAuthClientFromCache(
                eq("header-client"), eq("header-secret"), eq(CLIENT_CREDENTIALS), eq(List.of("sms:send")), eq(null));
        verify(oauth2GrantService).grantClientCredentials(eq("header-client"), eq(List.of("sms:send")));
    }

    /** 授权范围按空白拆分、去重并保持申请顺序。 */
    @Test
    void tokenSplitsTrimsAndDedupesScopes() {
        givenIssuedToken(LocalDateTime.now().plusSeconds(60), OAuth2MachineToken.MACHINE_NO_REFRESH_TOKEN);

        CommonResult<OAuth2OpenTokenRespVO> result = controller.token(
                CLIENT_CREDENTIALS, "client-1", "secret-1", "  sms:send   user:read  sms:send  ", request);

        ArgumentCaptor<List<String>> captor = ArgumentCaptor.forClass(List.class);
        verify(oauth2GrantService).grantClientCredentials(eq("client-1"), captor.capture());
        assertThat(captor.getValue()).containsExactly("sms:send", "user:read");
        assertThat(result.getData().scope()).isEqualTo("sms:send user:read");
    }

    /** 机器主体的哨兵刷新令牌不得原样返回，必须映射为空。 */
    @Test
    void tokenMapsMachineSentinelRefreshTokenToNull() {
        givenIssuedToken(LocalDateTime.now().plusSeconds(60), OAuth2MachineToken.MACHINE_NO_REFRESH_TOKEN);

        CommonResult<OAuth2OpenTokenRespVO> result = controller.token(
                CLIENT_CREDENTIALS, "client-1", "secret-1", "sms:send", request);

        assertThat(result.getData().refreshToken()).isNull();
        assertThat(result.getData().accessToken()).isEqualTo("access-token-value");
        assertThat(result.getData().refreshToken()).isNotEqualTo(OAuth2MachineToken.MACHINE_NO_REFRESH_TOKEN);
    }

    /** 非哨兵刷新令牌原样透传，不做无依据的抹除。 */
    @Test
    void tokenKeepsRealRefreshToken() {
        givenIssuedToken(LocalDateTime.now().plusSeconds(60), "real-refresh-token");

        CommonResult<OAuth2OpenTokenRespVO> result = controller.token(
                CLIENT_CREDENTIALS, "client-1", "secret-1", "sms:send", request);

        assertThat(result.getData().refreshToken()).isEqualTo("real-refresh-token");
        assertThat(result.getData().expiresIn()).isPositive();
    }

    /** 令牌已过期时剩余秒数下限为 0，不返回负数让调用方算出荒谬的续期时间。 */
    @Test
    void tokenClampsExpiredTokenExpiresInToZero() {
        givenIssuedToken(LocalDateTime.now().minusSeconds(30), OAuth2MachineToken.MACHINE_NO_REFRESH_TOKEN);

        CommonResult<OAuth2OpenTokenRespVO> result = controller.token(
                CLIENT_CREDENTIALS, "client-1", "secret-1", "sms:send", request);

        assertThat(result.getData().expiresIn()).isZero();
        assertThat(result.getData().accessToken()).isEqualTo("access-token-value");
    }

    /** 授权类型不是客户端凭据时拒绝，不校验凭据也不签发令牌。 */
    @Test
    void tokenRejectsUnsupportedGrantType() {
        assertThatThrownBy(() -> controller.token(
                "password", "client-1", "secret-1", "sms:send", request))
                .isInstanceOf(ServiceException.class)
                .hasMessageContaining("grant_type 仅支持 client_credentials")
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(BAD_REQUEST.getCode());
        verifyNoInteractions(oauth2ClientService);
        verifyNoInteractions(oauth2GrantService);
    }

    /** 授权类型为空串同样不是客户端凭据，按参数错误拒绝。 */
    @Test
    void tokenRejectsBlankGrantType() {
        assertThatThrownBy(() -> controller.token("", "client-1", "secret-1", "sms:send", request))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(OAuth2GrantTypeEnum.CLIENT_CREDENTIALS.getGrantType()).isEqualTo(CLIENT_CREDENTIALS);
        verifyNoInteractions(oauth2GrantService);
    }

    /** 缺少客户端编号时拒绝签发，匿名请求不能拿到任何令牌。 */
    @Test
    void tokenRejectsBlankClientId() {
        assertThatThrownBy(() -> controller.token(CLIENT_CREDENTIALS, " ", "secret-1", "sms:send", request))
                .isInstanceOf(ServiceException.class)
                .hasMessageContaining("client_id 和 client_secret 不能为空")
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(BAD_REQUEST.getCode());
        verifyNoInteractions(oauth2GrantService);
    }

    /** 缺少客户端密钥时同样拒绝，不做半签发。 */
    @Test
    void tokenRejectsBlankClientSecret() {
        assertThatThrownBy(() -> controller.token(CLIENT_CREDENTIALS, "client-1", null, "sms:send", request))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(BAD_REQUEST.getCode());
        verifyNoInteractions(oauth2ClientService);
        verifyNoInteractions(oauth2GrantService);
    }

    /** 授权范围为空时拒绝，不签发"无范围"的令牌。 */
    @Test
    void tokenRejectsBlankScope() {
        assertThatThrownBy(() -> controller.token(CLIENT_CREDENTIALS, "client-1", "secret-1", "   ", request))
                .isInstanceOf(ServiceException.class)
                .hasMessageContaining("scope 不能为空")
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(BAD_REQUEST.getCode());
        verifyNoInteractions(oauth2ClientService);
        verifyNoInteractions(oauth2GrantService);
    }

    /** 客户端校验失败时异常原样上抛，不进入签发环节。 */
    @Test
    void tokenPropagatesClientValidationFailure() {
        when(oauth2ClientService.validOAuthClientFromCache(
                anyString(), anyString(), anyString(), anyList(), any()))
                .thenThrow(new ServiceException(100_200_001, "客户端密钥错误"));

        assertThatThrownBy(() -> controller.token(CLIENT_CREDENTIALS, "client-1", "wrong", "sms:send", request))
                .isInstanceOf(ServiceException.class)
                .hasMessageContaining("客户端密钥错误");
        verify(oauth2GrantService, never()).grantClientCredentials(anyString(), anyList());
    }

    /** 请求参数与 Basic 头都为空时按缺少凭据处理，不允许匿名签发。 */
    @Test
    void tokenRejectsAnonymousRequest() {
        assertThatThrownBy(() -> controller.token(CLIENT_CREDENTIALS, null, null, "sms:send", request))
                .isInstanceOf(ServiceException.class)
                .hasMessageContaining("client_id 和 client_secret 不能为空");
        verify(request).getHeader("Authorization");
        verifyNoInteractions(oauth2GrantService);
    }
}