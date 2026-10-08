package com.basicframework.module.system.dal.mysql.permission;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.system.dal.dataobject.permission.UserRoleDO;
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
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 验证用户角色关联表的查询与清理条件。
 *
 * <p>按用户集合查询关联是数据权限批量初始化的高频入口。空的集合必须直接短路返回空列表而不是拼出
 * {@code IN ()}：调用方常常把"没有筛选条件"表达成空集合，一旦退化成无条件查询，就会把全量用户角色
 * 关联读进内存。</p>
 *
 * @author shady2713
 */
class UserRoleMapperTest {

    /** 记录查询或删除交给持久化层的条件对象。 */
    private AbstractWrapper<UserRoleDO, ?, ?> wrapper;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录条件。 */
    private UserRoleMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), UserRoleDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象查询与删除方法记录条件。 */
    @BeforeEach
    void setUp() {
        wrapper = null;
        mapper = mock(UserRoleMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            wrapper = invocation.getArgument(0);
            return List.of();
        }).when(mapper).selectList(any(Wrapper.class));
        doAnswer(invocation -> {
            wrapper = invocation.getArgument(0);
            return 0;
        }).when(mapper).delete(any(Wrapper.class));
    }

    /** 用户集合为空时必须直接返回空列表且完全不查库，避免退化成全量关联查询。 */
    @Test
    void selectListByUserIdsWithEmptyCollectionShortCircuits() {
        assertThat(mapper.selectListByUserIds(List.of())).isEmpty();
        assertThat(mapper.selectListByUserIds((Collection<Long>) null)).isEmpty();

        verify(mapper, never()).selectList(any(Wrapper.class));
        assertThat(wrapper).as("短路路径不得拼出任何条件").isNull();
    }

    /** 用户集合非空时按 IN 过滤，供批量数据权限初始化使用。 */
    @Test
    void selectListByUserIdsUsesInCondition() {
        mapper.selectListByUserIds(List.of(1L, 2L));

        assertThat(wrapper.getTargetSql()).contains("user_id IN");
        assertThat(wrapper.getParamNameValuePairs().values()).contains(1L, 2L);
    }

    /** 按单个用户编号查询关联必须生成等值条件而不是集合条件。 */
    @Test
    void selectListByUserIdUsesEquality() {
        mapper.selectListByUserId(1L);

        assertThat(wrapper.getTargetSql()).contains("user_id =").doesNotContain("IN");
        assertThat(wrapper.getParamNameValuePairs().values()).containsExactly(1L);
    }

    /** 撤销指定角色的用户授权必须同时限定用户与角色集合，避免误删该用户的其它授权。 */
    @Test
    void deleteListByUserIdAndRoleIdIdsCombinesUserWithRoleCollection() {
        Collection<Long> roleIds = List.of(10L, 11L);

        mapper.deleteListByUserIdAndRoleIdIds(1L, roleIds);

        assertThat(wrapper.getTargetSql()).contains("user_id =").contains("role_id IN");
        assertThat(wrapper.getParamNameValuePairs().values()).contains(1L, 10L, 11L);
    }

    /** 清空用户角色时只按用户编号删除。 */
    @Test
    void deleteListByUserIdRemovesAllRolesOfThatUser() {
        mapper.deleteListByUserId(1L);

        assertThat(wrapper.getTargetSql()).contains("user_id =").doesNotContain("role_id");
        assertThat(wrapper.getParamNameValuePairs().values()).containsExactly(1L);
    }

    /** 删除角色时按角色编号清理关联，不得顺带删除其它角色的关联。 */
    @Test
    void deleteListByRoleIdRemovesAllUsersOfThatRole() {
        mapper.deleteListByRoleId(10L);

        assertThat(wrapper.getTargetSql()).contains("role_id =").doesNotContain("user_id");
        assertThat(wrapper.getParamNameValuePairs().values()).containsExactly(10L);
    }

    /** 按角色集合反查关联用户必须生成 IN 条件。 */
    @Test
    void selectListByRoleIdsUsesInCondition() {
        mapper.selectListByRoleIds(List.of(10L, 11L));

        assertThat(wrapper.getTargetSql()).contains("role_id IN");
        assertThat(wrapper.getParamNameValuePairs().values()).contains(10L, 11L);
    }

}