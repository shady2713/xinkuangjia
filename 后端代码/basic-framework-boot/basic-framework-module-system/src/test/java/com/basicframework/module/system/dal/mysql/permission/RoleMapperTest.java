package com.basicframework.module.system.dal.mysql.permission;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.system.controller.admin.permission.vo.role.RolePageReqVO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Answers.CALLS_REAL_METHODS;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 验证角色查询的条件拼装、排序口径与空集合短路。
 *
 * <p>角色分页按 {@code sort} 升序返回，与其它列表普遍使用的编号倒序不同：管理端依赖这个顺序展示角色
 * 的既定优先级，改成倒序会让运营配置的顺序失效。创建时间范围来自基类字段 {@code create_time}，
 * 用的是继承字段而不是角色自身的列。</p>
 *
 * @author shady2713
 */
class RoleMapperTest {

    /** 记录查询交给持久化层的条件对象。 */
    private AbstractWrapper<RoleDO, ?, ?> queryWrapper;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录条件。 */
    private RoleMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), RoleDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象查询方法记录条件后返回空结果。 */
    @BeforeEach
    void setUp() {
        queryWrapper = null;
        mapper = mock(RoleMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(0);
            return null;
        }).when(mapper).selectOne(any(Wrapper.class));
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(0);
            return List.of();
        }).when(mapper).selectList(any(Wrapper.class));
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(1);
            IPage<RoleDO> page = invocation.getArgument(0);
            page.setRecords(List.of());
            return page;
        }).when(mapper).selectPage(any(IPage.class), any(Wrapper.class));
    }

    /** 角色分页应用全部筛选条件，并按角色排序字段升序返回而不是按编号倒序。 */
    @Test
    void selectPageAppliesFiltersAndOrdersBySortAscending() {
        RolePageReqVO reqVO = new RolePageReqVO();
        reqVO.setName("运营");
        reqVO.setCode("ops");
        reqVO.setStatus(0);
        reqVO.setRoleType("custom");
        LocalDateTime begin = LocalDateTime.of(2026, 9, 1, 0, 0);
        LocalDateTime end = LocalDateTime.of(2026, 9, 2, 23, 59, 59);
        reqVO.setCreateTime(new LocalDateTime[]{begin, end});

        mapper.selectPage(reqVO);

        assertThat(queryWrapper.getTargetSql())
                .contains("name LIKE").contains("code LIKE").contains("status =").contains("role_type =")
                .contains("create_time BETWEEN").contains("ORDER BY sort ASC");
        assertThat(queryWrapper.getParamNameValuePairs().values())
                .contains("%运营%", "%ops%", 0, "custom", begin, end);
    }

    /** 未带筛选条件时只保留排序，不得拼出空的模糊匹配或空的时间区间。 */
    @Test
    void selectPageWithoutFiltersOnlyKeepsOrdering() {
        mapper.selectPage(new RolePageReqVO());

        assertThat(queryWrapper.getTargetSql())
                .doesNotContain("LIKE").doesNotContain("BETWEEN").contains("ORDER BY sort ASC");
        assertThat(queryWrapper.getParamNameValuePairs()).isEmpty();
    }

    /** 角色名称与编码都必须唯一，查询时使用精确匹配而不是模糊匹配。 */
    @Test
    void selectByNameAndCodeUseExactEquality() {
        mapper.selectByName("运营");
        assertThat(queryWrapper.getTargetSql()).contains("name =").doesNotContain("LIKE");

        mapper.selectByCode("ops");
        assertThat(queryWrapper.getTargetSql()).contains("code =").doesNotContain("LIKE");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactly("ops");
    }

    /** 按状态集合过滤角色时，空集合必须直接短路，不能退化成返回全部角色。 */
    @Test
    void selectListByStatusWithEmptyCollectionShortCircuitsWithoutQuerying() {
        assertThat(mapper.selectListByStatus(List.of())).isEmpty();
        assertThat(mapper.selectListByStatus(null)).isEmpty();

        verify(mapper, never()).selectList(any(Wrapper.class));
        assertThat(queryWrapper).as("短路路径不得拼出任何条件").isNull();
    }

    /** 状态集合非空时按 IN 过滤，供按启用状态批量取角色使用。 */
    @Test
    void selectListByStatusWithValuesUsesInCondition() {
        mapper.selectListByStatus(List.of(0, 1));

        assertThat(queryWrapper.getTargetSql()).contains("status IN");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains(0, 1);
    }

    /** 按角色类型取列表用于数据权限初始化，类型必须精确匹配。 */
    @Test
    void selectListByRoleTypeUsesExactEquality() {
        mapper.selectListByRoleType("custom");

        assertThat(queryWrapper.getTargetSql()).contains("role_type =");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactly("custom");
    }

}