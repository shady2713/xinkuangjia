package com.basicframework.module.infra.service.job;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.infra.controller.admin.job.vo.log.JobLogPageReqVO;
import com.basicframework.module.infra.dal.dataobject.job.JobLogDO;
import com.basicframework.module.infra.dal.mysql.job.JobLogMapper;
import com.basicframework.module.infra.enums.job.JobLogStatusEnum;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证任务执行日志的落库字段、异步结果写入的容错与分批清理的边界。
 *
 * <p>任务日志是排查定时任务为什么没跑的唯一依据，三条规则失效都会直接丢证据：开始执行时若不落库，
 * 任务崩溃后连"跑过"这一事实都没有；异步写结果时若把异常抛回 Quartz 线程，会影响调度线程后续流程，
 * 因此这里的容错必须真实生效；分批清理按"删够一批就停"推进，如果停止条件写错，要么漏删要么对库发起
 * 上万次无谓删除把数据库压垮。</p>
 *
 * <p>持久层替换为 Mapper 替身，状态枚举映射、重试次数记录、异常吞与批量循环全部真实执行；断言核对
 * 写入对象的状态与耗时字段、删除截止时间随保留天数推移，以及替身实际收到的分批条数。</p>
 *
 * @author shady2713
 */
class JobLogServiceImplTest {

    /** 替换数据库自增的日志编号。 */
    private static final Long GENERATED_ID = 4096L;

    /** 被测服务。 */
    private JobLogServiceImpl jobLogService;
    /** 任务日志持久层替身。 */
    private JobLogMapper jobLogMapper;

    /**
     * 装配服务与 Mapper 替身。
     */
    @BeforeEach
    void setUp() {
        jobLogService = new JobLogServiceImpl();
        jobLogMapper = mock(JobLogMapper.class);
        ReflectionTestUtils.setField(jobLogService, "jobLogMapper", jobLogMapper);
    }

    /** 开始执行时以运行中状态落库，并记录重试的累计执行次序。 */
    @Test
    void createJobLogStoresRunningStatusAndExecuteIndex() {
        LocalDateTime beginTime = LocalDateTime.of(2026, 1, 2, 3, 4, 5);
        doAnswer(invocation -> {
            JobLogDO inserted = invocation.getArgument(0);
            inserted.setId(GENERATED_ID);
            return 1;
        }).when(jobLogMapper).insert(any(JobLogDO.class));

        Long id = jobLogService.createJobLog(7L, beginTime, "testHandler", "userId=1", 2);

        ArgumentCaptor<JobLogDO> captor = ArgumentCaptor.forClass(JobLogDO.class);
        verify(jobLogMapper).insert(captor.capture());
        assertThat(id).isEqualTo(GENERATED_ID);
        assertThat(captor.getValue().getStatus()).isEqualTo(JobLogStatusEnum.RUNNING.getStatus());
        assertThat(captor.getValue().getExecuteIndex()).isEqualTo(2);
        assertThat(captor.getValue().getBeginTime()).isEqualTo(beginTime);
        assertThat(captor.getValue().getHandlerName()).isEqualTo("testHandler");
    }

    /** 首次执行的重试序号为初始值，日志中不出现跳号。 */
    @Test
    void createJobLogRecordsFirstExecuteIndex() {
        doAnswer(invocation -> {
            JobLogDO inserted = invocation.getArgument(0);
            inserted.setId(GENERATED_ID);
            return 1;
        }).when(jobLogMapper).insert(any(JobLogDO.class));

        jobLogService.createJobLog(7L, LocalDateTime.now(), "testHandler", null, 0);

        ArgumentCaptor<JobLogDO> captor = ArgumentCaptor.forClass(JobLogDO.class);
        verify(jobLogMapper).insert(captor.capture());
        assertThat(captor.getValue().getExecuteIndex()).isZero();
        assertThat(captor.getValue().getHandlerParam()).isNull();
    }

    /** 执行成功时把状态写成成功并带上耗时与结果文本。 */
    @Test
    void updateJobLogResultAsyncMarksSuccess() {
        LocalDateTime endTime = LocalDateTime.of(2026, 1, 2, 3, 5, 5);

        jobLogService.updateJobLogResultAsync(GENERATED_ID, endTime, 120, true, "ok");

        ArgumentCaptor<JobLogDO> captor = ArgumentCaptor.forClass(JobLogDO.class);
        verify(jobLogMapper).updateById(captor.capture());
        assertThat(captor.getValue().getStatus()).isEqualTo(JobLogStatusEnum.SUCCESS.getStatus());
        assertThat(captor.getValue().getDuration()).isEqualTo(120);
        assertThat(captor.getValue().getEndTime()).isEqualTo(endTime);
        assertThat(captor.getValue().getResult()).isEqualTo("ok");
    }

    /** 执行失败时状态写成失败，结果文本保留异常摘要供后台排查。 */
    @Test
    void updateJobLogResultAsyncMarksFailure() {
        jobLogService.updateJobLogResultAsync(GENERATED_ID, LocalDateTime.now(), 30, false, "boom");

        ArgumentCaptor<JobLogDO> captor = ArgumentCaptor.forClass(JobLogDO.class);
        verify(jobLogMapper).updateById(captor.capture());
        assertThat(captor.getValue().getStatus()).isEqualTo(JobLogStatusEnum.FAILURE.getStatus());
        assertThat(captor.getValue().getResult()).isEqualTo("boom");
        assertThat(captor.getValue().getId()).isEqualTo(GENERATED_ID);
    }

    /** 写结果失败时不能打断 Quartz 执行线程，异常被吞掉且不再重试写入。 */
    @Test
    void updateJobLogResultAsyncSwallowsWriteFailure() {
        doThrow(new IllegalStateException("db down")).when(jobLogMapper).updateById(any(JobLogDO.class));

        assertThatCode(() -> jobLogService.updateJobLogResultAsync(
                GENERATED_ID, LocalDateTime.now(), 10, true, "ok")).doesNotThrowAnyException();
        verify(jobLogMapper, times(1)).updateById(any(JobLogDO.class));
    }

    /** 首批就没删满即停止，返回值等于该批实际删掉的条数，不做第二次删除。 */
    @Test
    void cleanJobLogStopsWhenBatchNotFull() {
        when(jobLogMapper.deleteByCreateTimeLt(any(), anyInt())).thenReturn(30, 5);

        Integer count = jobLogService.cleanJobLog(14, 100);

        assertThat(count).isEqualTo(30);
        verify(jobLogMapper, times(1)).deleteByCreateTimeLt(any(LocalDateTime.class), anyInt());
    }

    /** 连续删满多批后才停止，累计条数是各批之和。 */
    @Test
    void cleanJobLogKeepsDeletingWhileBatchIsFull() {
        when(jobLogMapper.deleteByCreateTimeLt(any(), anyInt())).thenReturn(100, 100, 40);

        Integer count = jobLogService.cleanJobLog(14, 100);

        assertThat(count).isEqualTo(240);
        verify(jobLogMapper, times(3)).deleteByCreateTimeLt(any(LocalDateTime.class), anyInt());
    }

    /** 已经删空时只发一次删除请求，不做无谓的重复删除。 */
    @Test
    void cleanJobLogStopsAfterFirstEmptyBatch() {
        when(jobLogMapper.deleteByCreateTimeLt(any(), anyInt())).thenReturn(0);

        Integer count = jobLogService.cleanJobLog(14, 100);

        assertThat(count).isZero();
        verify(jobLogMapper, times(1)).deleteByCreateTimeLt(any(LocalDateTime.class), anyInt());
    }

    /** 删除截止时间是"当前时间减保留天数"，而不是固定时刻。 */
    @Test
    void cleanJobLogUsesRetentionDaysAsExpiryBoundary() {
        when(jobLogMapper.deleteByCreateTimeLt(any(), anyInt())).thenReturn(0);
        LocalDateTime lowerBound = LocalDateTime.now().minusDays(30);

        jobLogService.cleanJobLog(30, 100);

        ArgumentCaptor<LocalDateTime> captor = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(jobLogMapper).deleteByCreateTimeLt(captor.capture(), anyInt());
        assertThat(captor.getValue()).isBetween(lowerBound.minusMinutes(1), LocalDateTime.now().minusDays(30).plusMinutes(1));
    }

    /** 每批删除条数按调用方给定的上限下发，分批而不是一次性全删。 */
    @Test
    void cleanJobLogHonoursBatchLimit() {
        when(jobLogMapper.deleteByCreateTimeLt(any(), anyInt())).thenReturn(10, 0);

        jobLogService.cleanJobLog(7, 10);

        ArgumentCaptor<Integer> captor = ArgumentCaptor.forClass(Integer.class);
        verify(jobLogMapper, times(2)).deleteByCreateTimeLt(any(LocalDateTime.class), captor.capture());
        assertThat(captor.getAllValues()).containsExactly(10, 10);
    }

    /** 单批删除条数超过上限时按上限截断统计，不允许出现负数或超发统计。 */
    @Test
    void cleanJobLogAggregatesWithoutOverflow() {
        when(jobLogMapper.deleteByCreateTimeLt(any(), anyInt())).thenReturn(100, 100, 100, 3);

        Integer count = jobLogService.cleanJobLog(14, 100);

        assertThat(count).isEqualTo(303);
        assertThat(count).isPositive();
        verify(jobLogMapper, times(4)).deleteByCreateTimeLt(any(LocalDateTime.class), anyInt());
    }

    /** 按编号与分页读取日志都直接透传持久层结果。 */
    @Test
    void readQueriesDelegateToMapper() {
        JobLogDO log = new JobLogDO();
        log.setId(GENERATED_ID);
        when(jobLogMapper.selectById(GENERATED_ID)).thenReturn(log);
        JobLogPageReqVO pageReqVO = new JobLogPageReqVO();
        PageResult<JobLogDO> pageResult = new PageResult<>(List.of(log), 1L);
        when(jobLogMapper.selectPage(pageReqVO)).thenReturn(pageResult);

        assertThat(jobLogService.getJobLog(GENERATED_ID)).isSameAs(log);
        assertThat(jobLogService.getJobLogPage(pageReqVO)).isSameAs(pageResult);
        verify(jobLogMapper).selectById(GENERATED_ID);
        verify(jobLogMapper).selectPage(pageReqVO);
    }

    /** 清理与读取都不会创建新的日志记录，删除动作不影响日志留痕。 */
    @Test
    void cleanJobLogNeverInserts() {
        when(jobLogMapper.deleteByCreateTimeLt(any(), anyInt())).thenReturn(0);

        jobLogService.cleanJobLog(14, 100);

        verify(jobLogMapper, never()).insert(any(JobLogDO.class));
        verify(jobLogMapper, never()).selectById(anyLong());
    }
}