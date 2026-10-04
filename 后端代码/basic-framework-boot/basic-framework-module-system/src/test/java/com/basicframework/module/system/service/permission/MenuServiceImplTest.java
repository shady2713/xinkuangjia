package com.basicframework.module.system.service.permission;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.exception.ErrorCode;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.module.system.controller.admin.permission.vo.menu.MenuListReqVO;
import com.basicframework.module.system.controller.admin.permission.vo.menu.MenuSaveVO;
import com.basicframework.module.system.dal.dataobject.permission.MenuDO;
import com.basicframework.module.system.dal.mysql.permission.MenuMapper;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.permission.MenuTypeEnum;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证菜单服务的层级约束、平台隔离、按钮属性清理、禁用菜单过滤与删除前置检查。
 *
 * <p>菜单树决定前端路由与按钮权限，以下边界决定可用性与隔离性：不能把自己设为父菜单；父菜单必须存在
 * 且只能是目录或菜单类型；同一父级下菜单名唯一、组件名全局唯一（更新自身不算冲突）；跨管理平台的父子
 * 挂接必须拒绝，否则一个平台会把另一个平台的菜单带进自己的路由；按钮类型不携带组件、图标与路径，
 * 创建与更新时必须清空，避免脏数据残留。</p>
 *
 * <p>禁用菜单过滤必须沿父链递归判定：自身禁用、任一祖先禁用或父节点缺失都会被过滤，根节点不再向上查找；
 * 已经判定为禁用的节点要进入缓存，避免同一批次内重复递归。</p>
 *
 * <p>持久层与权限服务按进程外边界替换为替身，服务内的树形校验、属性初始化与异常逻辑真实执行。
 * 其中"父菜单在存在性校验与平台校验之间被并发删除"的用例用连续返回值模拟两次查询之间的真实竞态，
 * 记录平台校验在父菜单消失时直接放行的可观察结果。</p>
 *
 * @author shady2713
 */
class MenuServiceImplTest {

    /** 被测服务。 */
    private MenuServiceImpl menuService;
    /** 菜单持久层替身。 */
    private MenuMapper menuMapper;
    /** 权限服务替身，用于验证删除菜单后的关联清理。 */
    private PermissionService permissionService;

    /** 装配服务与替身。 */
    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        menuService = new MenuServiceImpl();
        menuMapper = mock(MenuMapper.class);
        permissionService = mock(PermissionService.class);
        ObjectProvider<PermissionService> permissionServiceProvider = mock(ObjectProvider.class);
        when(permissionServiceProvider.getObject()).thenReturn(permissionService);
        ReflectionTestUtils.setField(menuService, "menuMapper", menuMapper);
        ReflectionTestUtils.setField(menuService, "permissionServiceProvider", permissionServiceProvider);
    }

    /** 创建菜单必须完成父级、名称与组件名校验，补齐平台类型并返回新编号。 */
    @Test
    void createMenuValidatesAndInitializesProperties() {
        MenuSaveVO reqVO = saveReqVO(null, "DUMMY-菜单", MenuTypeEnum.MENU.getType(), MenuDO.ID_ROOT);
        reqVO.setMenuType(null);
        when(menuMapper.selectByParentIdAndName(MenuDO.ID_ROOT, "DUMMY-菜单")).thenReturn(null);
        when(menuMapper.selectByComponentName("DUMMY-组件")).thenReturn(null);
        doAnswer(invocation -> {
            invocation.getArgument(0, MenuDO.class).setId(100L);
            return 1;
        }).when(menuMapper).insert(any(MenuDO.class));

        Long id = menuService.createMenu(reqVO);

        assertThat(id).as("创建结果必须返回落库后的主键").isEqualTo(100L);
        ArgumentCaptor<MenuDO> captor = ArgumentCaptor.forClass(MenuDO.class);
        verify(menuMapper).insert(captor.capture());
        MenuDO inserted = captor.getValue();
        assertThat(inserted.getMenuType()).as("平台类型缺省按历史业务平台处理")
                .isEqualTo(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        assertThat(inserted.getComponent()).as("菜单类型保留组件与路径").isEqualTo("DUMMY-视图");
        assertThat(inserted.getPath()).isEqualTo("/dummy");
    }

    /** 创建按钮类型菜单时必须清空组件、组件名、图标与路径。 */
    @Test
    void createButtonMenuClearsViewProperties() {
        MenuSaveVO reqVO = saveReqVO(null, "DUMMY-按钮", MenuTypeEnum.BUTTON.getType(), 5L);
        when(menuMapper.selectById(5L)).thenReturn(menu(5L, "DUMMY-父菜单", MenuTypeEnum.MENU.getType(),
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        when(menuMapper.selectByParentIdAndName(5L, "DUMMY-按钮")).thenReturn(null);
        when(menuMapper.selectByComponentName("DUMMY-组件")).thenReturn(null);

        menuService.createMenu(reqVO);

        ArgumentCaptor<MenuDO> captor = ArgumentCaptor.forClass(MenuDO.class);
        verify(menuMapper).insert(captor.capture());
        MenuDO inserted = captor.getValue();
        assertThat(inserted.getComponent()).isEmpty();
        assertThat(inserted.getComponentName()).isEmpty();
        assertThat(inserted.getIcon()).isEmpty();
        assertThat(inserted.getPath()).isEmpty();
    }

    /** 创建菜单在父菜单不存在、父菜单是按钮、名称重复、组件名重复时必须拒绝且不落库。 */
    @Test
    void createMenuRejectsInvalidHierarchyAndDuplicates() {
        MenuSaveVO parentMissing = saveReqVO(null, "DUMMY-菜单", MenuTypeEnum.MENU.getType(), 5L);
        when(menuMapper.selectById(5L)).thenReturn(null);
        assertBusinessError(() -> menuService.createMenu(parentMissing),
                ErrorCodeConstants.MENU_PARENT_NOT_EXISTS);

        MenuSaveVO parentIsButton = saveReqVO(null, "DUMMY-菜单", MenuTypeEnum.MENU.getType(), 5L);
        when(menuMapper.selectById(5L)).thenReturn(menu(5L, "DUMMY-父按钮", MenuTypeEnum.BUTTON.getType(),
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        assertBusinessError(() -> menuService.createMenu(parentIsButton),
                ErrorCodeConstants.MENU_PARENT_NOT_DIR_OR_MENU);

        MenuSaveVO duplicateName = saveReqVO(null, "DUMMY-菜单", MenuTypeEnum.MENU.getType(), MenuDO.ID_ROOT);
        when(menuMapper.selectByParentIdAndName(MenuDO.ID_ROOT, "DUMMY-菜单"))
                .thenReturn(menu(6L, "DUMMY-菜单", MenuTypeEnum.MENU.getType(),
                        AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        assertBusinessError(() -> menuService.createMenu(duplicateName), ErrorCodeConstants.MENU_NAME_DUPLICATE);

        MenuSaveVO duplicateComponent = saveReqVO(null, "DUMMY-其它菜单", MenuTypeEnum.MENU.getType(), MenuDO.ID_ROOT);
        when(menuMapper.selectByParentIdAndName(MenuDO.ID_ROOT, "DUMMY-其它菜单")).thenReturn(null);
        when(menuMapper.selectByComponentName("DUMMY-组件")).thenReturn(menu(7L, "DUMMY-其它菜单",
                MenuTypeEnum.MENU.getType(), AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        assertBusinessError(() -> menuService.createMenu(duplicateComponent),
                ErrorCodeConstants.MENU_COMPONENT_NAME_DUPLICATE);

        verify(menuMapper, never()).insert(any(MenuDO.class));
    }

    /** 跨平台挂接父菜单必须拒绝，避免一个平台把另一个平台的菜单带进自己的路由。 */
    @Test
    void createMenuRejectsCrossPlatformParent() {
        MenuSaveVO reqVO = saveReqVO(null, "DUMMY-菜单", MenuTypeEnum.MENU.getType(), 5L);
        reqVO.setMenuType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(menuMapper.selectById(5L)).thenReturn(menu(5L, "DUMMY-超级平台目录", MenuTypeEnum.DIR.getType(),
                AdminPlatformTypeEnum.SUPER_ADMIN.getType()));

        assertBusinessError(() -> menuService.createMenu(reqVO), ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
        verify(menuMapper, never()).insert(any(MenuDO.class));
    }

    /** 更新菜单必须校验存在性与层级约束，通过后按编号写库并补齐平台类型。 */
    @Test
    void updateMenuValidatesThenWrites() {
        MenuSaveVO reqVO = saveReqVO(1L, "DUMMY-菜单", MenuTypeEnum.MENU.getType(), MenuDO.ID_ROOT);
        reqVO.setMenuType(null);
        when(menuMapper.selectById(1L)).thenReturn(menu(1L, "DUMMY-菜单", MenuTypeEnum.MENU.getType(),
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        when(menuMapper.selectByParentIdAndName(MenuDO.ID_ROOT, "DUMMY-菜单")).thenReturn(null);
        when(menuMapper.selectByComponentName("DUMMY-组件")).thenReturn(null);

        menuService.updateMenu(reqVO);

        ArgumentCaptor<MenuDO> captor = ArgumentCaptor.forClass(MenuDO.class);
        verify(menuMapper).updateById(captor.capture());
        assertThat(captor.getValue().getId()).isEqualTo(1L);
        assertThat(captor.getValue().getMenuType()).isEqualTo(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
    }

    /** 更新不存在的菜单必须拒绝；把自己设为父菜单同样必须拒绝且不写库。 */
    @Test
    void updateMenuRejectsMissingAndSelfParent() {
        MenuSaveVO absent = saveReqVO(9L, "DUMMY-菜单", MenuTypeEnum.MENU.getType(), MenuDO.ID_ROOT);
        when(menuMapper.selectById(9L)).thenReturn(null);
        assertBusinessError(() -> menuService.updateMenu(absent), ErrorCodeConstants.MENU_NOT_EXISTS);

        MenuSaveVO selfParent = saveReqVO(1L, "DUMMY-菜单", MenuTypeEnum.MENU.getType(), 1L);
        when(menuMapper.selectById(1L)).thenReturn(menu(1L, "DUMMY-菜单", MenuTypeEnum.MENU.getType(),
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        assertBusinessError(() -> menuService.updateMenu(selfParent), ErrorCodeConstants.MENU_PARENT_ERROR);

        verify(menuMapper, never()).updateById(any(MenuDO.class));
    }

    /** 删除菜单必须先确认没有子菜单，再确认菜单存在，通过后删除并清理角色权限。 */
    @Test
    void deleteMenuChecksChildrenThenCleansPermissions() {
        when(menuMapper.selectCountByParentId(1L)).thenReturn(1L);
        assertBusinessError(() -> menuService.deleteMenu(1L), ErrorCodeConstants.MENU_EXISTS_CHILDREN);

        when(menuMapper.selectCountByParentId(1L)).thenReturn(0L);
        when(menuMapper.selectById(1L)).thenReturn(null);
        assertBusinessError(() -> menuService.deleteMenu(1L), ErrorCodeConstants.MENU_NOT_EXISTS);

        when(menuMapper.selectById(1L)).thenReturn(menu(1L, "DUMMY-菜单", MenuTypeEnum.MENU.getType(),
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        menuService.deleteMenu(1L);

        verify(menuMapper).deleteById(1L);
        verify(permissionService).processMenuDeleted(1L);
    }

    /** 批量删除必须逐条检查子菜单，任一存在子菜单时整体拒绝且不删除。 */
    @Test
    void deleteMenuListRejectsWhenAnyMenuHasChildren() {
        when(menuMapper.selectCountByParentId(1L)).thenReturn(0L);
        when(menuMapper.selectCountByParentId(2L)).thenReturn(1L);

        assertBusinessError(() -> menuService.deleteMenuList(List.of(1L, 2L)),
                ErrorCodeConstants.MENU_EXISTS_CHILDREN);
        verify(menuMapper, never()).deleteByIds(anyCollection());
    }

    /** 批量删除通过后必须一次性删除，并对每个编号清理角色权限。 */
    @Test
    void deleteMenuListDeletesOnceAndCleansEachPermission() {
        when(menuMapper.selectCountByParentId(1L)).thenReturn(0L);
        when(menuMapper.selectCountByParentId(2L)).thenReturn(0L);

        menuService.deleteMenuList(List.of(1L, 2L));

        verify(menuMapper).deleteByIds(List.of(1L, 2L));
        verify(permissionService).processMenuDeleted(1L);
        verify(permissionService).processMenuDeleted(2L);
    }

    /** 查询方法必须原样转发到持久层；空编号集合直接返回空列表且不访问持久层。 */
    @Test
    void queryMethodsDelegateToMapper() {
        when(menuMapper.selectList()).thenReturn(List.of(menu(1L, "DUMMY-菜单", MenuTypeEnum.MENU.getType(),
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType())));
        assertThat(menuService.getMenuList()).hasSize(1);

        when(menuMapper.selectListByMenuType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()))
                .thenReturn(List.of(menu(1L, "DUMMY-菜单", MenuTypeEnum.MENU.getType(),
                        AdminPlatformTypeEnum.BUSINESS_ADMIN.getType())));
        assertThat(menuService.getMenuListByMenuType(null)).hasSize(1);

        MenuListReqVO reqVO = new MenuListReqVO();
        when(menuMapper.selectList(reqVO)).thenReturn(List.of(menu(1L, "DUMMY-菜单", MenuTypeEnum.MENU.getType(),
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType())));
        assertThat(menuService.getMenuListFiltered(reqVO)).hasSize(1);

        when(menuMapper.selectListByPermission("system:menu:query"))
                .thenReturn(List.of(menu(1L, "DUMMY-菜单", MenuTypeEnum.MENU.getType(),
                        AdminPlatformTypeEnum.BUSINESS_ADMIN.getType())));
        assertThat(menuService.getMenuIdListByPermissionFromCache("system:menu:query")).containsExactly(1L);

        when(menuMapper.selectById(1L)).thenReturn(menu(1L, "DUMMY-菜单", MenuTypeEnum.MENU.getType(),
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        assertThat(menuService.getMenu(1L).getName()).isEqualTo("DUMMY-菜单");

        when(menuMapper.selectByIds(List.of(1L))).thenReturn(List.of(menu(1L, "DUMMY-菜单",
                MenuTypeEnum.MENU.getType(), AdminPlatformTypeEnum.BUSINESS_ADMIN.getType())));
        assertThat(menuService.getMenuList(List.of(1L))).hasSize(1);
        assertThat(menuService.getMenuList(Collections.<Long>emptyList())).isEmpty();
        verify(menuMapper, never()).selectByIds(Collections.emptyList());
    }

    /** 父菜单在存在性校验与平台校验之间被并发删除时，平台校验按无父菜单放行。 */
    @Test
    void createMenuToleratesParentDeletedBetweenChecks() {
        MenuSaveVO reqVO = saveReqVO(null, "DUMMY-菜单", MenuTypeEnum.MENU.getType(), 5L);
        when(menuMapper.selectById(5L)).thenReturn(menu(5L, "DUMMY-父菜单", MenuTypeEnum.MENU.getType(),
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()), (MenuDO) null);
        when(menuMapper.selectByParentIdAndName(5L, "DUMMY-菜单")).thenReturn(null);
        when(menuMapper.selectByComponentName("DUMMY-组件")).thenReturn(null);

        menuService.createMenu(reqVO);

        ArgumentCaptor<MenuDO> captor = ArgumentCaptor.forClass(MenuDO.class);
        verify(menuMapper).insert(captor.capture());
        assertThat(captor.getValue().getParentId()).as("并发删除父菜单时不会拒绝创建，可能留下悬挂父级")
                .isEqualTo(5L);
    }

    /** 禁用过滤必须放行空列表，并过滤自身禁用、祖先禁用与父节点缺失的菜单。 */
    @Test
    void filterDisableMenusFiltersDisabledAndOrphanNodes() {
        assertThat(menuService.filterDisableMenus(Collections.emptyList())).isEmpty();

        MenuDO enabledRoot = menu(1L, "DUMMY-根菜单", MenuTypeEnum.DIR.getType(),
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        enabledRoot.setParentId(MenuDO.ID_ROOT);
        MenuDO enabledChild = menu(2L, "DUMMY-子菜单", MenuTypeEnum.MENU.getType(),
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        enabledChild.setParentId(1L);
        MenuDO disabledNode = menu(3L, "DUMMY-禁用菜单", MenuTypeEnum.MENU.getType(),
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        disabledNode.setParentId(MenuDO.ID_ROOT);
        disabledNode.setStatus(CommonStatusEnum.DISABLE.getStatus());
        MenuDO childOfDisabled = menu(4L, "DUMMY-禁用子菜单", MenuTypeEnum.MENU.getType(),
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        childOfDisabled.setParentId(3L);
        MenuDO orphan = menu(5L, "DUMMY-孤儿菜单", MenuTypeEnum.MENU.getType(),
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        orphan.setParentId(99L);

        List<MenuDO> result = menuService.filterDisableMenus(
                List.of(enabledRoot, enabledChild, disabledNode, childOfDisabled, orphan));

        assertThat(result).extracting(MenuDO::getId).containsExactly(1L, 2L);
    }

    /** 父级先于子级出现在结果中时，禁用缓存必须避免重复递归并保持过滤结论一致。 */
    @Test
    void filterDisableMenusReusesDisabledCache() {
        MenuDO childOfDisabled = menu(4L, "DUMMY-禁用子菜单", MenuTypeEnum.MENU.getType(),
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        childOfDisabled.setParentId(3L);
        MenuDO disabledParent = menu(3L, "DUMMY-禁用菜单", MenuTypeEnum.MENU.getType(),
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        disabledParent.setParentId(MenuDO.ID_ROOT);
        disabledParent.setStatus(CommonStatusEnum.DISABLE.getStatus());
        MenuDO enabledSibling = menu(6L, "DUMMY-同级菜单", MenuTypeEnum.MENU.getType(),
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        enabledSibling.setParentId(MenuDO.ID_ROOT);

        List<MenuDO> result = menuService.filterDisableMenus(
                new ArrayList<>(List.of(childOfDisabled, disabledParent, enabledSibling)));

        assertThat(result).extracting(MenuDO::getId).as("子级先出现时仍须因祖先禁用被过滤").containsExactly(6L);
    }

    /** 父菜单校验必须区分空父级、根父级、自引用、父级缺失与父级类型非法。 */
    @Test
    void validateParentMenuDistinguishesCases() {
        menuService.validateParentMenu(null, 1L);
        menuService.validateParentMenu(MenuDO.ID_ROOT, 1L);
        verify(menuMapper, never()).selectById(MenuDO.ID_ROOT);

        assertBusinessError(() -> menuService.validateParentMenu(1L, 1L), ErrorCodeConstants.MENU_PARENT_ERROR);

        when(menuMapper.selectById(5L)).thenReturn(null);
        assertBusinessError(() -> menuService.validateParentMenu(5L, 1L), ErrorCodeConstants.MENU_PARENT_NOT_EXISTS);

        when(menuMapper.selectById(5L)).thenReturn(menu(5L, "DUMMY-目录", MenuTypeEnum.DIR.getType(),
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        menuService.validateParentMenu(5L, 1L);

        when(menuMapper.selectById(6L)).thenReturn(menu(6L, "DUMMY-菜单", MenuTypeEnum.MENU.getType(),
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        menuService.validateParentMenu(6L, 1L);

        when(menuMapper.selectById(7L)).thenReturn(menu(7L, "DUMMY-按钮", MenuTypeEnum.BUTTON.getType(),
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        assertBusinessError(() -> menuService.validateParentMenu(7L, 1L),
                ErrorCodeConstants.MENU_PARENT_NOT_DIR_OR_MENU);
    }

    /** 菜单名唯一性校验必须区分未命中、新增冲突、改到他人名称与保持自身名称。 */
    @Test
    void validateMenuNameDistinguishesCases() {
        when(menuMapper.selectByParentIdAndName(MenuDO.ID_ROOT, "DUMMY-菜单")).thenReturn(null);
        menuService.validateMenuName(MenuDO.ID_ROOT, "DUMMY-菜单", 1L);

        when(menuMapper.selectByParentIdAndName(MenuDO.ID_ROOT, "DUMMY-菜单"))
                .thenReturn(menu(2L, "DUMMY-菜单", MenuTypeEnum.MENU.getType(),
                        AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        assertBusinessError(() -> menuService.validateMenuName(MenuDO.ID_ROOT, "DUMMY-菜单", null),
                ErrorCodeConstants.MENU_NAME_DUPLICATE);
        assertBusinessError(() -> menuService.validateMenuName(MenuDO.ID_ROOT, "DUMMY-菜单", 1L),
                ErrorCodeConstants.MENU_NAME_DUPLICATE);

        menuService.validateMenuName(MenuDO.ID_ROOT, "DUMMY-菜单", 2L);
    }

    /** 组件名唯一性校验必须跳过空组件名，并区分未命中、新增冲突、改到他人组件名与保持自身组件名。 */
    @Test
    void validateMenuComponentNameDistinguishesCases() {
        menuService.validateMenuComponentName("  ", 1L);
        verify(menuMapper, never()).selectByComponentName("  ");

        when(menuMapper.selectByComponentName("DUMMY-组件")).thenReturn(null);
        menuService.validateMenuComponentName("DUMMY-组件", 1L);

        when(menuMapper.selectByComponentName("DUMMY-组件")).thenReturn(menu(2L, "DUMMY-菜单",
                MenuTypeEnum.MENU.getType(), AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        assertBusinessError(() -> menuService.validateMenuComponentName("DUMMY-组件", null),
                ErrorCodeConstants.MENU_COMPONENT_NAME_DUPLICATE);
        assertBusinessError(() -> menuService.validateMenuComponentName("DUMMY-组件", 1L),
                ErrorCodeConstants.MENU_COMPONENT_NAME_DUPLICATE);

        menuService.validateMenuComponentName("DUMMY-组件", 2L);
    }

    /**
     * 断言业务异常的错误码。
     *
     * @param action 触发业务校验的动作
     * @param expected 期望的业务错误码
     */
    private static void assertBusinessError(ThrowingCallable action, ErrorCode expected) {
        assertThatThrownBy(action).isInstanceOfSatisfying(ServiceException.class,
                exception -> assertThat(exception.getCode()).isEqualTo(expected.getCode()));
    }

    /**
     * 构造菜单保存参数，默认带组件与图标，便于验证按钮类型的清理行为。
     *
     * @param id 菜单编号，新增时为空
     * @param name 菜单名称
     * @param type 菜单类型
     * @param parentId 父菜单编号
     * @return 保存参数
     */
    private static MenuSaveVO saveReqVO(Long id, String name, Integer type, Long parentId) {
        MenuSaveVO reqVO = new MenuSaveVO();
        reqVO.setId(id);
        reqVO.setName(name);
        reqVO.setType(type);
        reqVO.setParentId(parentId);
        reqVO.setSort(1);
        reqVO.setPath("/dummy");
        reqVO.setIcon("DUMMY-图标");
        reqVO.setComponent("DUMMY-视图");
        reqVO.setComponentName("DUMMY-组件");
        reqVO.setStatus(CommonStatusEnum.ENABLE.getStatus());
        reqVO.setVisible(true);
        reqVO.setKeepAlive(true);
        reqVO.setAlwaysShow(true);
        return reqVO;
    }

    /**
     * 构造启用状态的菜单。
     *
     * @param id 编号
     * @param name 名称
     * @param type 菜单类型
     * @param menuType 平台类型
     * @return 菜单
     */
    private static MenuDO menu(Long id, String name, Integer type, String menuType) {
        MenuDO menu = new MenuDO();
        menu.setId(id);
        menu.setName(name);
        menu.setType(type);
        menu.setMenuType(menuType);
        menu.setStatus(CommonStatusEnum.ENABLE.getStatus());
        menu.setSort(1);
        return menu;
    }

}
