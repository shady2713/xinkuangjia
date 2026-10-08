package com.basicframework.module.system.dal.mysql.permission;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.system.controller.admin.permission.vo.menu.MenuListReqVO;
import com.basicframework.module.system.dal.dataobject.permission.MenuDO;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Answers.CALLS_REAL_METHODS;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

/**
 * 验证菜单查询的条件拼装与精确匹配口径。
 *
 * <p>菜单的权限标识、菜单类型与组件名都可能被多条历史数据重复占用，这些查询的唯一性由调用方保证，
 * 持久层因此必须使用精确匹配。用模糊匹配会把 {@code user:read} 命中到 {@code user:read:all}，
 * 让本该隐藏的按钮出现在菜单树里。</p>
 *
 * @author shady2713
 */
class MenuMapperTest {

    /** 记录查询交给持久化层的条件对象。 */
    private AbstractWrapper<MenuDO, ?, ?> queryWrapper;
    /** 单条查询要返回的记录。 */
    private MenuDO selectOneResult;
    /** 计数查询要返回的数量。 */
    private long countResult;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录条件。 */
    private MenuMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), MenuDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象查询方法记录条件后返回空结果。 */
    @BeforeEach
    void setUp() {
        queryWrapper = null;
        selectOneResult = null;
        countResult = 0L;
        mapper = mock(MenuMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(0);
            return selectOneResult;
        }).when(mapper).selectOne(any(Wrapper.class));
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(0);
            return List.of();
        }).when(mapper).selectList(any(Wrapper.class));
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(0);
            return countResult;
        }).when(mapper).selectCount(any(Wrapper.class));
    }

    /** 同级菜单重名校验必须同时限定上级与名称，否则会把根目录下的同名菜单当成冲突。 */
    @Test
    void selectByParentIdAndNameCarriesBothConditions() {
        mapper.selectByParentIdAndName(0L, "系统管理");

        assertThat(queryWrapper.getTargetSql()).contains("parent_id =").contains("name =");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains(0L, "系统管理");
    }

    /** 按上级统计菜单用于删除前的占用校验，结果必须原样透传。 */
    @Test
    void selectCountByParentIdReturnsDatabaseCount() {
        countResult = 4L;

        assertThat(mapper.selectCountByParentId(2L)).isEqualTo(4L);
        // MyBatis-Plus 在渲染 SQL 时才写入条件参数，必须先取 SQL 再核对参数。
        assertThat(queryWrapper.getTargetSql()).contains("parent_id =");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains(2L);
    }

    /** 菜单列表的三个筛选条件都可缺省，缺省时不得拼出空条件。 */
    @Test
    void selectListAppliesOptionalFilters() {
        MenuListReqVO reqVO = new MenuListReqVO();
        reqVO.setName("用户");
        reqVO.setStatus(0);
        reqVO.setMenuType("C");

        mapper.selectList(reqVO);

        assertThat(queryWrapper.getTargetSql())
                .contains("name LIKE").contains("status =").contains("menu_type =");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains("%用户%", 0, "C");
    }

    /** 请求未带任何筛选条件时按全量菜单返回，条件对象必须为空而不是带无效条件。 */
    @Test
    void selectListWithoutFiltersProducesNoConditions() {
        mapper.selectList(new MenuListReqVO());

        assertThat(queryWrapper.getTargetSql()).isEmpty();
        assertThat(queryWrapper.getParamNameValuePairs()).isEmpty();
    }

    /** 按权限标识反查菜单必须精确匹配，模糊匹配会让相近标识互相串权。 */
    @Test
    void selectListByPermissionUsesExactEquality() {
        mapper.selectListByPermission("system:user:query");

        assertThat(queryWrapper.getTargetSql()).contains("permission =").doesNotContain("LIKE");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactly("system:user:query");
    }

    /** 按菜单类型取列表用于路由组装，类型必须精确匹配。 */
    @Test
    void selectListByMenuTypeUsesExactEquality() {
        mapper.selectListByMenuType("C");

        assertThat(queryWrapper.getTargetSql()).contains("menu_type =");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactly("C");
    }

    /** 组件名唯一性校验用于防止前端路由冲突，必须精确匹配。 */
    @Test
    void selectByComponentNameUsesExactEqualityAndReturnsRecord() {
        MenuDO expected = new MenuDO();
        selectOneResult = expected;

        assertThat(mapper.selectByComponentName("system/user/index")).isSameAs(expected);
        assertThat(queryWrapper.getTargetSql()).contains("component_name =").doesNotContain("LIKE");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactly("system/user/index");
    }

}