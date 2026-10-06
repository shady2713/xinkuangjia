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
 * 署名验收：尚未验收
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
     * 软删除单个字典类型并记录删除时间与操作人。
     *
     * <p>逻辑删除列必须经 {@code LambdaUpdateWrapper.set} 显式写入：实体式
     * {@code update(entity, wrapper)} 会跳过带 {@code @TableLogic} 的列，导致删除标记不落库、
     * 记录继续被查询命中。</p>
     *
     * <p>操作人也必须显式写入：实体为 {@code null} 时 MyBatis-Plus 不执行 {@code updateFill}，
     * {@code updater} 会保留上一位操作人，使删除审计指向错误的人。</p>
     *
     * @param id 字典类型编号
     * @param deletedTime 删除时间
     * @param updater 本次删除的操作人编号文本；为 {@code null} 时不覆盖原值
     */
    default void updateToDelete(Long id, LocalDateTime deletedTime, String updater) {
        update(null, new LambdaUpdateWrapper<DictTypeDO>()
                .set(DictTypeDO::getDeleted, true)
                .set(DictTypeDO::getDeletedTime, deletedTime)
                .set(updater != null, DictTypeDO::getUpdater, updater)
                .eq(DictTypeDO::getId, id));
    }

    /**
     * 使用同一删除时间批量软删除字典类型，并记录操作人。
     *
     * <p>与单条删除同源：逻辑删除列与操作人都必须显式写入，否则批量删除既不会让记录从查询中
     * 消失，也会把审计记到上一位操作人名下。</p>
     *
     * @param ids 字典类型编号集合
     * @param deletedTime 删除时间
     * @param updater 本次删除的操作人编号文本；为 {@code null} 时不覆盖原值
     * @return 更新行数
     */
    default int updateToDeleteByIds(Collection<Long> ids, LocalDateTime deletedTime, String updater) {
        if (ids == null || ids.isEmpty()) {
            return 0;
        }
        return update(null, new LambdaUpdateWrapper<DictTypeDO>()
                .set(DictTypeDO::getDeleted, true)
                .set(DictTypeDO::getDeletedTime, deletedTime)
                .set(updater != null, DictTypeDO::getUpdater, updater)
                .in(DictTypeDO::getId, ids));
    }

}
