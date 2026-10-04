package com.basicframework.module.system.controller.admin.permission;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.module.system.controller.admin.permission.vo.permission.PermissionAssignRoleDataScopeReqVO;
import com.basicframework.module.system.controller.admin.permission.vo.permission.PermissionAssignRoleMenuReqVO;
import com.basicframework.module.system.controller.admin.permission.vo.permission.PermissionAssignUserRoleReqVO;
import com.basicframework.module.system.dal.dataobject.permission.MenuDO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.service.permission.MenuService;
import com.basicframework.module.system.service.permission.PermissionService;
import com.basicframework.module.system.service.permission.RoleService;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证权限管理接口的平台隔离、委派与响应组装契约。
 *
 * <p>该接口把角色与菜单授权暴露给管理端，是两套管理平台之间的授权边界：读取另一个平台角色的
 * 菜单、或读取另一个平台用户的角色，都会把跨平台授权关系泄漏出去。用例固定以下可观察行为：
 * 授权写入原样下传并返回成功；查询结果只保留当前平台的菜单与角色；跨平台对象显式拒绝；
 * 对象不存在时不误判为越权。</p>
 *
 * @author shady2713
 */
class PermissionControllerTest {

    /** 被测控制器。 */
    private PermissionController controller;
    /** 权限服务替身。 */
    private PermissionService permissionService;
    /** 角色服务替身。 */
    private RoleService roleService;
    /** 菜单服务替身。 */
    private MenuService menuService;
    /** 用户服务替身，同时提供当前登录平台类型。 */
    private AdminUserService userService;

    /** 为每个用例装配独立控制器与替身。 */
    @BeforeEach
    void setUp() {
        controller = new PermissionController();
        permissionService = mock(PermissionService.class);
        roleService = mock(RoleService.class);
        menuService = mock(MenuService.class);
        userService = mock(AdminUserService.class);
        ReflectionTestUtils.setField(controller, "permissionService", permissionService);
        ReflectionTestUtils.setField(controller, "roleService", roleService);
        ReflectionTestUtils.setField(controller, "menuService", menuService);
        ReflectionTestUtils.setField(controller, "userService", userService);
    }

    /**
     * 角色菜单查询必须只返回当前平台的菜单编号。
     */
    @Test
    void getRoleMenuListKeepsCurrentPlatformMenusOnly() {
        when(userService.getLoginUserTypeOrDefault()).thenReturn(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(roleService.getRole(5L)).thenReturn(role(5L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        when(permissionService.getRoleMenuListByRoleId(5L)).thenReturn(Set.of(10L, 20L));
        when(menuService.getMenuList(Set.of(10L, 20L))).thenReturn(List.of(
                menu(10L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()),
                menu(20L, AdminPlatformTypeEnum.SUPER_ADMIN.getType())));

        CommonResult<Set<Long>> result = controller.getRoleMenuList(5L);

        assertThat(result.getCode()).isZero();
        assertThat(result.getData()).as("只保留当前平台菜单").containsExactly(10L);
    }

    /**
     * 目标角色属于另一个平台时必须拒绝，且不得继续读取菜单授权。
     */
    @Test
    void getRoleMenuListRejectsOtherPlatformRole() {
        when(userService.getLoginUserTypeOrDefault()).thenReturn(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(roleService.getRole(5L)).thenReturn(role(5L, AdminPlatformTypeEnum.SUPER_ADMIN.getType()));

        assertThatThrownBy(() -> controller.getRoleMenuList(5L))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
        verify(permissionService, never()).getRoleMenuListByRoleId(5L);
    }

    /**
     * 角色不存在时不视为越权，仍按当前平台过滤菜单授权。
     */
    @Test
    void getRoleMenuListAllowsMissingRole() {
        when(userService.getLoginUserTypeOrDefault()).thenReturn(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(roleService.getRole(6L)).thenReturn(null);
        when(permissionService.getRoleMenuListByRoleId(6L)).thenReturn(Set.of(30L));
        when(menuService.getMenuList(Set.of(30L)))
                .thenReturn(List.of(menu(30L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType())));

        assertThat(controller.getRoleMenuList(6L).getData()).containsExactly(30L);
    }

    /**
     * 赋予角色菜单必须原样下传角色编号与菜单集合，并返回成功。
     */
    @Test
    void assignRoleMenuDelegatesRequest() {
        PermissionAssignRoleMenuReqVO reqVO = new PermissionAssignRoleMenuReqVO();
        reqVO.setRoleId(5L);
        reqVO.setMenuIds(Set.of(10L, 20L));

        CommonResult<Boolean> result = controller.assignRoleMenu(reqVO);

        assertThat(result.getData()).isTrue();
        verify(permissionService).assignRoleMenu(5L, Set.of(10L, 20L));
    }

    /**
     * 赋予角色数据权限必须把数据范围与部门集合一并下传。
     */
    @Test
    void assignRoleDataScopeDelegatesRequest() {
        PermissionAssignRoleDataScopeReqVO reqVO = new PermissionAssignRoleDataScopeReqVO();
        reqVO.setRoleId(5L);
        reqVO.setDataScope(2);
        reqVO.setDataScopeDeptIds(Set.of(100L, 200L));

        CommonResult<Boolean> result = controller.assignRoleDataScope(reqVO);

        assertThat(result.getData()).isTrue();
        verify(permissionService).assignRoleDataScope(5L, 2, Set.of(100L, 200L));
    }

    /**
     * 赋予用户角色必须原样下传用户编号与角色集合。
     */
    @Test
    void assignUserRoleDelegatesRequest() {
        PermissionAssignUserRoleReqVO reqVO = new PermissionAssignUserRoleReqVO();
        reqVO.setUserId(7L);
        reqVO.setRoleIds(Set.of(1L, 2L));

        CommonResult<Boolean> result = controller.assignUserRole(reqVO);

        assertThat(result.getData()).isTrue();
        verify(permissionService).assignUserRole(7L, Set.of(1L, 2L));
    }

    /**
     * 用户角色查询必须只返回当前平台的角色编号。
     */
    @Test
    void listAdminRolesKeepsCurrentPlatformRolesOnly() {
        when(userService.getLoginUserTypeOrDefault()).thenReturn(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(userService.getUser(7L)).thenReturn(user(7L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        when(permissionService.getUserRoleIdListByUserId(7L)).thenReturn(Set.of(1L, 2L));
        when(roleService.getRoleList(Set.of(1L, 2L))).thenReturn(List.of(
                role(1L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()),
                role(2L, AdminPlatformTypeEnum.SUPER_ADMIN.getType())));

        CommonResult<Set<Long>> result = controller.listAdminRoles(7L);

        assertThat(result.getData()).as("只保留当前平台角色").containsExactly(1L);
    }

    /**
     * 目标用户属于另一个平台时必须拒绝，且不得继续读取其角色。
     */
    @Test
    void listAdminRolesRejectsOtherPlatformUser() {
        when(userService.getLoginUserTypeOrDefault()).thenReturn(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(userService.getUser(7L)).thenReturn(user(7L, AdminPlatformTypeEnum.SUPER_ADMIN.getType()));

        assertThatThrownBy(() -> controller.listAdminRoles(7L))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
        verify(permissionService, never()).getUserRoleIdListByUserId(7L);
    }

    /**
     * 用户不存在时不视为越权，仍返回其角色编号。
     */
    @Test
    void listAdminRolesAllowsMissingUser() {
        when(userService.getLoginUserTypeOrDefault()).thenReturn(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(userService.getUser(8L)).thenReturn(null);
        when(permissionService.getUserRoleIdListByUserId(8L)).thenReturn(Set.of(3L));
        when(roleService.getRoleList(Set.of(3L)))
                .thenReturn(List.of(role(3L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType())));

        assertThat(controller.listAdminRoles(8L).getData()).containsExactly(3L);
    }

    /**
     * 构造仅填充平台字段的角色对象。
     *
     * @param id 角色编号
     * @param roleType 角色平台类型
     * @return 角色持久对象
     */
    private static RoleDO role(Long id, String roleType) {
        RoleDO role = new RoleDO();
        role.setId(id);
        role.setRoleType(roleType);
        return role;
    }

    /**
     * 构造仅填充平台字段的菜单对象。
     *
     * @param id 菜单编号
     * @param menuType 菜单平台类型
     * @return 菜单持久对象
     */
    private static MenuDO menu(Long id, String menuType) {
        MenuDO menu = new MenuDO();
        menu.setId(id);
        menu.setMenuType(menuType);
        return menu;
    }

    /**
     * 构造仅填充平台字段的用户对象。
     *
     * @param id 用户编号
     * @param userType 用户平台类型
     * @return 用户持久对象
     */
    private static AdminUserDO user(Long id, String userType) {
        AdminUserDO user = new AdminUserDO();
        user.setId(id);
        user.setUserType(userType);
        return user;
    }

}
