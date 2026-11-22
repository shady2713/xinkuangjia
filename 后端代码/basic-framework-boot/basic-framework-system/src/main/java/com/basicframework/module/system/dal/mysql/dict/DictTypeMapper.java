package com.basicframework.module.system.dal.mysql.dict;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.controller.admin.dict.vo.type.DictTypePageReqVO;
import com.basicframework.module.system.dal.dataobject.dict.DictTypeDO;
import org.apache.ibatis.annotations.Mapper;

/**
 * 字典类型数据访问接口。
 *
 * @author 李杰
 */
@Mapper
public interface DictTypeMapper extends BaseMapperX<DictTypeDO> {

    /**
     * 分页查询字典类型。
     *
     * @param reqVO 分页请求
     * @return 分页结果
     */
    default PageResult<DictTypeDO> selectPage(DictTypePageReqVO reqVO) {
        return selectPage(reqVO, new LambdaQueryWrapperX<DictTypeDO>()
                .likeIfPresent(DictTypeDO::getName, reqVO.getName())
                .likeIfPresent(DictTypeDO::getType, reqVO.getType())
                .eqIfPresent(DictTypeDO::getStatus, reqVO.getStatus())
                .betweenIfPresent(DictTypeDO::getCreateTime, reqVO.getCreateTime())
                .orderByDesc(DictTypeDO::getId));
    }

    /**
     * 按类型编码查询字典类型。
     *
     * @param type 类型编码
     * @return 匹配的字典类型
     */
    default DictTypeDO selectByType(String type) {
        return selectOne(DictTypeDO::getType, type);
    }

    /**
     * 按名称查询字典类型。
     *
     * @param name 字典名称
     * @return 匹配的字典类型
     */
    default DictTypeDO selectByName(String name) {
        return selectOne(DictTypeDO::getName, name);
    }

}
