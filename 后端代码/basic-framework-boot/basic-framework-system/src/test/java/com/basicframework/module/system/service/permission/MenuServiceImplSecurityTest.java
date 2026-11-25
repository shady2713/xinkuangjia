package com.basicframework.module.system.service.permission;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.module.system.controller.admin.permission.vo.menu.MenuSaveVO;
import com.basicframework.module.system.dal.dataobject.permission.MenuDO;
import com.basicframework.module.system.dal.mysql.permission.MenuMapper;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.permission.MenuTypeEnum;
import com.basicframework.module.system.enums.permission.RoleCodeEnum;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Set;

import static com.basicframework.module.system.enums.ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证 {@link MenuServiceImpl} 禁止非超管通过修改或新增菜单权限标识实现越权提权。
 *
 * @author shady2713
 */
@ExtendWith(MockitoExtension.class)
class MenuServiceImplSecurityTest {

    @Mock
    private MenuMapper menuMapper;
    @Mock
    private ObjectProvider<PermissionService> permissionServiceProvider;
    @Mock
    private PermissionService permissionService;
    @Mock
    private ObjectProvider<AdminUserService> adminUserServiceProvider;
    @Mock
    private AdminUserService adminUserService;

    @InjectMocks
    private MenuServiceImpl menuService;

    /** 清理安全上下文，防止跨用例污染。 */
    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    /** 验证非超管操作员修改已有菜单的 permission 字段时被拒绝。 */
    @Test
    void updateMenuRejectsPermissionMutationByNonSuperAdmin() {
        setLoginUser(20L);
        stubNonSuperAdminPlatform(20L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());

        MenuDO oldMenu = new MenuDO();
        oldMenu.setId(100L);
        oldMenu.setMenuType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        oldMenu.setPermission("system:user:query");
        when(menuMapper.selectById(100L)).thenReturn(oldMenu);

        MenuSaveVO updateReqVO = new MenuSaveVO();
        updateReqVO.setId(100L);
        updateReqVO.setParentId(MenuDO.ID_ROOT);
        updateReqVO.setName("用户删除");
        updateReqVO.setType(MenuTypeEnum.BUTTON.getType());
        updateReqVO.setMenuType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        updateReqVO.setPermission("system:user:delete");

        assertThatThrownBy(() -> menuService.updateMenu(updateReqVO))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        verify(menuMapper, never()).updateById(any(MenuDO.class));
    }

    /** 验证非超管操作员创建携带自身未持有权限标识的菜单时被拒绝。 */
    @Test
    void createMenuRejectsUnownedPermissionByNonSuperAdmin() {
        setLoginUser(20L);
        stubNonSuperAdminPlatform(20L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(permissionService.hasAnyPermissions(20L, "system:role:delete")).thenReturn(false);

        MenuSaveVO createReqVO = new MenuSaveVO();
        createReqVO.setParentId(MenuDO.ID_ROOT);
        createReqVO.setName("危险按钮");
        createReqVO.setType(MenuTypeEnum.BUTTON.getType());
        createReqVO.setMenuType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        createReqVO.setPermission("system:role:delete");

        assertThatThrownBy(() -> menuService.createMenu(createReqVO))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        verify(menuMapper, never()).insert(any(MenuDO.class));
    }

    /** 验证非超管修改菜单状态或父节点时被拒绝（防止自启用禁用菜单或停用菜单反锁超管）。 */
    @Test
    void updateMenuRejectsStatusOrParentMutationByNonSuperAdmin() {
        setLoginUser(20L);
        stubNonSuperAdminPlatform(20L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(permissionService.getUserRoleIdListByUserIdFromCache(20L)).thenReturn(Set.of(5L));
        when(permissionService.getRoleMenuListByRoleId(Set.of(5L))).thenReturn(Set.of(100L));
        when(permissionService.hasAnyPermissions(20L, "system:user:query")).thenReturn(true);

        MenuDO oldMenu = new MenuDO();
        oldMenu.setId(100L);
        oldMenu.setParentId(1L);
        oldMenu.setStatus(1);
        oldMenu.setMenuType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        oldMenu.setPermission("system:user:query");
        when(menuMapper.selectById(100L)).thenReturn(oldMenu);

        MenuSaveVO updateReqVO = new MenuSaveVO();
        updateReqVO.setId(100L);
        updateReqVO.setParentId(1L);
        updateReqVO.setStatus(0);
        updateReqVO.setName("用户查询");
        updateReqVO.setType(MenuTypeEnum.BUTTON.getType());
        updateReqVO.setMenuType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        updateReqVO.setPermission("system:user:query");

        assertThatThrownBy(() -> menuService.updateMenu(updateReqVO))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        verify(menuMapper, never()).updateById(any(MenuDO.class));
    }

    /** 验证无登录上下文时更新与删除菜单均 fail-closed 拒绝。 */
    @Test
    void updateAndDeleteMenuRejectWhenNoOperatorLoginContext() {
        MenuDO oldMenu = new MenuDO();
        oldMenu.setId(100L);
        when(menuMapper.selectById(100L)).thenReturn(oldMenu);

        MenuSaveVO updateReqVO = new MenuSaveVO();
        updateReqVO.setId(100L);
        updateReqVO.setName("无登录态更新");

        assertThatThrownBy(() -> menuService.updateMenu(updateReqVO))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        verify(menuMapper, never()).updateById(any(MenuDO.class));

        when(menuMapper.selectCountByParentId(100L)).thenReturn(0L);
        assertThatThrownBy(() -> menuService.deleteMenu(100L))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        verify(menuMapper, never()).deleteById(any(Long.class));
    }

    /** 验证非超管对 permission 为空但自身角色未授权的目录/页面菜单不得编辑或删除。 */
    @Test
    void nonSuperAdminCannotEditOrDeleteUnownedDirectoryWithEmptyPermission() {
        setLoginUser(20L);
        stubNonSuperAdminPlatform(20L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(permissionService.getUserRoleIdListByUserIdFromCache(20L)).thenReturn(Set.of(5L));
        when(permissionService.getRoleMenuListByRoleId(Set.of(5L))).thenReturn(Set.of(200L));

        MenuDO unownedDir = new MenuDO();
        unownedDir.setId(100L);
        unownedDir.setParentId(MenuDO.ID_ROOT);
        unownedDir.setStatus(0);
        unownedDir.setMenuType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        unownedDir.setPermission("");
        when(menuMapper.selectById(100L)).thenReturn(unownedDir);

        MenuSaveVO updateReqVO = new MenuSaveVO();
        updateReqVO.setId(100L);
        updateReqVO.setParentId(MenuDO.ID_ROOT);
        updateReqVO.setStatus(0);
        updateReqVO.setName("篡改目录");
        updateReqVO.setType(MenuTypeEnum.DIR.getType());
        updateReqVO.setMenuType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        updateReqVO.setPermission("");

        assertThatThrownBy(() -> menuService.updateMenu(updateReqVO))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        verify(menuMapper, never()).updateById(any(MenuDO.class));

        when(menuMapper.selectCountByParentId(100L)).thenReturn(0L);
        assertThatThrownBy(() -> menuService.deleteMenu(100L))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        verify(menuMapper, never()).deleteById(any(Long.class));
    }

    private void stubNonSuperAdminPlatform(Long userId, String platformType) {
        lenient().when(permissionServiceProvider.getIfAvailable()).thenReturn(permissionService);
        lenient().when(permissionServiceProvider.getObject()).thenReturn(permissionService);
        lenient().when(permissionService.hasAnyRoles(userId, RoleCodeEnum.SUPER_ADMIN.getCode())).thenReturn(false);
        lenient().when(adminUserServiceProvider.getIfAvailable()).thenReturn(adminUserService);
        lenient().when(adminUserService.getLoginUserTypeOrDefault()).thenReturn(platformType);
    }

    /** 设置当前线程登录用户。 */
    private static void setLoginUser(Long userId) {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(userId);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(loginUser, null));
    }

}
