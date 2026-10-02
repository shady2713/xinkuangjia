package com.basicframework.framework.quartz.core.handler;

import cn.hutool.core.date.LocalDateTimeUtil;
import cn.hutool.core.lang.Assert;
import cn.hutool.core.thread.ThreadUtil;
import com.basicframework.framework.quartz.core.enums.JobDataKeyEnum;
import com.basicframework.framework.quartz.core.service.JobLogFrameworkService;
import lombok.extern.slf4j.Slf4j;
import org.quartz.DisallowConcurrentExecution;
import org.quartz.JobExecutionContext;
import org.quartz.JobExecutionException;
import org.quartz.PersistJobDataAfterExecution;
import org.springframework.context.ApplicationContext;
import org.springframework.scheduling.quartz.QuartzJobBean;

import jakarta.annotation.Resource;
import java.time.LocalDateTime;

import static cn.hutool.core.exceptions.ExceptionUtil.getRootCauseMessage;

/**
 * 基础 Job 调用者，负责调用 {@link JobHandler#execute(String)} 执行任务
 *
 * @author 李杰
 */
@DisallowConcurrentExecution
@PersistJobDataAfterExecution
@Slf4j
public class JobHandlerInvoker extends QuartzJobBean {

    @Resource
    private ApplicationContext applicationContext;

    @Resource
    private JobLogFrameworkService jobLogFrameworkService;

    /**
     * 执行 Quartz 任务，记录执行结果，并按配置决定是否立即重试。
     *
     * @param executionContext Quartz 执行上下文
     * @throws JobExecutionException 任务执行失败或需要立即重试时抛出
     */
    @Override
    protected void executeInternal(JobExecutionContext executionContext) throws JobExecutionException {
        // 第一步，获得 Job 数据
        Long jobId = executionContext.getMergedJobDataMap().getLong(JobDataKeyEnum.JOB_ID.name());
        String jobHandlerName = executionContext.getMergedJobDataMap().getString(JobDataKeyEnum.JOB_HANDLER_NAME.name());
        String jobHandlerParam = executionContext.getMergedJobDataMap().getString(JobDataKeyEnum.JOB_HANDLER_PARAM.name());
        int refireCount  = executionContext.getRefireCount();
        int retryCount = (Integer) executionContext.getMergedJobDataMap().getOrDefault(JobDataKeyEnum.JOB_RETRY_COUNT.name(), 0);
        int retryInterval = (Integer) executionContext.getMergedJobDataMap().getOrDefault(JobDataKeyEnum.JOB_RETRY_INTERVAL.name(), 0);

        // 第二步，执行任务
        Long jobLogId = null;
        LocalDateTime startTime = LocalDateTime.now();
        String data = null;
        Exception exception = null;
        try {
            // 记录 Job 日志（初始）
            jobLogId = jobLogFrameworkService.createJobLog(jobId, startTime, jobHandlerName, jobHandlerParam, refireCount + 1);
            // 执行任务
            data = this.executeInternal(jobHandlerName, jobHandlerParam);
        } catch (Exception ex) {
            exception = ex;
        }

        // 第三步，记录执行日志
        this.updateJobLogResultAsync(jobLogId, startTime, data, exception, executionContext);

        // 第四步，处理有异常的情况
        handleException(exception, refireCount, retryCount, retryInterval);
    }

    /**
     * 根据名称获取并执行任务处理器。
     *
     * @param jobHandlerName 任务处理器 Bean 名称
     * @param jobHandlerParam 任务参数
     * @return 任务处理结果
     * @throws Exception 任务处理器执行失败时抛出
     */
    private String executeInternal(String jobHandlerName, String jobHandlerParam) throws Exception {
        // 获得 JobHandler 对象
        JobHandler jobHandler = applicationContext.getBean(jobHandlerName, JobHandler.class);
        Assert.notNull(jobHandler, "JobHandler 不会为空");
        // 执行任务
        return jobHandler.execute(jobHandlerParam);
    }

    /**
     * 异步更新任务执行日志；日志更新失败只记录告警，不覆盖原任务结果。
     *
     * @param jobLogId 任务日志编号
     * @param startTime 任务开始时间
     * @param data 任务返回数据
     * @param exception 任务异常，成功时为空
     * @param executionContext Quartz 执行上下文
     */
    private void updateJobLogResultAsync(Long jobLogId, LocalDateTime startTime, String data, Exception exception,
                                         JobExecutionContext executionContext) {
        LocalDateTime endTime = LocalDateTime.now();
        // 处理是否成功
        boolean success = exception == null;
        if (!success) {
            data = getRootCauseMessage(exception);
        }
        // 更新日志
        try {
            jobLogFrameworkService.updateJobLogResultAsync(jobLogId, endTime, (int) LocalDateTimeUtil.between(startTime, endTime).toMillis(), success, data);
        } catch (Exception ex) {
            log.error("[executeInternal][Job({}) logId({}) 记录执行日志失败({}/{})]",
                    executionContext.getJobDetail().getKey(), jobLogId, success, data, ex);
        }
    }

    /**
     * 处理任务异常，在未达到重试上限时按配置等待并请求 Quartz 立即重试。
     *
     * @param exception 任务异常，成功时为空
     * @param refireCount 当前已重试次数
     * @param retryCount 最大重试次数
     * @param retryInterval 重试间隔，单位毫秒
     * @throws JobExecutionException 任务最终失败或需要立即重试时抛出
     */
    private void handleException(Exception exception,
                                 int refireCount, int retryCount, int retryInterval) throws JobExecutionException {
        // 如果有异常，则进行重试
        if (exception == null) {
            return;
        }
        // 情况一：如果到达重试上限，则直接抛出异常即可
        if (refireCount >= retryCount) {
            throw new JobExecutionException(exception);
        }

        // 情况二：如果未到达重试上限，则 sleep 一定间隔时间，然后重试
        // 这里使用 sleep 来实现，主要还是希望实现比较简单。因为，同一时间，不会存在大量失败的 Job。
        if (retryInterval > 0) {
            ThreadUtil.sleep(retryInterval);
        }
        // 第二个参数，refireImmediately = true，表示立即重试
        throw new JobExecutionException(exception, true);
    }

}
