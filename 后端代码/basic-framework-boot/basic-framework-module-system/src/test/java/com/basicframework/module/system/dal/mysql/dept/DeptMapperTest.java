package com.basicframework.module.system.dal.mysql.dept;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptListReqVO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
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
 * 验证部门查询的平台隔离口径。
 *
 * <p>部门树同时服务管理平台与业务平台，两个平台可以存在同名甚至同编号的部门。每个部门查询都必须带上
 * {@code role_type}：漏掉它会让一个平台的管理员在组织树上看到并操作另一个平台的部门，等于跨平台的
 * 组织结构越权。按编号加锁、按上级计数这类结构查询同样不能省。</p>
 *
 * @author shady2713
 */
class DeptMapperTest {

    /** 记录查询交给持久化层的条件对象。 */
    private AbstractWrapper<DeptDO, ?, ?> queryWrapper;
    /** 计数查询要返回的数量。 */
    private long countResult;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录条件。 */
    private DeptMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), DeptDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象查询方法记录条件后返回空结果。 */
    @BeforeEach
    void setUp() {
        queryWrapper = null;
        countResult = 0L;
        mapper = mock(DeptMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(0);
            return null;
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

    /** 部门列表必须按平台过滤，名称与状态只是可选的附加条件。 */
    @Test
    void selectListAlwaysCarriesPlatformType() {
        DeptListReqVO reqVO = new DeptListReqVO();
        reqVO.setName("研发");
        reqVO.setStatus(0);

        mapper.selectList(reqVO, "super_admin");

        assertThat(queryWrapper.getTargetSql())
                .contains("role_type =").contains("name LIKE").contains("status =");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains("super_admin", "%研发%", 0);
    }

    /** 请求未带筛选条件时仍然只按平台过滤，不得拼出空的模糊匹配。 */
    @Test
    void selectListWithoutFiltersKeepsOnlyPlatformCondition() {
        mapper.selectList(new DeptListReqVO(), "business_admin");

        assertThat(queryWrapper.getTargetSql()).contains("role_type =").doesNotContain("LIKE");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactly("business_admin");
    }

    /** 同级部门重名校验必须同时限定上级、名称与平台，避免把另一个平台的同名部门当成重复。 */
    @Test
    void selectByParentIdAndNameCarriesParentNameAndPlatform() {
        mapper.selectByParentIdAndName(1L, "研发", "super_admin");

        assertThat(queryWrapper.getTargetSql())
                .contains("parent_id =").contains("name =").contains("role_type =");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains(1L, "研发", "super_admin");
    }

    /** 按上级统计子部门用于删除前的占用校验，必须只在同平台范围内计数。 */
    @Test
    void selectCountByParentIdCountsInsideSamePlatform() {
        mapper.selectCountByParentId(3L);

        assertThat(queryWrapper.getTargetSql()).contains("parent_id =");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains(3L);
    }

    /** 批量取子部门用于组织树展开，编号集合与平台条件必须同时生效。 */
    @Test
    void selectListByParentIdsCombinesInConditionWithPlatform() {
        mapper.selectListByParentId(List.of(3L, 4L), "super_admin");

        assertThat(queryWrapper.getTargetSql()).contains("parent_id IN").contains("role_type =");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains(3L, 4L, "super_admin");
    }

    /** 负责人变更时按负责人编号反查部门，同样不得跨平台命中。 */
    @Test
    void selectListByLeaderUserIdCombinesLeaderAndPlatform() {
        mapper.selectListByLeaderUserId(9L, "business_admin");

        assertThat(queryWrapper.getTargetSql()).contains("leader_user_id =").contains("role_type =");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains(9L, "business_admin");
    }

    /** 按编号集合取部门用于批量渲染名称，集合条件与平台条件缺一不可。 */
    @Test
    void selectListByIdsAndRoleTypeCombinesInConditionWithPlatform() {
        mapper.selectListByIdsAndRoleType(List.of(1L, 2L), "super_admin");

        assertThat(queryWrapper.getTargetSql()).contains("id IN").contains("role_type =");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains(1L, 2L, "super_admin");
    }

    /** 按名称查部门用于导入校验，必须限制为一条以容忍历史重复数据，取编号最小的一条。 */
    @Test
    void selectByNameAndRoleTypeLimitsToSingleRow() {
        mapper.selectByNameAndRoleType("研发", "super_admin");

        assertThat(queryWrapper.getTargetSql())
                .contains("name =").contains("role_type =").endsWith("LIMIT 1");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains("研发", "super_admin");
    }

    /** 计数结果必须原样透传给调用方，供删除校验判断是否还有子部门。 */
    @Test
    void selectCountByParentIdReturnsDatabaseCount() {
        countResult = 5L;

        assertThat(mapper.selectCountByParentId(3L)).isEqualTo(5L);
        assertThat(queryWrapper.getTargetSql()).contains("parent_id =");
    }

}