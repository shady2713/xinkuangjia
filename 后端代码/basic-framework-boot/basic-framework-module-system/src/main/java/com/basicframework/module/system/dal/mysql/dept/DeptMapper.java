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
     * @param roleType 可信管理平台
     * @return 查询结果
     */
    default List<DeptDO> selectList(DeptListReqVO reqVO, String roleType) {
        return selectList(new LambdaQueryWrapperX<DeptDO>()
                .eq(DeptDO::getRoleType, roleType)
                .likeIfPresent(DeptDO::getName, reqVO.getName())
                .eqIfPresent(DeptDO::getStatus, reqVO.getStatus()));
    }

    /**
     * 查询By父级编号And名称。
     *
     * @param parentId 父级编号
     * @param name 名称
     * @param roleType 可信管理平台，隔离各平台根部门命名空间
     * @return 查询结果
     */
    default DeptDO selectByParentIdAndName(Long parentId, String name, String roleType) {
        return selectOne(new LambdaQueryWrapperX<DeptDO>().eq(DeptDO::getParentId, parentId)
                .eq(DeptDO::getName, name).eq(DeptDO::getRoleType, roleType));
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
     * @param roleType 根部门所属平台，防止历史跨平台父子关系进入树
     * @return 查询结果
     */
    default List<DeptDO> selectListByParentId(Collection<Long> parentIds, String roleType) {
        return selectList(new LambdaQueryWrapperX<DeptDO>().in(DeptDO::getParentId, parentIds)
                .eq(DeptDO::getRoleType, roleType));
    }

    /**
     * 查询列表ByLeader用户编号。
     *
     * @param id 主键编号
     * @param roleType 可信管理平台
     * @return 查询结果
     */
    default List<DeptDO> selectListByLeaderUserId(Long id, String roleType) {
        return selectList(new LambdaQueryWrapperX<DeptDO>().eq(DeptDO::getLeaderUserId, id)
                .eq(DeptDO::getRoleType, roleType));
    }

    /** 查询当前平台的部门编号集合；调用方负责处理空集合。 */
    default List<DeptDO> selectListByIdsAndRoleType(Collection<Long> ids, String roleType) {
        return selectList(new LambdaQueryWrapperX<DeptDO>().in(DeptDO::getId, ids).eq(DeptDO::getRoleType, roleType));
    }

    /** 按当前平台和名称查询导入用部门，不允许同名部门串平台。 */
    default DeptDO selectByNameAndRoleType(String name, String roleType) {
        return selectOne(new LambdaQueryWrapperX<DeptDO>().eq(DeptDO::getName, name)
                .eq(DeptDO::getRoleType, roleType).last("LIMIT 1"));
    }

}
