package com.basicframework.module.system.convert.auth;

import com.basicframework.module.system.controller.admin.auth.vo.AuthPermissionInfoRespVO;
import com.basicframework.module.system.dal.dataobject.permission.MenuDO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.enums.permission.MenuTypeEnum;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证权限信息转换器组装用户、角色、权限标识与菜单树的真实结果。
 *
 * <p>该转换结果是前端渲染菜单与控制按钮的依据：角色与权限标识缺失会让页面无按钮，
 * 菜单树组装错误会让子菜单丢失或挂到错误的父节点；按钮类菜单必须从菜单树中移除（否则前端会渲染出
 * 不可点击的"按钮"菜单），但其权限标识仍要保留在权限集合中，否则按钮无法显示。用例用真实持久对象
 * 断言这些可观察结果，并覆盖空菜单与父节点缺失两个边界。</p>
 *
 * @author shady2713
 */
class AuthConvertTest {

    /** 用户、角色、权限与菜单树必须一次性组装完成。 */
    @Test
    void convertBuildsUserRolesPermissionsAndMenuTree() {
        AdminUserDO user = user(9L, "DUMMY-admin", "管理员");
        RoleDO role = new RoleDO();
        role.setCode("super_admin");
        MenuDO root = menu(1L, "系统管理", null, MenuTypeEnum.DIR.getType(), 2, MenuDO.ID_ROOT);
        MenuDO child = menu(2L, "用户管理", "system:user:query", MenuTypeEnum.MENU.getType(), 1, 1L);
        MenuDO button = menu(3L, "用户新增", "system:user:create", MenuTypeEnum.BUTTON.getType(), 3, 2L);

        AuthPermissionInfoRespVO result = AuthConvert.INSTANCE.convert(
                user, List.of(role), new ArrayList<>(List.of(root, child, button)));

        assertThat(result.getUser().getId()).isEqualTo(9L);
        assertThat(result.getUser().getUsername()).isEqualTo("DUMMY-admin");
        assertThat(result.getUser().getNickname()).isEqualTo("管理员");
        assertThat(result.getRoles()).containsExactly("super_admin");
        assertThat(result.getPermissions()).as("按钮权限标识必须保留，否则按钮无法展示")
                .containsExactlyInAnyOrder("system:user:query", "system:user:create");
        assertThat(result.getMenus()).as("只保留根菜单作为顶层节点").hasSize(1);
        assertThat(result.getMenus().get(0).getName()).isEqualTo("系统管理");
        assertThat(result.getMenus().get(0).getChildren()).as("子菜单必须挂到父节点上").hasSize(1);
        assertThat(result.getMenus().get(0).getChildren().get(0).getName()).isEqualTo("用户管理");
        assertThat(result.getMenus().get(0).getChildren().get(0).getId()).isEqualTo(2L);
    }

    /**
     * 空菜单列表必须返回空菜单树，而不是 null 或抛错。
     *
     * <p>新账号没有任何菜单时接口仍必须可访问，前端据此渲染空菜单。</p>
     */
    @Test
    void buildMenuTreeReturnsEmptyListForEmptyInput() {
        assertThat(AuthConvert.INSTANCE.buildMenuTree(new ArrayList<>())).isEmpty();
        assertThat(AuthConvert.INSTANCE.buildMenuTree(null)).isEmpty();
    }

    /**
     * 菜单树必须剔除按钮、按排序值升序，并跳过找不到父节点的资源。
     *
     * <p>排序值决定前端菜单顺序；父节点缺失（数据不一致）时该资源不再挂载，但不得影响其它节点。</p>
     */
    @Test
    void buildMenuTreeRemovesButtonsSortsAndSkipsOrphan() {
        MenuDO first = menu(1L, "第一", null, MenuTypeEnum.DIR.getType(), 10, MenuDO.ID_ROOT);
        MenuDO second = menu(2L, "第二", null, MenuTypeEnum.DIR.getType(), 20, MenuDO.ID_ROOT);
        MenuDO button = menu(3L, "按钮", "system:button", MenuTypeEnum.BUTTON.getType(), 5, MenuDO.ID_ROOT);
        MenuDO orphan = menu(4L, "孤儿菜单", null, MenuTypeEnum.MENU.getType(), 1, 999L);

        List<AuthPermissionInfoRespVO.MenuVO> tree =
                AuthConvert.INSTANCE.buildMenuTree(new ArrayList<>(List.of(second, button, first, orphan)));

        assertThat(tree).extracting(AuthPermissionInfoRespVO.MenuVO::getName)
                .as("按钮被剔除、孤儿被跳过，且根节点按排序值升序").containsExactly("第一", "第二");
        assertThat(tree).extracting(AuthPermissionInfoRespVO.MenuVO::getChildren).containsOnlyNulls();
    }

    /** 子菜单必须按排序值升序挂到父节点，保证前端菜单顺序稳定。 */
    @Test
    void buildMenuTreeSortsChildrenBySort() {
        MenuDO root = menu(1L, "根", null, MenuTypeEnum.DIR.getType(), 1, MenuDO.ID_ROOT);
        MenuDO later = menu(2L, "后", null, MenuTypeEnum.MENU.getType(), 30, 1L);
        MenuDO earlier = menu(3L, "先", null, MenuTypeEnum.MENU.getType(), 20, 1L);

        List<AuthPermissionInfoRespVO.MenuVO> tree =
                AuthConvert.INSTANCE.buildMenuTree(new ArrayList<>(List.of(root, later, earlier)));

        assertThat(tree).hasSize(1);
        assertThat(tree.get(0).getChildren()).extracting(AuthPermissionInfoRespVO.MenuVO::getName)
                .containsExactly("先", "后");
    }

    /**
     * 构造用户持久对象。
     *
     * @param id 编号
     * @param username 账号
     * @param nickname 昵称
     * @return 用户持久对象
     */
    private static AdminUserDO user(Long id, String username, String nickname) {
        AdminUserDO user = new AdminUserDO();
        user.setId(id);
        user.setUsername(username);
        user.setNickname(nickname);
        return user;
    }

    /**
     * 构造菜单持久对象。
     *
     * @param id 编号
     * @param name 名称
     * @param permission 权限标识，允许为 null
     * @param type 菜单类型
     * @param sort 排序值
     * @param parentId 父节点编号
     * @return 菜单持久对象
     */
    private static MenuDO menu(Long id, String name, String permission, Integer type, Integer sort, Long parentId) {
        MenuDO menu = new MenuDO();
        menu.setId(id);
        menu.setName(name);
        menu.setPermission(permission);
        menu.setType(type);
        menu.setSort(sort);
        menu.setParentId(parentId);
        return menu;
    }

}
