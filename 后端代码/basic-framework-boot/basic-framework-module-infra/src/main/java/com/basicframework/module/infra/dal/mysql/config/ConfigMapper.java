package com.basicframework.module.infra.dal.mysql.config;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.infra.controller.admin.config.vo.ConfigPageReqVO;
import com.basicframework.module.infra.dal.dataobject.config.ConfigDO;
import org.apache.ibatis.annotations.Mapper;

/**
 * 参数配置 Mapper。
 *
 * @author 李杰
 * 署名验收：尚未验收
 */
@Mapper
public interface ConfigMapper extends BaseMapperX<ConfigDO> {

    /**
     * 根据参数键查询参数配置。
     *
     * @param key 参数键
     * @return 参数配置；不存在时返回 null
     */
    default ConfigDO selectByKey(String key) {
        return selectOne(ConfigDO::getConfigKey, key);
    }

    /**
     * 分页查询参数配置。
     *
     * @param reqVO 分页查询条件
     * @return 参数配置分页结果
     */
    default PageResult<ConfigDO> selectPage(ConfigPageReqVO reqVO) {
        return selectPage(reqVO, new LambdaQueryWrapperX<ConfigDO>()
                .likeIfPresent(ConfigDO::getName, reqVO.getName())
                .likeIfPresent(ConfigDO::getConfigKey, reqVO.getKey())
                .eqIfPresent(ConfigDO::getType, reqVO.getType())
                .betweenIfPresent(ConfigDO::getCreateTime, reqVO.getCreateTime())
                .orderByDesc(ConfigDO::getId));
    }

}
