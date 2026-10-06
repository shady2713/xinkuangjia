package com.basicframework.module.system.api.oauth2;

import com.basicframework.framework.common.biz.system.oauth2.OAuth2TokenCommonApi;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.common.biz.system.oauth2.dto.OAuth2AccessTokenCheckRespDTO;
import com.basicframework.framework.common.biz.system.oauth2.dto.OAuth2AccessTokenCreateReqDTO;
import com.basicframework.framework.common.biz.system.oauth2.dto.OAuth2AccessTokenRespDTO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import org.springframework.stereotype.Service;

import jakarta.annotation.Resource;

/**
 * OAuth2.0 Token API 实现类
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@Service
public class OAuth2TokenApiImpl implements OAuth2TokenCommonApi {

    @Resource
    private OAuth2TokenService oauth2TokenService;

    /**
     * 创建访问令牌。
     *
     * @param reqDTO reqDTO 参数
     * @return 操作结果
     */
    @Override
    public OAuth2AccessTokenRespDTO createAccessToken(OAuth2AccessTokenCreateReqDTO reqDTO) {
        OAuth2AccessTokenDO accessTokenDO = oauth2TokenService.createAccessToken(
                reqDTO.getUserId(), reqDTO.getUserType(), reqDTO.getClientId(), reqDTO.getScopes());
        return BeanUtils.toBean(accessTokenDO, OAuth2AccessTokenRespDTO.class);
    }

    /**
     * 检查访问令牌。
     *
     * @param accessToken accessToken 参数
     * @return 方法处理结果
     */
    @Override
    public OAuth2AccessTokenCheckRespDTO checkAccessToken(String accessToken) {
        OAuth2AccessTokenDO accessTokenDO = oauth2TokenService.checkAccessToken(accessToken);
        return BeanUtils.toBean(accessTokenDO, OAuth2AccessTokenCheckRespDTO.class);
    }

    /**
     * 移除访问令牌。
     *
     * @param accessToken accessToken 参数
     * @return 操作结果
     */
    @Override
    public OAuth2AccessTokenRespDTO removeAccessToken(String accessToken) {
        OAuth2AccessTokenDO accessTokenDO = oauth2TokenService.removeAccessToken(accessToken);
        return BeanUtils.toBean(accessTokenDO, OAuth2AccessTokenRespDTO.class);
    }

    /**
     * 刷新访问令牌。
     *
     * @param refreshToken refreshToken 参数
     * @param clientId 第三方客户端编号
     * @return 操作结果
     */
    @Override
    public OAuth2AccessTokenRespDTO refreshAccessToken(String refreshToken, String clientId) {
        OAuth2AccessTokenDO accessTokenDO = oauth2TokenService.refreshAccessToken(refreshToken, clientId);
        return BeanUtils.toBean(accessTokenDO, OAuth2AccessTokenRespDTO.class);
    }

}
