package com.basicframework.module.infra.job.job;

import com.basicframework.module.infra.service.job.JobLogService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证任务日志清理任务传给清理服务的保留天数、单批数量与返回描述。
 *
 * <p>任务日志清理属于运维口径：保留天数直接决定"能不能查到上周那次任务为什么没跑"，过短会把
 * 仍在排查窗口内的执行记录删掉；单批数量过大则会在日志高峰放大数据库压力。执行结果描述会写入
 * 任务日志本身，必须包含真实清理条数，否则运维无法从日志判断任务是否真的执行过。</p>
 *
 * <p>清理服务按外部边界替换为可观察替身，任务自身的调用口径与返回描述真实执行；断言同时核对
 * 替身收到的保留天数与单批条数，以及返回描述中的条数是否与清理服务一致。</p>
 *
 * @author shady2713
 */
class JobLogCleanJobTest {

    /** 被测任务，清理服务按外部边界替换为可观察替身。 */
    private JobLogCleanJob job;
    /** 记录调用参数的任务日志清理服务替身。 */
    private JobLogService jobLogService;

    /**
     * 为每个用例创建独立任务与替身，避免用例之间共享调用记录。
     */
    @BeforeEach
    void setUp() {
        job = new JobLogCleanJob();
        jobLogService = mock(JobLogService.class);
        ReflectionTestUtils.setField(job, "jobLogService", jobLogService);
    }

    /** 必须按保留 14 天、单批 100 条调用清理服务，并返回带真实条数的描述。 */
    @Test
    void executeCleansWithRetainDaysAndBatchLimit() {
        when(jobLogService.cleanJobLog(14, 100)).thenReturn(6);

        String result = job.execute("{}");

        verify(jobLogService).cleanJobLog(14, 100);
        verifyNoMoreInteractions(jobLogService);
        assertThat(result).isEqualTo("定时执行清理定时任务日志数量 6 个");
    }

    /** 没有可清理数据时必须如实返回 0，便于运维判断任务是否真的执行。 */
    @Test
    void executeReportsZeroWhenNothingIsCleaned() {
        when(jobLogService.cleanJobLog(14, 100)).thenReturn(0);

        assertThat(job.execute("")).isEqualTo("定时执行清理定时任务日志数量 0 个");
        verify(jobLogService).cleanJobLog(14, 100);
    }

    /** 清理条数超过单批上限时描述里的条数仍取清理服务返回的真实累计值。 */
    @Test
    void executeReportsAccumulatedCount() {
        when(jobLogService.cleanJobLog(14, 100)).thenReturn(350);

        assertThat(job.execute(null)).isEqualTo("定时执行清理定时任务日志数量 350 个");
        verify(jobLogService).cleanJobLog(14, 100);
    }

    /** 调度参数当前不参与清理逻辑，传入不同取值不得改变调用口径。 */
    @Test
    void executeIgnoresSchedulerParam() {
        when(jobLogService.cleanJobLog(14, 100)).thenReturn(2);

        job.execute("{\"retainDay\":1}");
        job.execute(null);

        verify(jobLogService, times(2)).cleanJobLog(14, 100);
    }

    /** 清理服务抛错时异常向上抛出，让调度框架按失败重试，而不是记成"清理成功 0 条"。 */
    @Test
    void executePropagatesCleanFailure() {
        when(jobLogService.cleanJobLog(14, 100)).thenThrow(new IllegalStateException("db down"));

        assertThatThrownBy(() -> job.execute(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("db down");
        verify(jobLogService).cleanJobLog(14, 100);
    }
}