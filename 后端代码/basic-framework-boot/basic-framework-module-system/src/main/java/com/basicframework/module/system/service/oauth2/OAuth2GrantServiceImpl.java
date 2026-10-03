package com.basicframework.module.system.service.oauth2;

import cn.hutool.core.lang.Assert;
import cn.hutool.core.util.ObjectUtil;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.service.auth.AdminAuthService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import jakarta.annotation.Resource;
import java.util.List;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.module.system.enums.ErrorCodeConstants.*;

/**
 * OAuth2 授予 Service 实现类
 *
 * @author 李杰
 */
@Service
public class OAuth2GrantServiceImpl implements OAuth2GrantService {

    @Resource
    private OAuth2TokenService oauth2TokenService;
    @Resource
    private AdminAuthService adminAuthService;

    /**
     * 处理隐式授权并签发访问令牌。
     *
     * @param userId 用户编号
     * @param userType userType 参数
     * @param clientId 第三方客户端编号
     * @param scopes scopes 数据集合
     * @return 方法处理结果
     */
    @Override
    public OAuth2AccessTokenDO grantImplicit(Long userId, Integer userType,
                                             String clientId, List<String> scopes) {
        return oauth2TokenService.createAccessToken(userId, userType, clientId, scopes);
    }

    /**
     * 校验账号密码并签发访问令牌。
     *
     * @param username username 参数
     * @param password password 参数
     * @param clientId 第三方客户端编号
     * @param scopes scopes 数据集合
     * @return 方法处理结果
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public OAuth2AccessTokenDO grantPassword(String username, String password,
                                             String clientId, List<String> scopes) {
        // 使用账号 + 密码进行登录
        AdminUserDO user = adminAuthService.authenticate(username, password);
        Assert.notNull(user, "用户不能为空！");
        // 创建访问令牌
        return oauth2TokenService.createAccessToken(user.getId(), UserTypeEnum.ADMIN.getValue(), clientId, scopes);
    }

    /**
     * 校验刷新令牌并签发新的访问令牌。
     *
     * @param refreshToken refreshToken 参数
     * @param clientId 第三方客户端编号
     * @return 方法处理结果
     */
    @Override
    public OAuth2AccessTokenDO grantRefreshToken(String refreshToken, String clientId) {
        OAuth2AccessTokenDO accessTokenDO = oauth2TokenService.refreshAccessToken(refreshToken, clientId);
        if (accessTokenDO == null || ObjectUtil.notEqual(accessTokenDO.getClientId(), clientId)) {
            throw exception(OAUTH2_GRANT_REFRESH_TOKEN_INVALID);
        }
        return accessTokenDO;
    }

    /**
     * 处理客户端凭据授权并签发访问令牌。
     *
     * @param clientId 第三方客户端编号
     * @param scopes scopes 数据集合
     * @return 方法处理结果
     */
    @Override
    public OAuth2AccessTokenDO grantClientCredentials(String clientId, List<String> scopes) {
        // 客户端模式没有真实登录用户；使用 0 作为系统占位用户，兼容 token 表 user_id 非空约束。
        return oauth2TokenService.createAccessToken(0L, UserTypeEnum.ADMIN.getValue(), clientId, scopes);
    }

    /**
     * 撤销指定访问令牌及其关联授权。
     *
     * @param clientId 第三方客户端编号
     * @param accessToken accessToken 参数
     * @return 业务条件成立时返回 true，否则返回 false
     */
    @Override
    public boolean revokeToken(String clientId, String accessToken) {
        // 先查询，保证 clientId 时匹配的
        OAuth2AccessTokenDO accessTokenDO = oauth2TokenService.getAccessToken(accessToken);
        if (accessTokenDO == null || ObjectUtil.notEqual(clientId, accessTokenDO.getClientId())) {
            return false;
        }
        // 再删除
        return oauth2TokenService.removeAccessToken(accessToken) != null;
    }

}
