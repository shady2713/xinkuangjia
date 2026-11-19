package com.basicframework.module.system.service.oauth2;

import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;

import java.util.List;

/**
 * OAuth2 授权服务接口。
 *
 * <p>向第三方开放客户端提供 {@code client_credentials} 客户端凭据授权能力。</p>
 *
 * @author 李杰
 */
public interface OAuth2GrantService {

    /**
     * 执行客户端凭据授权。
     * <p>
     * 对应 OAuth2 Client Credentials Grant，用于客户端自身授权。
     *
     * @param clientId 客户端标识
     * @param scopes   授权范围
     * @return 访问令牌
     */
    OAuth2AccessTokenDO grantClientCredentials(String clientId, List<String> scopes);

}
