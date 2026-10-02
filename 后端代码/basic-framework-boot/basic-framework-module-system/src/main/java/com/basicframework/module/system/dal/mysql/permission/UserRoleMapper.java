package com.basicframework.module.system.dal.mysql.permission;

import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.module.system.dal.dataobject.permission.UserRoleDO;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import org.apache.ibatis.annotations.Mapper;

import java.util.Collection;
import java.util.List;

/**
 * UserRoleMapper 数据访问接口，负责持久化查询与写入。
 *
 * @author 李杰
 */
@Mapper
public interface UserRoleMapper extends BaseMapperX<UserRoleDO> {

    /**
     * 批量读取当前用户页的角色关联，空集合不访问数据库。
     * @param userIds 已由用户查询权限裁剪的当前页用户编号
     * @return 现存用户角色关联
     */
    default List<UserRoleDO> selectListByUserIds(Collection<Long> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return List.of();
        }
        return selectList(new LambdaQueryWrapper<UserRoleDO>().in(UserRoleDO::getUserId, userIds));
    }

    /**
     * 查询列表By用户编号。
     *
     * @param userId 用户编号
     * @return 查询结果
     */
    default List<UserRoleDO> selectListByUserId(Long userId) {
        return selectList(UserRoleDO::getUserId, userId);
    }

    /**
     * 删除列表By用户编号And角色编号Ids。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param userId 用户编号
     * @param roleIds 编号集合
     */
    default void deleteListByUserIdAndRoleIdIds(Long userId, Collection<Long> roleIds) {
        delete(new LambdaQueryWrapper<UserRoleDO>()
                .eq(UserRoleDO::getUserId, userId)
                .in(UserRoleDO::getRoleId, roleIds));
    }

    /**
     * 删除列表By用户编号。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param userId 用户编号
     */
    default void deleteListByUserId(Long userId) {
        delete(new LambdaQueryWrapper<UserRoleDO>().eq(UserRoleDO::getUserId, userId));
    }

    /**
     * 删除列表By角色编号。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param roleId 角色编号
     */
    default void deleteListByRoleId(Long roleId) {
        delete(new LambdaQueryWrapper<UserRoleDO>().eq(UserRoleDO::getRoleId, roleId));
    }

    /**
     * 查询列表By角色Ids。
     *
     * @param roleIds 编号集合
     * @return 查询结果
     */
    default List<UserRoleDO> selectListByRoleIds(Collection<Long> roleIds) {
        return selectList(UserRoleDO::getRoleId, roleIds);
    }

}
