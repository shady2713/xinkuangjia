package com.basicframework.module.system.enums.oauth2;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 OAuth2 授权类型枚举的编码与反查契约。
 *
 * <p>授权类型字符串是 OAuth2 客户端配置与令牌签发协议的一部分：编码漂移会让已授权的客户端
 * 无法再换取令牌；反查用于校验客户端提交的 grant_type，未登记类型必须返回 null
 * 让调用方按参数错误处理，而不是静默放行。</p>
 *
 * @author shady2713
 */
class OAuth2GrantTypeEnumTest {

    /** 授权类型字符串必须与 OAuth2 协议及数据库既有取值一致。 */
    @Test
    void grantTypesAreStable() {
        assertThat(OAuth2GrantTypeEnum.PASSWORD.getGrantType()).isEqualTo("password");
        assertThat(OAuth2GrantTypeEnum.AUTHORIZATION_CODE.getGrantType()).isEqualTo("authorization_code");
        assertThat(OAuth2GrantTypeEnum.IMPLICIT.getGrantType()).isEqualTo("implicit");
        assertThat(OAuth2GrantTypeEnum.CLIENT_CREDENTIALS.getGrantType()).isEqualTo("client_credentials");
        assertThat(OAuth2GrantTypeEnum.REFRESH_TOKEN.getGrantType()).isEqualTo("refresh_token");

        assertThat(OAuth2GrantTypeEnum.values()).extracting(OAuth2GrantTypeEnum::getGrantType).doesNotHaveDuplicates();
    }

    /** 已登记的授权类型必须能反查到枚举，未登记与 null 返回 null。 */
    @Test
    void getByGrantTypeMatchesDeclaredTypesOnly() {
        assertThat(OAuth2GrantTypeEnum.getByGrantType("client_credentials"))
                .isSameAs(OAuth2GrantTypeEnum.CLIENT_CREDENTIALS);
        assertThat(OAuth2GrantTypeEnum.getByGrantType("refresh_token"))
                .isSameAs(OAuth2GrantTypeEnum.REFRESH_TOKEN);
        assertThat(OAuth2GrantTypeEnum.getByGrantType("client-credentials")).isNull();
        assertThat(OAuth2GrantTypeEnum.getByGrantType(null)).isNull();
    }

}
