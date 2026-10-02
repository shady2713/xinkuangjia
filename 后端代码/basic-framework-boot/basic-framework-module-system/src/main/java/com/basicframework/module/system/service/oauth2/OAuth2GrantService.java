package com.basicframework.module.system.service.oauth2;

import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;

import java.util.List;

/**
 * OAuth2 授权服务接口。
 * <p>
 * 提供隐式授权、密码授权、刷新令牌、客户端凭据和令牌撤销能力。
 *
 * @author 李杰
 */
public interface OAuth2GrantService {

    /**
     * 执行隐式授权。
     * <p>
     * 对应 OAuth2 Implicit Grant，基于已登录用户直接签发访问令牌。
     *
     * @param userId   用户编号
     * @param userType 用户类型
     * @param clientId 客户端标识
     * @param scopes   授权范围
     * @return 访问令牌
     */
    OAuth2AccessTokenDO grantImplicit(Long userId, Integer userType,
                                      String clientId, List<String> scopes);

    /**
     * 执行密码授权。
     * <p>
     * 对应 OAuth2 Resource Owner Password Credentials Grant。
     *
     * @param username 用户账号
     * @param password 用户密码
     * @param clientId 客户端标识
     * @param scopes   授权范围
     * @return 访问令牌
     */
    OAuth2AccessTokenDO grantPassword(String username, String password,
                                      String clientId, List<String> scopes);

    /**
     * 使用刷新令牌重新签发访问令牌。
     *
     * @param refreshToken 刷新令牌
     * @param clientId     客户端标识
     * @return 新访问令牌
     */
    OAuth2AccessTokenDO grantRefreshToken(String refreshToken, String clientId);

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

    /**
     * 撤销访问令牌。
     *
     * @param clientId    客户端标识
     * @param accessToken 访问令牌
     * @return 是否撤销成功
     */
    boolean revokeToken(String clientId, String accessToken);

}
