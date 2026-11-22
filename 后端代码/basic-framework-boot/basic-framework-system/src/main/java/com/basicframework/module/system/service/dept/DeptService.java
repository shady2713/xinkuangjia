package com.basicframework.module.system.service.dept;

import com.basicframework.framework.common.util.collection.CollectionUtils;
import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptListReqVO;
import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptSaveReqVO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;

import java.util.*;

/**
 * 部门服务接口。
 * <p>
 * 提供部门管理的增删改查、树形查询和基础校验能力。
 *
 * @author 李杰
 */
public interface DeptService {

    /**
     * 新增部门。
     *
     * @param createReqVO 部门信息
     * @return 部门编号
     */
    Long createDept(DeptSaveReqVO createReqVO);

    /**
     * 修改部门。
     *
     * @param updateReqVO 部门信息
     */
    void updateDept(DeptSaveReqVO updateReqVO);

    /**
     * 删除部门。
     *
     * @param id 部门编号
     */
    void deleteDept(Long id);

    /**
     * 批量删除部门。
     *
     * @param ids 部门编号列表
     */
    void deleteDeptList(List<Long> ids);

    /**
     * 获取部门。
     *
     * @param id 部门编号
     * @return 部门信息
     */
    DeptDO getDept(Long id);

    /**
     * 批量获取部门。
     *
     * @param ids 部门编号列表
     * @return 部门列表
     */
    List<DeptDO> getDeptList(Collection<Long> ids);

    /**
     * 查询部门列表。
     *
     * @param reqVO 查询条件
     * @return 部门列表
     */
    List<DeptDO> getDeptList(DeptListReqVO reqVO);

    /**
     * 根据编号列表构建映射。
     *
     * @param ids 部门编号列表
     * @return 部门映射
     */
    default Map<Long, DeptDO> getDeptMap(Collection<Long> ids) {
        List<DeptDO> list = getDeptList(ids);
        return CollectionUtils.convertMap(list, DeptDO::getId);
    }

    /**
     * 获取指定部门下所有子部门。
     *
     * @param id 部门编号
     * @return 子部门列表
     */
    default List<DeptDO> getChildDeptList(Long id) {
        return getChildDeptList(Collections.singleton(id));
    }

    /**
     * 获取指定部门下所有子部门。
     *
     * @param ids 部门编号列表
     * @return 子部门列表
     */
    List<DeptDO> getChildDeptList(Collection<Long> ids);

    /**
     * 获取指定负责人的部门列表。
     *
     * @param id 负责人编号
     * @return 部门列表
     */
    List<DeptDO> getDeptListByLeaderUserId(Long id);

    /**
     * 获取指定部门及其所有子部门编号（优先从缓存读取）。
     *
     * @param id 部门编号
     * @return 子部门编号集合
     */
    Set<Long> getChildDeptIdListFromCache(Long id);

    /**
     * 校验部门列表有效性。
     * <p>
     * 逐个校验部门是否存在且处于启用状态。
     *
     * @param ids 部门编号列表
     */
    void validateDeptList(Collection<Long> ids);

    /**
     * 按部门名称查询部门信息。
     *
     * @param name 部门名称
     * @return 部门信息
     */
    DeptDO getDeptByName(String name);

}
