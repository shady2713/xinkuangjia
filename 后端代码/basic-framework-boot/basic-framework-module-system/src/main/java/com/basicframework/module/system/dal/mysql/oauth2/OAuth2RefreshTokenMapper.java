package com.basicframework.module.system.dal.mysql.oauth2;

import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;

import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2RefreshTokenDO;
import org.apache.ibatis.annotations.Mapper;

/**
 * OAuth2RefreshTokenMapper 数据访问接口，负责持久化查询与写入。
 *
 * @author 李杰
 */
@Mapper
public interface OAuth2RefreshTokenMapper extends BaseMapperX<OAuth2RefreshTokenDO> {

    /**
     * 锁定并重新读取刷新会话，避免使用撤销前的事务快照签发新令牌。
     *
     * @param refreshToken 刷新令牌
     * @return 当前有效记录，已经删除时返回 {@code null}；调用方必须持有事务
     */
    default OAuth2RefreshTokenDO selectByRefreshTokenForUpdate(String refreshToken) {
        return selectOne(new LambdaQueryWrapperX<OAuth2RefreshTokenDO>()
                .eq(OAuth2RefreshTokenDO::getRefreshToken, refreshToken).last("FOR UPDATE"));
    }

    /**
     * 撤销用户的所有刷新会话，包括已经没有访问令牌的孤立记录。
     *
     * @param userId 用户编号
     * @param userType 认证用户类型
     * @return 删除的记录数
     */
    default int deleteByUserIdAndUserType(Long userId, Integer userType) {
        return delete(new LambdaQueryWrapperX<OAuth2RefreshTokenDO>()
                .eq(OAuth2RefreshTokenDO::getUserId, userId)
                .eq(OAuth2RefreshTokenDO::getUserType, userType));
    }

    /**
     * 删除By刷新令牌。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param refreshToken 刷新令牌参数
     * @return 操作结果
     */
    default int deleteByRefreshToken(String refreshToken) {
        return delete(new LambdaQueryWrapperX<OAuth2RefreshTokenDO>()
                .eq(OAuth2RefreshTokenDO::getRefreshToken, refreshToken));
    }

    /**
     * 查询By刷新令牌。
     *
     * @param refreshToken 刷新令牌参数
     * @return 查询结果
     */
    default OAuth2RefreshTokenDO selectByRefreshToken(String refreshToken) {
        return selectOne(OAuth2RefreshTokenDO::getRefreshToken, refreshToken);
    }

}
