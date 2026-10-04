package com.basicframework.module.system.controller.admin.permission;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.module.system.controller.admin.permission.vo.menu.MenuListReqVO;
import com.basicframework.module.system.controller.admin.permission.vo.menu.MenuRespVO;
import com.basicframework.module.system.controller.admin.permission.vo.menu.MenuSaveVO;
import com.basicframework.module.system.controller.admin.permission.vo.menu.MenuSimpleRespVO;
import com.basicframework.module.system.dal.dataobject.permission.MenuDO;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.service.permission.MenuService;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证菜单管理接口的平台归属强制、排序、精简列表组装与越权拒绝契约。
 *
 * <p>菜单树决定前端可见路由与按钮权限，菜单的平台类型是两套管理平台之间的隔离边界。用例固定
 * 以下可观察行为：写操作以当前登录平台覆盖客户端提交的平台类型；读取、修改、删除另一个平台的
 * 菜单被拒绝；列表按排序值升序返回；精简列表只取启用状态并按当前平台过滤。</p>
 *
 * @author shady2713
 */
class MenuControllerTest {

    /** 被测控制器。 */
    private MenuController controller;
    /** 菜单服务替身。 */
    private MenuService menuService;
    /** 用户服务替身，同时提供当前登录平台类型。 */
    private AdminUserService userService;

    /** 为每个用例装配独立控制器与替身。 */
    @BeforeEach
    void setUp() {
        controller = new MenuController();
        menuService = mock(MenuService.class);
        userService = mock(AdminUserService.class);
        ReflectionTestUtils.setField(controller, "menuService", menuService);
        ReflectionTestUtils.setField(controller, "userService", userService);
        when(userService.getLoginUserTypeOrDefault()).thenReturn(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
    }

    /**
     * 创建菜单必须用当前登录平台覆盖客户端提交的平台类型，并返回新菜单编号。
     */
    @Test
    void createMenuOverridesMenuTypeWithLoginPlatform() {
        MenuSaveVO reqVO = new MenuSaveVO();
        reqVO.setName("系统管理");
        reqVO.setMenuType(AdminPlatformTypeEnum.SUPER_ADMIN.getType());
        when(menuService.createMenu(any())).thenReturn(2048L);

        CommonResult<Long> result = controller.createMenu(reqVO);

        assertThat(result.getData()).isEqualTo(2048L);
        assertThat(reqVO.getMenuType()).as("平台类型必须由服务端决定")
                .isEqualTo(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        verify(menuService).createMenu(reqVO);
    }

    /**
     * 更新菜单必须先校验平台归属，再覆盖平台类型并委派更新。
     */
    @Test
    void updateMenuValidatesPlatformThenOverridesMenuType() {
        MenuSaveVO reqVO = new MenuSaveVO();
        reqVO.setId(9L);
        reqVO.setMenuType(AdminPlatformTypeEnum.SUPER_ADMIN.getType());
        when(menuService.getMenu(9L)).thenReturn(menu(9L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));

        CommonResult<Boolean> result = controller.updateMenu(reqVO);

        assertThat(result.getData()).isTrue();
        assertThat(reqVO.getMenuType()).isEqualTo(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        verify(menuService).updateMenu(reqVO);
    }

    /**
     * 更新另一个平台的菜单必须拒绝，且不得触发更新。
     */
    @Test
    void updateMenuRejectsOtherPlatformMenu() {
        MenuSaveVO reqVO = new MenuSaveVO();
        reqVO.setId(9L);
        when(menuService.getMenu(9L)).thenReturn(menu(9L, AdminPlatformTypeEnum.SUPER_ADMIN.getType()));

        assertThatThrownBy(() -> controller.updateMenu(reqVO))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
        verify(menuService, never()).updateMenu(any());
    }

    /**
     * 删除单个菜单必须先校验平台归属再删除。
     */
    @Test
    void deleteMenuValidatesPlatformThenDeletes() {
        when(menuService.getMenu(9L)).thenReturn(menu(9L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));

        assertThat(controller.deleteMenu(9L).getData()).isTrue();
        verify(menuService).deleteMenu(9L);
    }

    /**
     * 批量删除必须逐个校验平台归属，任一菜单越权时整批都不执行。
     */
    @Test
    void deleteMenuListValidatesEveryMenuBeforeDeleting() {
        when(menuService.getMenu(9L)).thenReturn(menu(9L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        when(menuService.getMenu(10L)).thenReturn(menu(10L, AdminPlatformTypeEnum.SUPER_ADMIN.getType()));

        assertThatThrownBy(() -> controller.deleteMenuList(List.of(9L, 10L)))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
        verify(menuService, never()).deleteMenuList(any());

        when(menuService.getMenu(10L)).thenReturn(menu(10L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        assertThat(controller.deleteMenuList(List.of(9L, 10L)).getData()).isTrue();
        verify(menuService).deleteMenuList(List.of(9L, 10L));
    }

    /**
     * 菜单列表必须限定当前平台，并按排序值升序返回。
     */
    @Test
    void getMenuListScopesPlatformAndSortsBySort() {
        MenuListReqVO reqVO = new MenuListReqVO();
        MenuDO later = menu(9L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        later.setSort(20);
        MenuDO earlier = menu(10L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        earlier.setSort(1);
        when(menuService.getMenuList(any(MenuListReqVO.class))).thenReturn(new ArrayList<>(List.of(later, earlier)));

        CommonResult<List<MenuRespVO>> result = controller.getMenuList(reqVO);

        assertThat(reqVO.getMenuType()).isEqualTo(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        assertThat(result.getData()).extracting(MenuRespVO::getId).as("必须按 sort 升序").containsExactly(10L, 9L);
    }

    /**
     * 精简列表必须只请求启用状态与当前平台，并对过滤结果按排序值升序返回。
     */
    @Test
    void getSimpleMenuListRequestsEnabledMenusOfCurrentPlatform() {
        MenuDO later = menu(9L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        later.setSort(20);
        MenuDO earlier = menu(10L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        earlier.setSort(1);
        when(menuService.getMenuListFiltered(any())).thenReturn(new ArrayList<>(List.of(later, earlier)));
        when(menuService.filterDisableMenus(any())).thenAnswer(invocation -> invocation.getArgument(0));

        CommonResult<List<MenuSimpleRespVO>> result = controller.getSimpleMenuList();

        ArgumentCaptor<MenuListReqVO> request = ArgumentCaptor.forClass(MenuListReqVO.class);
        verify(menuService).getMenuListFiltered(request.capture());
        assertThat(request.getValue().getStatus()).isEqualTo(CommonStatusEnum.ENABLE.getStatus());
        assertThat(request.getValue().getMenuType()).isEqualTo(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        assertThat(result.getData()).extracting(MenuSimpleRespVO::getId).containsExactly(10L, 9L);
    }

    /**
     * 单条查询必须校验平台归属并转换为响应模型。
     */
    @Test
    void getMenuConvertsRecordAndValidatesPlatform() {
        MenuDO menu = menu(9L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        menu.setName("系统管理");
        menu.setPermission("system:menu:query");
        when(menuService.getMenu(9L)).thenReturn(menu);

        CommonResult<MenuRespVO> result = controller.getMenu(9L);

        assertThat(result.getData().getId()).isEqualTo(9L);
        assertThat(result.getData().getName()).isEqualTo("系统管理");
        assertThat(result.getData().getPermission()).isEqualTo("system:menu:query");
    }

    /**
     * 查询另一个平台的菜单必须拒绝。
     */
    @Test
    void getMenuRejectsOtherPlatformMenu() {
        when(menuService.getMenu(9L)).thenReturn(menu(9L, AdminPlatformTypeEnum.SUPER_ADMIN.getType()));

        assertThatThrownBy(() -> controller.getMenu(9L))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
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

}
