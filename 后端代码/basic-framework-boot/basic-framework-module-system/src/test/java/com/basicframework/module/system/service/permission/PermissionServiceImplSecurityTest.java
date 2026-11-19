package com.basicframework.module.system.service.permission;

import com.basicframework.framework.common.biz.system.permission.dto.DeptDataPermissionRespDTO;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.dal.dataobject.permission.UserRoleDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.dal.mysql.permission.RoleMenuMapper;
import com.basicframework.module.system.dal.mysql.permission.UserRoleMapper;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.permission.DataScopeEnum;
import com.basicframework.module.system.service.dept.DeptService;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Collections;
import java.util.List;
import java.util.Set;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.module.system.enums.ErrorCodeConstants.ROLE_IS_DISABLE;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证 {@link PermissionServiceImpl} 的反提权与超管角色保护边界。
 *
 * @author shady2713
 */
@ExtendWith(MockitoExtension.class)
class PermissionServiceImplSecurityTest {

    @Mock
    private RoleMenuMapper roleMenuMapper;
    @Mock
    private UserRoleMapper userRoleMapper;
    @Mock
    private RoleService roleService;
    @Mock
    private MenuService menuService;
    @Mock
    private DeptService deptService;
    @Mock
    private AdminUserService userService;

    @Spy
    @InjectMocks
    private PermissionServiceImpl permissionService;

    /** 清理线程级安全上下文，避免污染后续用例。 */
    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    /** 验证非超管操作员传入空角色集合时，无法摘除既有超级管理员的角色。 */
    @Test
    void assignUserRoleRejectsNonSuperAdminStrippingSuperAdminRoles() {
        setLoginUser(20L);
        AdminUserDO superAdminUser = new AdminUserDO();
        superAdminUser.setId(1L);
        superAdminUser.setUserType(AdminPlatformTypeEnum.SUPER_ADMIN.getType());
        when(userService.getUser(1L)).thenReturn(superAdminUser);
        when(userService.getLoginUserTypeOrDefault()).thenReturn(AdminPlatformTypeEnum.SUPER_ADMIN.getType());

        RoleDO operatorRole = new RoleDO();
        operatorRole.setId(2L);
        operatorRole.setCode("sub_admin");
        operatorRole.setRoleType(AdminPlatformTypeEnum.SUPER_ADMIN.getType());
        operatorRole.setStatus(CommonStatusEnum.ENABLE.getStatus());
        doReturn(List.of(operatorRole)).when(permissionService).getEnableUserRoleListByUserIdFromCache(20L);
        when(roleService.hasAnySuperAdmin(Set.of(2L))).thenReturn(false);

        UserRoleDO existingSuperRole = new UserRoleDO();
        existingSuperRole.setUserId(1L);
        existingSuperRole.setRoleId(1L);
        when(userRoleMapper.selectListByUserId(1L)).thenReturn(List.of(existingSuperRole));
        when(roleService.hasAnySuperAdmin(Set.of(1L))).thenReturn(true);

        assertThatThrownBy(() -> permissionService.assignUserRole(1L, Set.of()))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        verify(userRoleMapper, never()).deleteListByUserIdAndRoleIdIds(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any());
    }

    /** 验证无全量数据权限的非超管操作员不能授予角色 ALL 数据范围或越界自定义部门。 */
    @Test
    void assignRoleDataScopeRejectsScopeEscalationByNonSuperAdmin() {
        setLoginUser(20L);
        RoleDO targetRole = new RoleDO();
        targetRole.setId(5L);
        targetRole.setRoleType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(roleService.getRole(5L)).thenReturn(targetRole);
        when(userService.getLoginUserTypeOrDefault()).thenReturn(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());

        RoleDO operatorRole = new RoleDO();
        operatorRole.setId(2L);
        operatorRole.setCode("dept_admin");
        operatorRole.setRoleType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        operatorRole.setStatus(CommonStatusEnum.ENABLE.getStatus());
        operatorRole.setDataScope(DataScopeEnum.DEPT_AND_CHILD.getScope());
        doReturn(List.of(operatorRole)).when(permissionService).getEnableUserRoleListByUserIdFromCache(20L);
        when(roleService.hasAnySuperAdmin(Set.of(2L))).thenReturn(false);

        DeptDataPermissionRespDTO operatorPerm = new DeptDataPermissionRespDTO();
        operatorPerm.setAll(false);
        operatorPerm.setDeptIds(Set.of(100L));
        doReturn(operatorPerm).when(permissionService).getDeptDataPermission(20L);

        AdminUserDO operatorUser = new AdminUserDO();
        operatorUser.setId(20L);
        operatorUser.setDeptId(100L);
        when(userService.getUser(20L)).thenReturn(operatorUser);
        when(deptService.getChildDeptIdListFromCache(100L)).thenReturn(Set.of(101L));

        assertThatThrownBy(() -> permissionService.assignRoleDataScope(5L, DataScopeEnum.ALL.getScope(), Set.of()))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        assertThatThrownBy(() -> permissionService.assignRoleDataScope(
                5L, DataScopeEnum.DEPT_CUSTOM.getScope(), Set.of(100L, 999L)))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        assertThatThrownBy(() -> permissionService.assignRoleDataScope(
                5L, DataScopeEnum.DEPT_AND_CHILD.getScope(), Set.of()))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        verify(roleService, never()).updateRoleDataScope(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    /** 验证分配角色时传入已禁用或不存在的角色会被校验拦截。 */
    @Test
    void assignUserRoleRejectsInvalidOrDisabledRole() {
        setLoginUser(20L);
        AdminUserDO targetUser = new AdminUserDO();
        targetUser.setId(30L);
        targetUser.setUserType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(userService.getUser(30L)).thenReturn(targetUser);
        when(userService.getLoginUserTypeOrDefault()).thenReturn(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());

        RoleDO operatorRole = buildOperatorRole(DataScopeEnum.DEPT_ONLY.getScope());
        doReturn(List.of(operatorRole)).when(permissionService).getEnableUserRoleListByUserIdFromCache(20L);
        when(roleService.hasAnySuperAdmin(Set.of(2L))).thenReturn(false);
        when(userRoleMapper.selectListByUserId(30L)).thenReturn(Collections.emptyList());
        doThrow(exception(ROLE_IS_DISABLE, "disabled_role")).when(roleService).validateRoleList(Set.of(9L));

        assertThatThrownBy(() -> permissionService.assignUserRole(30L, Set.of(9L)))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ROLE_IS_DISABLE.getCode()));
        verify(userRoleMapper, never()).insertBatch(org.mockito.ArgumentMatchers.any());
    }

    /** 验证仅持有指定部门权限的操作员不得将角色升级为动态本部门或本部门及以下权限。 */
    @Test
    void assignRoleDataScopeRejectsDynamicScopeWhenOperatorOnlyHasCustomScope() {
        setLoginUser(20L);
        RoleDO targetRole = new RoleDO();
        targetRole.setId(5L);
        targetRole.setRoleType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(roleService.getRole(5L)).thenReturn(targetRole);
        when(userService.getLoginUserTypeOrDefault()).thenReturn(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());

        RoleDO operatorRole = buildOperatorRole(DataScopeEnum.DEPT_CUSTOM.getScope());
        doReturn(List.of(operatorRole)).when(permissionService).getEnableUserRoleListByUserIdFromCache(20L);
        when(roleService.hasAnySuperAdmin(Set.of(2L))).thenReturn(false);

        DeptDataPermissionRespDTO operatorPerm = new DeptDataPermissionRespDTO();
        operatorPerm.setAll(false);
        operatorPerm.setDeptIds(Set.of(100L));
        doReturn(operatorPerm).when(permissionService).getDeptDataPermission(20L);

        assertThatThrownBy(() -> permissionService.assignRoleDataScope(
                5L, DataScopeEnum.DEPT_ONLY.getScope(), Set.of()))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        assertThatThrownBy(() -> permissionService.assignRoleDataScope(
                5L, DataScopeEnum.DEPT_AND_CHILD.getScope(), Set.of()))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        verify(roleService, never()).updateRoleDataScope(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    /** 验证角色已有外部部门持有人时，非超管不得把该角色改为本部门动态范围从而放大他人权限。 */
    @Test
    void assignRoleDataScopeRejectsDynamicScopeWhenExistingHolderOutOfOperatorDept() {
        setLoginUser(20L);
        RoleDO targetRole = new RoleDO();
        targetRole.setId(5L);
        targetRole.setRoleType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(roleService.getRole(5L)).thenReturn(targetRole);
        when(userService.getLoginUserTypeOrDefault()).thenReturn(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());

        RoleDO operatorRole = buildOperatorRole(DataScopeEnum.DEPT_AND_CHILD.getScope());
        doReturn(List.of(operatorRole)).when(permissionService).getEnableUserRoleListByUserIdFromCache(20L);
        when(roleService.hasAnySuperAdmin(Set.of(2L))).thenReturn(false);

        DeptDataPermissionRespDTO operatorPerm = new DeptDataPermissionRespDTO();
        operatorPerm.setAll(false);
        operatorPerm.setDeptIds(Set.of(100L, 101L));
        doReturn(operatorPerm).when(permissionService).getDeptDataPermission(20L);

        AdminUserDO operatorUser = new AdminUserDO();
        operatorUser.setId(20L);
        operatorUser.setDeptId(100L);
        when(userService.getUser(20L)).thenReturn(operatorUser);

        UserRoleDO existingHolder = new UserRoleDO();
        existingHolder.setUserId(30L);
        existingHolder.setRoleId(5L);
        when(userRoleMapper.selectListByRoleIds(Collections.singleton(5L))).thenReturn(List.of(existingHolder));

        AdminUserDO externalHolder = new AdminUserDO();
        externalHolder.setId(30L);
        externalHolder.setDeptId(200L);
        when(userService.getUserList(Set.of(30L))).thenReturn(List.of(externalHolder));

        assertThatThrownBy(() -> permissionService.assignRoleDataScope(
                5L, DataScopeEnum.DEPT_ONLY.getScope(), Set.of()))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        verify(roleService, never()).updateRoleDataScope(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    /** 验证向目标用户授予本部门及以下角色时，若目标用户下级部门超出操作员授权范围则拒绝。 */
    @Test
    void assignUserRoleRejectsDynamicRoleForTargetUserWhoseChildDeptExceedsOperatorScope() {
        setLoginUser(20L);
        AdminUserDO targetUser = new AdminUserDO();
        targetUser.setId(30L);
        targetUser.setDeptId(200L);
        targetUser.setUserType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(userService.getUser(30L)).thenReturn(targetUser);
        when(userService.getLoginUserTypeOrDefault()).thenReturn(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());

        RoleDO operatorRole = buildOperatorRole(DataScopeEnum.DEPT_AND_CHILD.getScope());
        doReturn(List.of(operatorRole)).when(permissionService).getEnableUserRoleListByUserIdFromCache(20L);
        when(roleService.hasAnySuperAdmin(Set.of(2L))).thenReturn(false);
        when(userRoleMapper.selectListByUserId(30L)).thenReturn(Collections.emptyList());

        RoleDO targetRole = new RoleDO();
        targetRole.setId(6L);
        targetRole.setCode("dept_and_child_role");
        targetRole.setRoleType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        targetRole.setDataScope(DataScopeEnum.DEPT_AND_CHILD.getScope());
        when(roleService.getRoleList(Set.of(6L))).thenReturn(List.of(targetRole));

        DeptDataPermissionRespDTO operatorPerm = new DeptDataPermissionRespDTO();
        operatorPerm.setAll(false);
        operatorPerm.setDeptIds(Set.of(100L, 200L));
        doReturn(operatorPerm).when(permissionService).getDeptDataPermission(20L);
        when(deptService.getChildDeptIdListFromCache(200L)).thenReturn(Set.of(201L));

        assertThatThrownBy(() -> permissionService.assignUserRole(30L, Set.of(6L)))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        verify(userRoleMapper, never()).insertBatch(org.mockito.ArgumentMatchers.any());
    }

    /** 验证自定义部门角色已有外部持有人时，非超管修改该角色数据范围会被拒绝，避免隐式开放持有人所属部门。 */
    @Test
    void assignRoleDataScopeRejectsDeptCustomWhenExistingHolderDeptOutOfOperatorScope() {
        setLoginUser(20L);
        RoleDO targetRole = new RoleDO();
        targetRole.setId(5L);
        targetRole.setRoleType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(roleService.getRole(5L)).thenReturn(targetRole);
        when(userService.getLoginUserTypeOrDefault()).thenReturn(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());

        RoleDO operatorRole = buildOperatorRole(DataScopeEnum.DEPT_CUSTOM.getScope());
        doReturn(List.of(operatorRole)).when(permissionService).getEnableUserRoleListByUserIdFromCache(20L);
        when(roleService.hasAnySuperAdmin(Set.of(2L))).thenReturn(false);

        DeptDataPermissionRespDTO operatorPerm = new DeptDataPermissionRespDTO();
        operatorPerm.setAll(false);
        operatorPerm.setDeptIds(Set.of(100L));
        doReturn(operatorPerm).when(permissionService).getDeptDataPermission(20L);

        UserRoleDO existingHolder = new UserRoleDO();
        existingHolder.setUserId(30L);
        existingHolder.setRoleId(5L);
        when(userRoleMapper.selectListByRoleIds(Collections.singleton(5L))).thenReturn(List.of(existingHolder));

        AdminUserDO externalHolder = new AdminUserDO();
        externalHolder.setId(30L);
        externalHolder.setDeptId(200L);
        when(userService.getUserList(Set.of(30L))).thenReturn(List.of(externalHolder));

        assertThatThrownBy(() -> permissionService.assignRoleDataScope(
                5L, DataScopeEnum.DEPT_CUSTOM.getScope(), Set.of(100L)))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        verify(roleService, never()).updateRoleDataScope(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    /** 构造业务管理平台操作员启用角色。 */
    private static RoleDO buildOperatorRole(Integer dataScope) {
        RoleDO operatorRole = new RoleDO();
        operatorRole.setId(2L);
        operatorRole.setCode("dept_admin");
        operatorRole.setRoleType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        operatorRole.setStatus(CommonStatusEnum.ENABLE.getStatus());
        operatorRole.setDataScope(dataScope);
        return operatorRole;
    }

    /** 设置当前线程登录用户上下文。 */
    private static void setLoginUser(Long userId) {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(userId);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(loginUser, null));
    }

}
