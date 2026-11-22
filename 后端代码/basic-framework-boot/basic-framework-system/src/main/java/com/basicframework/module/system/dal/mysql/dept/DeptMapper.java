package com.basicframework.module.system.dal.mysql.dept;

import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptListReqVO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import org.apache.ibatis.annotations.Mapper;

import java.util.Collection;
import java.util.List;

/**
 * DeptMapper 数据访问接口，负责持久化查询与写入。
 *
 * @author 李杰
 */
@Mapper
public interface DeptMapper extends BaseMapperX<DeptDO> {

    /**
     * 查询列表。
     *
     * @param reqVO 请求参数
     * @return 查询结果
     */
    default List<DeptDO> selectList(DeptListReqVO reqVO) {
        return selectList(new LambdaQueryWrapperX<DeptDO>()
                .likeIfPresent(DeptDO::getName, reqVO.getName())
                .eqIfPresent(DeptDO::getStatus, reqVO.getStatus()));
    }

    /**
     * 查询By父级编号And名称。
     *
     * @param parentId 父级编号
     * @param name 名称
     * @return 查询结果
     */
    default DeptDO selectByParentIdAndName(Long parentId, String name) {
        return selectOne(DeptDO::getParentId, parentId, DeptDO::getName, name);
    }

    /**
     * 查询数量By父级编号。
     *
     * @param parentId 父级编号
     * @return 统计数量
     */
    default Long selectCountByParentId(Long parentId) {
        return selectCount(DeptDO::getParentId, parentId);
    }

    /**
     * 查询列表By父级编号。
     *
     * @param parentIds 编号集合
     * @return 查询结果
     */
    default List<DeptDO> selectListByParentId(Collection<Long> parentIds) {
        return selectList(DeptDO::getParentId, parentIds);
    }

    /**
     * 查询列表ByLeader用户编号。
     *
     * @param id 主键编号
     * @return 查询结果
     */
    default List<DeptDO> selectListByLeaderUserId(Long id) {
        return selectList(DeptDO::getLeaderUserId, id);
    }

}
