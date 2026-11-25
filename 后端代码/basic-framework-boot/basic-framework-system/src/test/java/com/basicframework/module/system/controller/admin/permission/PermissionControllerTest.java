package com.basicframework.module.system.controller.admin.permission;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.module.system.service.permission.MenuService;
import com.basicframework.module.system.service.permission.PermissionService;
import com.basicframework.module.system.service.permission.RoleService;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static com.basicframework.module.system.enums.ErrorCodeConstants.ROLE_NOT_EXISTS;
import static com.basicframework.module.system.enums.ErrorCodeConstants.USER_NOT_EXISTS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证权限控制器在数据权限过滤导致用户/角色不可见时的 fail-closed 行为。
 *
 * @author shady
 */
@ExtendWith(MockitoExtension.class)
class PermissionControllerTest {

    @Mock
    private PermissionService permissionService;
    @Mock
    private RoleService roleService;
    @Mock
    private MenuService menuService;
    @Mock
    private AdminUserService userService;

    @InjectMocks
    private PermissionController controller;

    /** 验证跨部门用户被数据权限过滤返回 null 时，listAdminRoles 必须拒绝且不得直查 system_user_role。 */
    @Test
    void listAdminRolesShouldFailClosedWhenUserInvisible() {
        when(userService.getUser(99L)).thenReturn(null);

        assertThatThrownBy(() -> controller.listAdminRoles(99L))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(USER_NOT_EXISTS.getCode()));
        verify(permissionService, never()).getUserRoleIdListByUserId(99L);
    }

    /** 验证角色不存在或不可见时，getRoleMenuList 必须拒绝且不得查询角色菜单绑定。 */
    @Test
    void getRoleMenuListShouldFailClosedWhenRoleMissing() {
        when(roleService.getRole(88L)).thenReturn(null);

        assertThatThrownBy(() -> controller.getRoleMenuList(88L))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ROLE_NOT_EXISTS.getCode()));
        verify(permissionService, never()).getRoleMenuListByRoleId(88L);
    }
}
