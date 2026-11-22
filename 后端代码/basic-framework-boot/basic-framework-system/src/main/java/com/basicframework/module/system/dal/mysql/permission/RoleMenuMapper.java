package com.basicframework.module.system.dal.mysql.permission;

import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.module.system.dal.dataobject.permission.RoleMenuDO;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import org.apache.ibatis.annotations.Mapper;

import java.util.Collection;
import java.util.List;

/**
 * RoleMenuMapper 数据访问接口，负责持久化查询与写入。
 *
 * @author 李杰
 */
@Mapper
public interface RoleMenuMapper extends BaseMapperX<RoleMenuDO> {

    /**
     * 查询列表By角色编号。
     *
     * @param roleId 角色编号
     * @return 查询结果
     */
    default List<RoleMenuDO> selectListByRoleId(Long roleId) {
        return selectList(RoleMenuDO::getRoleId, roleId);
    }

    /**
     * 查询列表By角色编号。
     *
     * @param roleIds 编号集合
     * @return 查询结果
     */
    default List<RoleMenuDO> selectListByRoleId(Collection<Long> roleIds) {
        return selectList(RoleMenuDO::getRoleId, roleIds);
    }

    /**
     * 查询列表By菜单编号。
     *
     * @param menuId 菜单编号
     * @return 查询结果
     */
    default List<RoleMenuDO> selectListByMenuId(Long menuId) {
        return selectList(RoleMenuDO::getMenuId, menuId);
    }

    /**
     * 删除列表By角色编号And菜单Ids。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param roleId 角色编号
     * @param menuIds 编号集合
     */
    default void deleteListByRoleIdAndMenuIds(Long roleId, Collection<Long> menuIds) {
        delete(new LambdaQueryWrapper<RoleMenuDO>()
                .eq(RoleMenuDO::getRoleId, roleId)
                .in(RoleMenuDO::getMenuId, menuIds));
    }

    /**
     * 删除列表By菜单编号。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param menuId 菜单编号
     */
    default void deleteListByMenuId(Long menuId) {
        delete(new LambdaQueryWrapper<RoleMenuDO>().eq(RoleMenuDO::getMenuId, menuId));
    }

    /**
     * 删除列表By角色编号。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param roleId 角色编号
     */
    default void deleteListByRoleId(Long roleId) {
        delete(new LambdaQueryWrapper<RoleMenuDO>().eq(RoleMenuDO::getRoleId, roleId));
    }

}
