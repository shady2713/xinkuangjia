package com.basicframework.module.system.dal.mysql.dict;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.controller.admin.dict.vo.type.DictTypePageReqVO;
import com.basicframework.module.system.dal.dataobject.dict.DictTypeDO;
import org.apache.ibatis.annotations.Mapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;

import java.time.LocalDateTime;
import java.util.Collection;

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

    /**
     * 软删除单个字典类型并记录删除时间。
     *
     * @param id 字典类型编号
     * @param deletedTime 删除时间
     */
    default void updateToDelete(Long id, LocalDateTime deletedTime) {
        DictTypeDO update = new DictTypeDO();
        update.setDeleted(true);
        update.setDeletedTime(deletedTime);
        update(update, new LambdaUpdateWrapper<DictTypeDO>().eq(DictTypeDO::getId, id));
    }

    /**
     * 使用同一删除时间批量软删除字典类型。
     *
     * @param ids 字典类型编号集合
     * @param deletedTime 删除时间
     * @return 更新行数
     */
    default int updateToDeleteByIds(Collection<Long> ids, LocalDateTime deletedTime) {
        if (ids == null || ids.isEmpty()) {
            return 0;
        }
        DictTypeDO update = new DictTypeDO();
        update.setDeleted(true);
        update.setDeletedTime(deletedTime);
        return update(update, new LambdaUpdateWrapper<DictTypeDO>().in(DictTypeDO::getId, ids));
    }

}
