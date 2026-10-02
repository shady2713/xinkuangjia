package com.basicframework.module.system.dal.mysql.oauth2;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;

import com.basicframework.module.system.controller.admin.oauth2.vo.token.OAuth2AccessTokenPageReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import org.apache.ibatis.annotations.Mapper;

import java.time.LocalDateTime;
import java.util.List;

/**
 * OAuth2AccessTokenMapper 数据访问接口，负责持久化查询与写入。
 *
 * @author 李杰
 */
@Mapper
public interface OAuth2AccessTokenMapper extends BaseMapperX<OAuth2AccessTokenDO> {

    /**
     * 查询By访问令牌。
     *
     * @param accessToken 访问令牌参数
     * @return 查询结果
     */
    default OAuth2AccessTokenDO selectByAccessToken(String accessToken) {
        return selectOne(OAuth2AccessTokenDO::getAccessToken, accessToken);
    }

    /**
     * 查询列表By刷新令牌。
     *
     * @param refreshToken 刷新令牌参数
     * @return 查询结果
     */
    default List<OAuth2AccessTokenDO> selectListByRefreshToken(String refreshToken) {
        return selectList(OAuth2AccessTokenDO::getRefreshToken, refreshToken);
    }

    /**
     * 查询分页数据。
     *
     * @param reqVO 请求参数
     * @return 查询结果
     */
    default PageResult<OAuth2AccessTokenDO> selectPage(OAuth2AccessTokenPageReqVO reqVO) {
        return selectPage(reqVO, new LambdaQueryWrapperX<OAuth2AccessTokenDO>()
                .eqIfPresent(OAuth2AccessTokenDO::getUserId, reqVO.getUserId())
                .eqIfPresent(OAuth2AccessTokenDO::getUserType, reqVO.getUserType())
                .likeIfPresent(OAuth2AccessTokenDO::getClientId, reqVO.getClientId())
                .gt(OAuth2AccessTokenDO::getExpiresTime, LocalDateTime.now())
                .orderByDesc(OAuth2AccessTokenDO::getId));
    }

    /**
     * 查询列表By用户编号And用户类型。
     *
     * @param userId 用户编号
     * @param userType 用户类型参数
     * @return 查询结果
     */
    default List<OAuth2AccessTokenDO> selectListByUserIdAndUserType(Long userId, Integer userType) {
        return selectList(OAuth2AccessTokenDO::getUserId, userId,
                OAuth2AccessTokenDO::getUserType, userType);
    }

}
