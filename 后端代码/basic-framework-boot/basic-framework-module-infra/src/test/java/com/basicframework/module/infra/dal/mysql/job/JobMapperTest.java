package com.basicframework.module.infra.dal.mysql.job;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.infra.controller.admin.job.vo.job.JobPageReqVO;
import com.basicframework.module.infra.dal.dataobject.job.JobDO;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Answers.CALLS_REAL_METHODS;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

/**
 * 验证定时任务查询的条件拼装。
 *
 * <p>处理器名是调度器的注册键，全局唯一，必须精确匹配；任务名只是管理端的检索条件，用模糊匹配。
 * 处理器名写成模糊匹配会让任务列表里出现一批同名处理器，运维点开任意一条都会执行到同一处理器。</p>
 *
 * @author shady2713
 */
class JobMapperTest {

    /** 记录查询交给持久化层的条件对象。 */
    private AbstractWrapper<JobDO, ?, ?> queryWrapper;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录条件。 */
    private JobMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), JobDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象查询方法记录条件后返回空结果。 */
    @BeforeEach
    void setUp() {
        queryWrapper = null;
        mapper = mock(JobMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(0);
            return null;
        }).when(mapper).selectOne(any(Wrapper.class));
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(1);
            IPage<JobDO> page = invocation.getArgument(0);
            page.setRecords(java.util.List.of());
            return page;
        }).when(mapper).selectPage(any(IPage.class), any(Wrapper.class));
    }

    /** 处理器名唯一，查询必须精确匹配而不是模糊匹配。 */
    @Test
    void selectByHandlerNameUsesExactEquality() {
        mapper.selectByHandlerName("demoJobHandler");

        assertThat(queryWrapper.getTargetSql()).contains("handler_name =").doesNotContain("LIKE");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactly("demoJobHandler");
    }

    /** 任务分页按名称与处理器名模糊检索、状态精确匹配，并按编号倒序返回。 */
    @Test
    void selectPageAppliesFiltersAndOrdersById() {
        JobPageReqVO reqVO = new JobPageReqVO();
        reqVO.setName("清理");
        reqVO.setStatus(1);
        reqVO.setHandlerName("cleanJob");

        mapper.selectPage(reqVO);

        assertThat(queryWrapper.getTargetSql())
                .contains("name LIKE").contains("status =").contains("handler_name LIKE")
                .contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains("%清理%", 1, "%cleanJob%");
    }

    /** 未带筛选条件时不得拼出空条件，排序仍然生效。 */
    @Test
    void selectPageWithoutFiltersOnlyKeepsOrdering() {
        mapper.selectPage(new JobPageReqVO());

        assertThat(queryWrapper.getTargetSql())
                .doesNotContain("LIKE").contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs()).isEmpty();
    }

}