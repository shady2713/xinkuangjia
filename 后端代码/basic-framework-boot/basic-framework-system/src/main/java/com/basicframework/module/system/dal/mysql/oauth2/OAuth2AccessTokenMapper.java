package com.basicframework.module.system.dal.mysql.oauth2;

import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;

import com.basicframework.module.system.controller.admin.oauth2.vo.token.OAuth2AccessTokenPageReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import org.apache.ibatis.annotations.Mapper;

import java.time.LocalDateTime;
import java.util.List;

/**
 * OAuth2AccessTokenMapper 数据访问接口，负责持久化查询与写入。
 *
 * @author shady
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
     * 按调用者管理平台分页查询有效的后台访问令牌，并在数据库端关联 {@code system_users} 执行平台隔离与数据权限过滤。
     *
     * @param reqVO 分页条件
     * @param operatorPlatformType 操作者所属管理平台类型
     * @return 过滤后的有效在线令牌分页
     */
    default PageResult<OAuth2AccessTokenDO> selectPageByPlatform(OAuth2AccessTokenPageReqVO reqVO,
                                                               String operatorPlatformType) {
        String normalizedPlatform = AdminPlatformTypeEnum.defaultType(operatorPlatformType);
        LambdaQueryWrapperX<OAuth2AccessTokenDO> query = new LambdaQueryWrapperX<OAuth2AccessTokenDO>()
                .eqIfPresent(OAuth2AccessTokenDO::getUserId, reqVO.getUserId())
                // 管理员在线会话分页仅允许查询 ADMIN 令牌，防止自增主键与会员或客户端令牌碰撞越权。
                .eq(OAuth2AccessTokenDO::getUserType, UserTypeEnum.ADMIN.getValue())
                .likeIfPresent(OAuth2AccessTokenDO::getClientId, reqVO.getClientId())
                .orderByDesc(OAuth2AccessTokenDO::getId);
        query.gt(OAuth2AccessTokenDO::getExpiresTime, LocalDateTime.now());
        if (AdminPlatformTypeEnum.BUSINESS_ADMIN.getType().equals(normalizedPlatform)) {
            query.apply("EXISTS (SELECT 1 FROM system_users u WHERE u.id = system_oauth2_access_token.user_id"
                            + " AND u.deleted = 0 AND (u.user_type = {0} OR u.user_type IS NULL OR u.user_type = {1}))",
                    normalizedPlatform, "");
        } else {
            query.apply("EXISTS (SELECT 1 FROM system_users u WHERE u.id = system_oauth2_access_token.user_id"
                            + " AND u.deleted = 0 AND u.user_type = {0})",
                    normalizedPlatform);
        }
        return selectPage(reqVO, query);
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
