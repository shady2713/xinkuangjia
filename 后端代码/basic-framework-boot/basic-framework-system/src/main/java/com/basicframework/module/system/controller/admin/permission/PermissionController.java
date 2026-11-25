package com.basicframework.module.system.controller.admin.permission;


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

import io.swagger.v3.oas.annotations.tags.Tag;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.Operation;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import jakarta.annotation.Resource;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.Set;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.pojo.CommonResult.success;
import static com.basicframework.framework.common.util.collection.CollectionUtils.convertSet;

/**
 * 权限 Controller，提供赋予用户、角色的权限的 API 接口
 *
 * @author shady
 */
@Tag(name = "管理后台 - 权限")
@RestController
@RequestMapping("/system/permission")
@Validated
public class PermissionController {

    @Resource
    private PermissionService permissionService;
    @Resource
    private RoleService roleService;
    @Resource
    private MenuService menuService;
    @Resource
    private AdminUserService userService;


    /**
     * 获取角色菜单列表。
     *
     * @param roleId 角色编号
     * @return 查询结果
     */
    @Operation(summary = "获得角色拥有的菜单编号")
    @Parameter(name = "roleId", description = "角色编号", required = true)
    @GetMapping("/list-role-menus")
    @PreAuthorize("@ss.hasPermission('system:permission:assign-role-menu')")
    public CommonResult<Set<Long>> getRoleMenuList(@RequestParam("roleId") @NotNull(message = "角色编号不能为空") Long roleId) {
        RoleDO role = roleService.getRole(roleId);
        if (role == null) {
            throw exception(ErrorCodeConstants.ROLE_NOT_EXISTS);
        }
        validateRolePlatform(role);
        Set<Long> menuIds = permissionService.getRoleMenuListByRoleId(roleId);
        String loginUserType = getLoginUserType();
        return success(convertSet(menuService.getMenuList(menuIds).stream()
                .filter(menu -> AdminPlatformTypeEnum.isSame(menu.getMenuType(), loginUserType))
                .toList(), MenuDO::getId));
    }

    /**
     * 完成 assignRoleMenu 对应的业务处理。
     *
     * @param reqVO 请求参数
     * @return 方法处理结果
     */
    @PostMapping("/assign-role-menu")
    @Operation(summary = "赋予角色菜单")
    @PreAuthorize("@ss.hasPermission('system:permission:assign-role-menu')")
    public CommonResult<Boolean> assignRoleMenu(@Validated @RequestBody PermissionAssignRoleMenuReqVO reqVO) {
        // 执行菜单的分配
        permissionService.assignRoleMenu(reqVO.getRoleId(), reqVO.getMenuIds());
        return success(true);
    }

    /**
     * 完成 assignRoleDataScope 对应的业务处理。
     *
     * @param reqVO 请求参数
     * @return 方法处理结果
     */
    @PostMapping("/assign-role-data-scope")
    @Operation(summary = "赋予角色数据权限")
    @PreAuthorize("@ss.hasPermission('system:permission:assign-role-data-scope')")
    public CommonResult<Boolean> assignRoleDataScope(@Valid @RequestBody PermissionAssignRoleDataScopeReqVO reqVO) {
        permissionService.assignRoleDataScope(reqVO.getRoleId(), reqVO.getDataScope(), reqVO.getDataScopeDeptIds());
        return success(true);
    }

    /**
     * 完成 listAdminRoles 对应的业务处理。
     *
     * @param userId 用户编号
     * @return 查询结果
     */
    @Operation(summary = "获得管理员拥有的角色编号列表")
    @Parameter(name = "userId", description = "用户编号", required = true)
    @GetMapping("/list-user-roles")
    @PreAuthorize("@ss.hasPermission('system:permission:assign-user-role')")
    public CommonResult<Set<Long>> listAdminRoles(@RequestParam("userId") @NotNull(message = "用户编号不能为空") Long userId) {
        // 先经带部门数据权限过滤的 getUser 校验目标用户可见性，不可见时 fail-closed 拒绝，防止直查 system_user_role 越权。
        AdminUserDO user = userService.getUser(userId);
        if (user == null) {
            throw exception(ErrorCodeConstants.USER_NOT_EXISTS);
        }
        validateUserPlatform(user);
        Set<Long> roleIds = permissionService.getUserRoleIdListByUserId(userId);
        String loginUserType = getLoginUserType();
        return success(convertSet(roleService.getRoleList(roleIds).stream()
                .filter(role -> AdminPlatformTypeEnum.isSame(role.getRoleType(), loginUserType))
                .toList(), RoleDO::getId));
    }

    /**
     * 完成 assignUserRole 对应的业务处理。
     *
     * @param reqVO 请求参数
     * @return 方法处理结果
     */
    @Operation(summary = "赋予用户角色")
    @PostMapping("/assign-user-role")
    @PreAuthorize("@ss.hasPermission('system:permission:assign-user-role')")
    public CommonResult<Boolean> assignUserRole(@Validated @RequestBody PermissionAssignUserRoleReqVO reqVO) {
        permissionService.assignUserRole(reqVO.getUserId(), reqVO.getRoleIds());
        return success(true);
    }

    /**
     * 获取登录用户类型。
     */
    private String getLoginUserType() {
        return userService.getLoginUserTypeOrDefault();
    }

    /**
     * 校验 validateRolePlatform 对应的输入与业务约束。
     */
    private void validateRolePlatform(RoleDO role) {
        // 角色平台类型是授权隔离边界，当前平台不能读取另一个平台角色的菜单授权。
        if (role != null && !AdminPlatformTypeEnum.isSame(role.getRoleType(), getLoginUserType())) {
            throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
        }
    }

    /**
     * 校验 validateUserPlatform 对应的输入与业务约束。
     */
    private void validateUserPlatform(AdminUserDO user) {
        // 用户平台类型是账号隔离边界，当前平台不能读取另一个平台用户的角色授权。
        if (user != null && !AdminPlatformTypeEnum.isSame(user.getUserType(), getLoginUserType())) {
            throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
        }
    }

}
