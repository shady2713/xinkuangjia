package com.basicframework.module.system.enums.oauth2;

import cn.hutool.core.util.ArrayUtil;
import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * OAuth2 授权类型的枚举
 *
 * @author 李杰
 */
@AllArgsConstructor
@Getter
public enum OAuth2GrantTypeEnum {

    /** 密码模式 */
    PASSWORD("password"),
    /** 授权码模式 */
    AUTHORIZATION_CODE("authorization_code"),
    /** 简化模式 */
    IMPLICIT("implicit"),
    /** 客户端模式 */
    CLIENT_CREDENTIALS("client_credentials"),
    /** 刷新模式 */
    REFRESH_TOKEN("refresh_token"),
    ;

    private final String grantType;

    /**
     * 获取ByGrant类型。
     *
     * @param grantType grant类型参数
     * @return 查询结果
     */
    public static OAuth2GrantTypeEnum getByGrantType(String grantType) {
        return ArrayUtil.firstMatch(o -> o.getGrantType().equals(grantType), values());
    }

}
