package com.basicframework.module.system.service.permission;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.module.system.controller.admin.permission.vo.menu.MenuSaveVO;
import com.basicframework.module.system.dal.dataobject.permission.MenuDO;
import com.basicframework.module.system.dal.mysql.permission.MenuMapper;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.permission.MenuTypeEnum;
import com.basicframework.module.system.enums.permission.RoleCodeEnum;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import static com.basicframework.module.system.enums.ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
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
        when(permissionServiceProvider.getIfAvailable()).thenReturn(permissionService);
        when(permissionService.hasAnyRoles(20L, RoleCodeEnum.SUPER_ADMIN.getCode())).thenReturn(false);

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
        when(permissionServiceProvider.getIfAvailable()).thenReturn(permissionService);
        when(permissionServiceProvider.getObject()).thenReturn(permissionService);
        when(permissionService.hasAnyRoles(20L, RoleCodeEnum.SUPER_ADMIN.getCode())).thenReturn(false);
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

    /** 设置当前线程登录用户。 */
    private static void setLoginUser(Long userId) {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(userId);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(loginUser, null));
    }

}
