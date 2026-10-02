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
