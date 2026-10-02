package com.basicframework.module.system.service.permission;

import com.basicframework.framework.common.biz.system.permission.dto.DeptDataPermissionRespDTO;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static java.util.Collections.singleton;

/**
 * 权限服务接口。
 * <p>
 * 提供用户-角色、角色-菜单、角色-部门数据权限的能力。
 *
 * @author 李杰
 */
public interface PermissionService {

    /**
     * 批量查询可见用户的同平台角色名称，供用户列表只读展示。
     * @param userIds 已通过用户列表数据权限过滤的当前页用户编号
     * @param userType 当前管理平台类型
     * @return 用户编号对应的角色名称；没有关联时不含对应键
     */
    Map<Long, List<String>> getUserRoleNames(Collection<Long> userIds, String userType);

    /**
     * 校验用户是否具备任意一个指定权限。
     *
     * @param userId      用户编号
     * @param permissions 权限标识
     * @return 是否有匹配权限
     */
    boolean hasAnyPermissions(Long userId, String... permissions);

    /**
     * 校验用户是否具备任意一个指定角色。
     *
     * @param userId 用户编号
     * @param roles  角色编码
     * @return 是否有匹配角色
     */
    boolean hasAnyRoles(Long userId, String... roles);

    // ========== 角色-菜单关系 ==========

    /**
     * 设置角色可访问菜单。
     *
     * @param roleId  角色编号
     * @param menuIds 菜单编号集合
     */
    void assignRoleMenu(Long roleId, Set<Long> menuIds);

    /**
     * 处理角色删除时的清理。
     *
     * @param roleId 角色编号
     */
    void processRoleDeleted(Long roleId);

    /**
     * 处理菜单删除时的清理。
     *
     * @param menuId 菜单编号
     */
    void processMenuDeleted(Long menuId);

    /**
     * 获取角色拥有的菜单集合。
     *
     * @param roleId 角色编号
     * @return 菜单编号集合
     */
    default Set<Long> getRoleMenuListByRoleId(Long roleId) {
        return getRoleMenuListByRoleId(singleton(roleId));
    }

    /**
     * 批量角色获取其可访问菜单集合。
     *
     * @param roleIds 角色编号集合
     * @return 菜单编号集合
     */
    Set<Long> getRoleMenuListByRoleId(Collection<Long> roleIds);

    /**
     * 获取菜单关联的角色集合（从缓存读取）。
     *
     * @param menuId 菜单编号
     * @return 角色编号集合
     */
    Set<Long> getMenuRoleIdListByMenuIdFromCache(Long menuId);

    // ========== 用户-角色关系 ==========

    /**
     * 设置用户角色。
     *
     * @param userId  用户编号
     * @param roleIds 角色编号集合
     */
    void assignUserRole(Long userId, Set<Long> roleIds);

    /**
     * 处理用户删除时的清理。
     *
     * @param userId 用户编号
     */
    void processUserDeleted(Long userId);

    /**
     * 按角色集合查询角色下的用户编号。
     *
     * @param roleIds 角色编号集合
     * @return 用户编号集合
     */
    Set<Long> getUserRoleIdListByRoleId(Collection<Long> roleIds);

    /**
     * 获取用户的角色编号集合。
     *
     * @param userId 用户编号
     * @return 角色编号集合
     */
    Set<Long> getUserRoleIdListByUserId(Long userId);

    /**
     * 获取用户的角色编号集合（从缓存读取）。
     *
     * @param userId 用户编号
     * @return 角色编号集合
     */
    Set<Long> getUserRoleIdListByUserIdFromCache(Long userId);

    // ========== 用户-部门数据范围 ==========

    /**
     * 设置角色数据范围。
     *
     * @param roleId           角色编号
     * @param dataScope        数据范围
     * @param dataScopeDeptIds 部门编号集合
     */
    void assignRoleDataScope(Long roleId, Integer dataScope, Set<Long> dataScopeDeptIds);

    /**
     * 获取用户的部门数据权限描述。
     *
     * @param userId 用户编号
     * @return 部门数据权限对象
     */
    DeptDataPermissionRespDTO getDeptDataPermission(Long userId);

}
