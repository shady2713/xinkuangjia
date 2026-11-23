package com.basicframework.module.system.dal.mysql.oauth2;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.controller.admin.oauth2.vo.client.OAuth2ClientPageReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2ClientDO;
import org.apache.ibatis.annotations.Mapper;


/**
 * OAuth2 客户端 Mapper
 *
 * @author 李杰
 */
@Mapper
public interface OAuth2ClientMapper extends BaseMapperX<OAuth2ClientDO> {

    /**
     * 查询分页数据。
     *
     * @param reqVO 请求参数
     * @return 查询结果
     */
    default PageResult<OAuth2ClientDO> selectPage(OAuth2ClientPageReqVO reqVO) {
        return selectPage(reqVO, new LambdaQueryWrapperX<OAuth2ClientDO>()
                .likeIfPresent(OAuth2ClientDO::getName, reqVO.getName())
                .eqIfPresent(OAuth2ClientDO::getStatus, reqVO.getStatus())
                .orderByDesc(OAuth2ClientDO::getId));
    }

    /**
     * 查询By客户端编号。
     *
     * @param clientId 客户端编号
     * @return 查询结果
     */
    default OAuth2ClientDO selectByClientId(String clientId) {
        return selectOne(OAuth2ClientDO::getClientId, clientId);
    }

    /**
     * 仅当存储密钥仍等于已校验值时更新密钥。
     *
     * @param id 客户端主键
     * @param expectedSecret 已校验的当前存储值
     * @param newSecret 新密钥哈希
     * @return 受影响行数；为 0 表示存储值已被并发修改
     */
    default int updateSecretByIdAndSecret(Long id, String expectedSecret, String newSecret) {
        OAuth2ClientDO updateObj = new OAuth2ClientDO();
        updateObj.setSecret(newSecret);
        return update(updateObj, new LambdaUpdateWrapper<OAuth2ClientDO>()
                .eq(OAuth2ClientDO::getId, id)
                .eq(OAuth2ClientDO::getSecret, expectedSecret));
    }

}
