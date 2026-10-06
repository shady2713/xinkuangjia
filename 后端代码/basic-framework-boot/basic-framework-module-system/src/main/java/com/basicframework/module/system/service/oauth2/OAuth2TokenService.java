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
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
public interface OAuth2TokenService {

    /**
     * 创建访问令牌。
     * <p>
     * 创建访问令牌时会同步创建刷新令牌。本方法是可信内部签发能力，不能直接公开为 HTTP 接口。
     * 调用方必须在同一事务内完成身份验证；真实管理员签发与改密共用用户行锁。
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
     * 从数据库权威会话记录获取访问令牌，不接受缓存残留作为身份依据。
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
     * 在同一事务内撤销指定用户全部访问和刷新会话，包括孤立刷新令牌。
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
