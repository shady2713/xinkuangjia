package com.basicframework.module.system.dal.mysql.permission;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.system.dal.dataobject.permission.RoleMenuDO;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Collection;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Answers.CALLS_REAL_METHODS;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

/**
 * 验证角色菜单关联表的查询与清理条件。
 *
 * <p>角色菜单是纯关联表，查询入口区分"按单个角色"和"按角色集合"两种形态：前者生成等值条件，后者生成
 * {@code IN} 条件。把集合形态写成等值会让批量授权只生效一个角色；把单值形态写成 IN 则会在参数类型
 * 上产生隐式转换，掩盖调用方的错误。</p>
 *
 * <p>清理入口必须同时限定角色与菜单，否则取消一个菜单的授权会连带删除该角色下其它菜单的关联。</p>
 *
 * @author shady2713
 */
class RoleMenuMapperTest {

    /** 记录查询或删除交给持久化层的条件对象。 */
    private AbstractWrapper<RoleMenuDO, ?, ?> wrapper;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录条件。 */
    private RoleMenuMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), RoleMenuDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象查询与删除方法记录条件。 */
    @BeforeEach
    void setUp() {
        wrapper = null;
        mapper = mock(RoleMenuMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            wrapper = invocation.getArgument(0);
            return List.of();
        }).when(mapper).selectList(any(Wrapper.class));
        doAnswer(invocation -> {
            wrapper = invocation.getArgument(0);
            return 0;
        }).when(mapper).delete(any(Wrapper.class));
    }

    /** 按单个角色编号查询关联必须生成等值条件，而不是集合条件。 */
    @Test
    void selectListBySingleRoleIdUsesEquality() {
        mapper.selectListByRoleId(5L);

        assertThat(wrapper.getTargetSql()).contains("role_id =").doesNotContain("IN");
        assertThat(wrapper.getParamNameValuePairs().values()).containsExactly(5L);
    }

    /** 按角色集合查询关联用于批量加载菜单权限，必须生成 IN 条件。 */
    @Test
    void selectListByRoleIdCollectionUsesInCondition() {
        mapper.selectListByRoleId(List.of(5L, 6L));

        assertThat(wrapper.getTargetSql()).contains("role_id IN");
        assertThat(wrapper.getParamNameValuePairs().values()).contains(5L, 6L);
    }

    /** 按菜单编号反查授权角色，菜单编号必须精确匹配。 */
    @Test
    void selectListByMenuIdUsesEquality() {
        mapper.selectListByMenuId(8L);

        assertThat(wrapper.getTargetSql()).contains("menu_id =");
        assertThat(wrapper.getParamNameValuePairs().values()).containsExactly(8L);
    }

    /** 取消指定菜单的授权必须同时限定角色与菜单集合，避免误删该角色的其它授权。 */
    @Test
    void deleteListByRoleIdAndMenuIdsCombinesRoleWithMenuCollection() {
        Collection<Long> menuIds = List.of(8L, 9L);

        mapper.deleteListByRoleIdAndMenuIds(5L, menuIds);

        assertThat(wrapper.getTargetSql()).contains("role_id =").contains("menu_id IN");
        assertThat(wrapper.getParamNameValuePairs().values()).contains(5L, 8L, 9L);
    }

    /** 删除角色下某个菜单的全部关联时只限定菜单编号即可，因为角色编号不在调用链路上。 */
    @Test
    void deleteListByMenuIdRemovesAllRolesOfThatMenu() {
        mapper.deleteListByMenuId(8L);

        assertThat(wrapper.getTargetSql()).contains("menu_id =").doesNotContain("role_id");
        assertThat(wrapper.getParamNameValuePairs().values()).containsExactly(8L);
    }

    /** 清空角色菜单时只按角色编号删除，不得连带影响其它角色。 */
    @Test
    void deleteListByRoleIdRemovesAllMenusOfThatRole() {
        mapper.deleteListByRoleId(5L);

        assertThat(wrapper.getTargetSql()).contains("role_id =").doesNotContain("menu_id");
        assertThat(wrapper.getParamNameValuePairs().values()).containsExactly(5L);
    }

}