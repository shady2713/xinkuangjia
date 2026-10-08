package com.basicframework.module.infra.dal.mysql.job;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.infra.controller.admin.job.vo.log.JobLogPageReqVO;
import com.basicframework.module.infra.dal.dataobject.job.JobLogDO;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
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
 * 验证任务日志的分页条件与分批清理口径。
 *
 * <p>日志清理按批删除，先用一条只取编号的查询按编号升序取出待删编号，再按编号批量删除。分页大小
 * 必须原样下发给分页插件——它是"每批删多少条"的唯一限制，放大就等于取消分批保护。没有命中记录时
 * 必须直接返回 0 且不发出删除语句，否则会发出一次无意义的批量删除请求。</p>
 *
 * @author shady2713
 */
class JobLogMapperTest {

    /** 记录分页查询交给持久化层的条件对象。 */
    private AbstractWrapper<JobLogDO, ?, ?> queryWrapper;
    /** 记录最近一次分页查询交给分页插件的分页对象。 */
    private IPage<JobLogDO> pageRef;
    /** 待删记录的编号；空列表用于表达"没有命中"。 */
    private List<Long> logIds;
    /** 按编号批量删除要返回的影响行数。 */
    private int deletedRows;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录参数。 */
    private JobLogMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), JobLogDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象分页查询与批量删除按用例设定的方式回放真实副作用。 */
    @BeforeEach
    void setUp() {
        queryWrapper = null;
        pageRef = null;
        logIds = List.of();
        deletedRows = 0;
        mapper = mock(JobLogMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            pageRef = invocation.getArgument(0);
            queryWrapper = invocation.getArgument(1);
            List<JobLogDO> records = logIds.stream().map(id -> {
                JobLogDO record = new JobLogDO();
                record.setId(id);
                return record;
            }).toList();
            pageRef.setRecords(records);
            pageRef.setTotal((long) records.size());
            return pageRef;
        }).when(mapper).selectPage(any(IPage.class), any(Wrapper.class));
        doAnswer(invocation -> deletedRows).when(mapper).deleteByIds(any(Collection.class));
    }

    /** 日志分页把五个筛选条件翻译成对应的等值、大于等于、小于等于与模糊匹配，并按编号倒序返回。 */
    @Test
    void selectPageAppliesAllFiltersAndOrdersById() {
        JobLogPageReqVO reqVO = new JobLogPageReqVO();
        reqVO.setJobId(5L);
        reqVO.setHandlerName("clean");
        reqVO.setBeginTime(LocalDateTime.of(2026, 9, 1, 0, 0));
        reqVO.setEndTime(LocalDateTime.of(2026, 9, 2, 23, 59, 59));
        reqVO.setStatus(2);

        mapper.selectPage(reqVO);

        assertThat(queryWrapper.getTargetSql())
                .contains("job_id =").contains("handler_name LIKE").contains("begin_time >=")
                .contains("end_time <=").contains("status =").contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs().values())
                .contains(5L, "%clean%", LocalDateTime.of(2026, 9, 1, 0, 0),
                        LocalDateTime.of(2026, 9, 2, 23, 59, 59), 2);
    }

    /** 未带筛选条件时不得拼出空条件，排序仍然生效。 */
    @Test
    void selectPageWithoutFiltersOnlyKeepsOrdering() {
        mapper.selectPage(new JobLogPageReqVO());

        assertThat(queryWrapper.getTargetSql())
                .doesNotContain("LIKE").contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs()).isEmpty();
    }

    /** 清理只取待删编号、只查截止时间之前的记录，并按编号升序分页。 */
    @Test
    void deleteByCreateTimeLtSelectsIdsWithStrictLimit() {
        logIds = List.of(1L, 2L, 3L);
        deletedRows = 3;
        LocalDateTime before = LocalDateTime.of(2026, 9, 1, 0, 0);

        Integer deleted = mapper.deleteByCreateTimeLt(before, 100);

        assertThat(deleted).isEqualTo(3);
        assertThat(queryWrapper.getTargetSql())
                .contains("create_time <").contains("ORDER BY id ASC").doesNotContain("AND");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains(before);
        assertThat(pageRef.getCurrent()).isEqualTo(1);
        assertThat(pageRef.getSize()).as("每批条数必须原样下发给分页插件").isEqualTo(100);
        verify(mapper).deleteByIds(List.of(1L, 2L, 3L));
    }

    /** 没有命中记录时返回 0 且不发出删除语句，避免一次无意义的批量删除请求。 */
    @Test
    void deleteByCreateTimeLtWithoutMatchesIssuesNoDelete() {
        logIds = List.of();

        assertThat(mapper.deleteByCreateTimeLt(LocalDateTime.of(2026, 9, 1, 0, 0), 100)).isZero();

        verify(mapper, never()).deleteByIds(any(Collection.class));
        assertThat(queryWrapper.getTargetSql()).contains("create_time <").contains("ORDER BY id ASC");
    }

    /** 删除影响行数必须原样返回，清理循环据此判断是否继续下一批。 */
    @Test
    void deleteByCreateTimeLtReturnsDatabaseRowCount() {
        logIds = List.of(7L);
        deletedRows = 1;

        assertThat(mapper.deleteByCreateTimeLt(LocalDateTime.of(2026, 9, 1, 0, 0), 1)).isEqualTo(1);
        verify(mapper).deleteByIds(List.of(7L));
    }

}