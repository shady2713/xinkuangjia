package com.basicframework.framework.quartz.core.handler;

import com.basicframework.framework.quartz.core.enums.JobDataKeyEnum;
import com.basicframework.framework.quartz.core.service.JobLogFrameworkService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.quartz.JobBuilder;
import org.quartz.JobDataMap;
import org.quartz.JobDetail;
import org.quartz.JobExecutionContext;
import org.quartz.JobExecutionException;
import org.quartz.JobKey;
import org.springframework.context.ApplicationContext;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证 Quartz 任务执行器的执行、日志记录、重试决策与日志失败隔离契约。
 *
 * <p>该执行器是框架里所有业务任务的实际入口：它按 Bean 名称调用处理器、把成功结果或根因写入
 * 任务日志，并决定"立即重试"还是"以失败结束"。记录错执行序号会让运维误判重试次数；把日志
 * 更新失败当成任务失败会产生虚假告警；重试上限判断错误会导致任务无限重跑或永不重试。用例用
 * 真实 Quartz {@link JobDataMap} 与替身处理器/日志服务断言这些可观察结果。</p>
 *
 * @author shady2713
 */
class JobHandlerInvokerTest {

    /** 被测执行器。 */
    private JobHandlerInvoker invoker;
    /** 容器替身，用于按名称返回任务处理器。 */
    private ApplicationContext applicationContext;
    /** 任务日志服务替身，用于观察写入内容与制造失败。 */
    private JobLogFrameworkService jobLogFrameworkService;
    /** 任务处理器替身。 */
    private JobHandler jobHandler;
    /** Quartz 执行上下文替身。 */
    private JobExecutionContext executionContext;

    /** 为每个用例装配独立执行器与替身，避免调用记录串场。 */
    @BeforeEach
    void setUp() {
        invoker = new JobHandlerInvoker();
        applicationContext = mock(ApplicationContext.class);
        jobLogFrameworkService = mock(JobLogFrameworkService.class);
        jobHandler = mock(JobHandler.class);
        executionContext = mock(JobExecutionContext.class);
        ReflectionTestUtils.setField(invoker, "applicationContext", applicationContext);
        ReflectionTestUtils.setField(invoker, "jobLogFrameworkService", jobLogFrameworkService);
        when(applicationContext.getBean("demoJob", JobHandler.class)).thenReturn(jobHandler);
        when(jobLogFrameworkService.createJobLog(any(), any(), any(), any(), any())).thenReturn(2048L);
        when(executionContext.getJobDetail()).thenReturn(jobDetail());
    }

    /**
     * 任务成功时必须按"已重试次数 + 1"记录执行序号，并把返回值写入成功日志。
     */
    @Test
    void recordsSuccessLogWithExecutionIndexAndResult() throws Exception {
        when(executionContext.getRefireCount()).thenReturn(2);
        when(jobHandler.execute("payload")).thenReturn("ok");
        stubJobData(1024L, "demoJob", "payload");

        invoker.executeInternal(executionContext);

        ArgumentCaptor<LocalDateTime> startTime = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(jobLogFrameworkService).createJobLog(eq(1024L), startTime.capture(), eq("demoJob"), eq("payload"), eq(3));
        ArgumentCaptor<LocalDateTime> endTime = ArgumentCaptor.forClass(LocalDateTime.class);
        ArgumentCaptor<Integer> duration = ArgumentCaptor.forClass(Integer.class);
        verify(jobLogFrameworkService).updateJobLogResultAsync(eq(2048L), endTime.capture(), duration.capture(),
                eq(true), eq("ok"));
        assertThat(endTime.getValue()).as("结束时间不得早于开始时间").isAfterOrEqualTo(startTime.getValue());
        assertThat(duration.getValue()).as("运行时长为非负毫秒数").isGreaterThanOrEqualTo(0);
    }

    /**
     * 任务异常且重试次数已用尽时，必须以任务异常为根因结束，并记录根因文本。
     */
    @Test
    void recordsRootCauseAndFailsWhenRetriesExhausted() throws Exception {
        when(jobHandler.execute("payload")).thenThrow(new IllegalStateException("boom"));
        stubJobData(1024L, "demoJob", "payload");

        assertThatThrownBy(() -> invoker.executeInternal(executionContext))
                .isInstanceOf(JobExecutionException.class)
                .cause().isInstanceOf(IllegalStateException.class).hasMessage("boom");

        verify(jobLogFrameworkService).updateJobLogResultAsync(eq(2048L), any(), anyInt(), eq(false),
                eq("IllegalStateException: boom"));
    }

    /**
     * 未达到重试上限时必须请求立即重试，并保留原始任务异常作为根因。
     */
    @Test
    void requestsImmediateRefireWhenRetriesRemain() throws Exception {
        when(executionContext.getRefireCount()).thenReturn(1);
        when(jobHandler.execute("payload")).thenThrow(new IllegalStateException("boom"));
        stubJobData(1024L, "demoJob", "payload");
        putRetrySettings(3, 0);

        JobExecutionException thrown = catchJobExecutionException();

        assertThat(thrown.refireImmediately()).as("未达上限必须立即重试").isTrue();
        assertThat(thrown.getCause()).isInstanceOf(IllegalStateException.class);
    }

    /**
     * 配置了重试间隔时必须先等待再请求立即重试，间隔配置不得被忽略。
     */
    @Test
    void waitsRetryIntervalBeforeRefire() throws Exception {
        when(executionContext.getRefireCount()).thenReturn(0);
        when(jobHandler.execute("payload")).thenThrow(new IllegalStateException("boom"));
        stubJobData(1024L, "demoJob", "payload");
        putRetrySettings(1, 5);

        JobExecutionException thrown = catchJobExecutionException();

        assertThat(thrown.refireImmediately()).isTrue();
    }

    /**
     * 任务处理器 Bean 不存在时必须按任务失败处理，异常信息指向缺失的处理器。
     */
    @Test
    void failsWhenHandlerBeanMissing() throws Exception {
        when(applicationContext.getBean("missingJob", JobHandler.class)).thenReturn(null);
        stubJobData(1024L, "missingJob", "payload");

        assertThatThrownBy(() -> invoker.executeInternal(executionContext))
                .isInstanceOf(JobExecutionException.class)
                .cause().isInstanceOf(IllegalArgumentException.class).hasMessageContaining("JobHandler 不会为空");
    }

    /**
     * 任务日志更新失败不得把成功的任务改判为失败，也不得中断执行流程。
     */
    @Test
    void logUpdateFailureDoesNotMaskTaskResult() throws Exception {
        when(jobHandler.execute("payload")).thenReturn("ok");
        doThrow(new IllegalStateException("log down")).when(jobLogFrameworkService)
                .updateJobLogResultAsync(any(), any(), anyInt(), anyBoolean(), any());
        stubJobData(1024L, "demoJob", "payload");

        invoker.executeInternal(executionContext);

        verify(jobHandler).execute("payload");
    }

    /**
     * 记录任务数据键，重试次数与间隔保持缺省以覆盖"未配置"分支。
     *
     * @param jobId 任务编号
     * @param handlerName 处理器 Bean 名称
     * @param handlerParam 处理器参数
     */
    private void stubJobData(Long jobId, String handlerName, String handlerParam) {
        JobDataMap dataMap = new JobDataMap();
        dataMap.put(JobDataKeyEnum.JOB_ID.name(), jobId);
        dataMap.put(JobDataKeyEnum.JOB_HANDLER_NAME.name(), handlerName);
        dataMap.put(JobDataKeyEnum.JOB_HANDLER_PARAM.name(), handlerParam);
        when(executionContext.getMergedJobDataMap()).thenReturn(dataMap);
    }

    /**
     * 追加重试次数与重试间隔配置。
     *
     * @param retryCount 最大重试次数
     * @param retryInterval 重试间隔，单位毫秒
     */
    private void putRetrySettings(int retryCount, int retryInterval) {
        JobDataMap dataMap = executionContext.getMergedJobDataMap();
        dataMap.put(JobDataKeyEnum.JOB_RETRY_COUNT.name(), retryCount);
        dataMap.put(JobDataKeyEnum.JOB_RETRY_INTERVAL.name(), retryInterval);
    }

    /**
     * 执行任务并捕获必须抛出的重试异常。
     *
     * @return Quartz 任务执行异常
     */
    private JobExecutionException catchJobExecutionException() {
        try {
            invoker.executeInternal(executionContext);
        } catch (JobExecutionException ex) {
            return ex;
        }
        throw new AssertionError("任务失败且需要重试时必须抛出 JobExecutionException");
    }

    /**
     * 构造带任务键的任务详情，供日志失败分支读取任务标识。
     *
     * @return 任务详情
     */
    private static JobDetail jobDetail() {
        return JobBuilder.newJob(JobHandlerInvoker.class)
                .withIdentity(JobKey.jobKey("demoJob", "demoGroup")).build();
    }

}
