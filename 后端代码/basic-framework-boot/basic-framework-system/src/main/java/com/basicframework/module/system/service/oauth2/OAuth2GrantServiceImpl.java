package com.basicframework.module.system.service.oauth2;

import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * OAuth2 授予 Service 实现类（当前仅保留 {@code client_credentials} 客户端凭据模式）。
 *
 * @author shady
 */
@Service
public class OAuth2GrantServiceImpl implements OAuth2GrantService {

    @Resource
    private OAuth2TokenService oauth2TokenService;

    /**
     * 处理客户端凭据授权并签发访问令牌。
     *
     * @param clientId 第三方客户端编号
     * @param scopes   授权范围集合
     * @return 客户端凭据访问令牌
     */
    @Override
    public OAuth2AccessTokenDO grantClientCredentials(String clientId, List<String> scopes) {
        // 客户端凭据模式无真实后台用户且不签发刷新令牌，避免持有者冒充管理端身份。
        return oauth2TokenService.createClientAccessToken(clientId, scopes);
    }

}
