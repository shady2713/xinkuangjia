package com.basicframework.module.system.service.oauth2;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.oauth2.vo.token.OAuth2AccessTokenPageReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;

import java.util.List;

/**
 * OAuth2 令牌服务接口。
 * <p>
 * 提供访问令牌、刷新令牌的签发、校验、刷新、撤销和分页查询能力。
 *
 * @author 李杰
 */
public interface OAuth2TokenService {

    /**
     * 创建访问令牌。
     * <p>
     * 创建访问令牌时会同步创建刷新令牌。
     *
     * @param userId   用户编号
     * @param userType 用户类型
     * @param clientId 客户端标识
     * @param scopes   授权范围
     * @return 访问令牌信息
     */
    OAuth2AccessTokenDO createAccessToken(Long userId, Integer userType, String clientId, List<String> scopes);

    /**
     * 使用刷新令牌换取新的访问令牌。
     *
     * @param refreshToken 刷新令牌
     * @param clientId     客户端标识
     * @return 新访问令牌信息
     */
    OAuth2AccessTokenDO refreshAccessToken(String refreshToken, String clientId);

    /**
     * 获取访问令牌。
     *
     * @param accessToken 访问令牌
     * @return 访问令牌信息
     */
    OAuth2AccessTokenDO getAccessToken(String accessToken);

    /**
     * 校验访问令牌是否有效。
     *
     * @param accessToken 访问令牌
     * @return 有效访问令牌信息
     */
    OAuth2AccessTokenDO checkAccessToken(String accessToken);

    /**
     * 移除访问令牌并同步移除关联刷新令牌。
     *
     * @param accessToken 访问令牌
     * @return 被移除的访问令牌信息
     */
    OAuth2AccessTokenDO removeAccessToken(String accessToken);

    /**
     * 移除指定用户的访问令牌和关联刷新令牌。
     *
     * @param userId   用户编号
     * @param userType 用户类型
     */
    void removeAccessToken(Long userId, Integer userType);

    /**
     * 分页查询访问令牌。
     *
     * @param reqVO 查询参数
     * @return 访问令牌分页结果
     */
    PageResult<OAuth2AccessTokenDO> getAccessTokenPage(OAuth2AccessTokenPageReqVO reqVO);

}
