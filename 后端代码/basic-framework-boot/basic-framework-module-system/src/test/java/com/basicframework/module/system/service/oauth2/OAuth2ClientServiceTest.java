package com.basicframework.module.system.service.oauth2;

import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2ClientDO;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.CALLS_REAL_METHODS;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证客户端服务无参校验重载与带参校验之间的委托契约。
 *
 * <p>无参重载表达的语义是"只校验客户端本身，不校验授权参数"，它把四个空值传给带参校验：密钥为空表示
 * 不校验密钥、授权方式为空表示不限授权方式、范围为空表示不限范围、回调地址为空表示不校验回调。这个
 * 委托关系是授权入口的安全边界——默认值若不再是全空，调用方会意外触发本来不需要的校验并拒绝合法
 * 客户端；反过来，如果这里少传一个实参，就等于在调用方不知情的情况下放弃了该项校验。</p>
 *
 * <p>本用例只验证接口默认方法自身的委托契约，不涉及具体实现：替身保留默认方法的真实执行、只桩化带参
 * 校验，于是既能看到默认方法真实调用带参校验，也能核对它下传的实参。</p>
 *
 * @author shady2713
 */
class OAuth2ClientServiceTest {

    /**
     * 构造一个执行真实默认方法、只桩化带参校验的服务替身。
     *
     * @return 服务替身
     */
    private static OAuth2ClientService clientServiceWithRealDefaults() {
        return mock(OAuth2ClientService.class, CALLS_REAL_METHODS);
    }

    /** 无参重载以四个空值下传授权参数，语义是"只校验客户端本身"。 */
    @Test
    void validOAuthClientFromCacheForwardsEmptyAuthorizationParameters() {
        OAuth2ClientService clientService = clientServiceWithRealDefaults();

        clientService.validOAuthClientFromCache("client-1");

        verify(clientService).validOAuthClientFromCache("client-1", null, null, null, null);
    }

    /** 带参校验的结果原样由无参重载返回，调用方拿到的是同一个客户端实例。 */
    @Test
    void validOAuthClientFromCacheReturnsDelegatedClient() {
        OAuth2ClientService clientService = clientServiceWithRealDefaults();
        OAuth2ClientDO expected = new OAuth2ClientDO();
        when(clientService.validOAuthClientFromCache("client-1", null, null, null, null)).thenReturn(expected);

        OAuth2ClientDO result = clientService.validOAuthClientFromCache("client-1");

        assertThat(result).isSameAs(expected);
        verify(clientService).validOAuthClientFromCache("client-1", null, null, null, null);
    }

    /** 默认重载不吞掉校验失败：带参校验抛出的异常原样上抛，调用方仍能拒绝该客户端。 */
    @Test
    void validOAuthClientFromCachePropagatesValidationFailure() {
        OAuth2ClientService clientService = clientServiceWithRealDefaults();
        when(clientService.validOAuthClientFromCache(anyString(), any(), any(), any(), any()))
                .thenThrow(new IllegalStateException("客户端密钥错误"));

        assertThatThrownBy(() -> clientService.validOAuthClientFromCache("client-1"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("客户端密钥错误");
        assertThatThrownBy(() -> clientService.validOAuthClientFromCache("client-2"))
                .isInstanceOf(IllegalStateException.class);
    }

    /** 显式带参校验保留调用方传入的实参，默认重载不参与改写。 */
    @Test
    void explicitValidationKeepsCallerSuppliedParameters() {
        OAuth2ClientService clientService = clientServiceWithRealDefaults();
        OAuth2ClientDO expected = new OAuth2ClientDO();
        when(clientService.validOAuthClientFromCache("client-1", "secret-1", "client_credentials", List.of("sms:send"), null))
                .thenReturn(expected);

        OAuth2ClientDO result = clientService.validOAuthClientFromCache(
                "client-1", "secret-1", "client_credentials", List.of("sms:send"), null);

        assertThat(result).isSameAs(expected);
        assertThat(clientService.validOAuthClientFromCache("client-2")).isNull();
    }
}