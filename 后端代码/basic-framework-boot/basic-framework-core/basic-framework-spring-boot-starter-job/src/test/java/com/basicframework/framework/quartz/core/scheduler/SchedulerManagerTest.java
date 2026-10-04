package com.basicframework.framework.quartz.core.scheduler;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.quartz.core.enums.JobDataKeyEnum;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.quartz.Job;
import org.quartz.JobBuilder;
import org.quartz.JobExecutionContext;
import org.quartz.JobKey;
import org.quartz.Scheduler;
import org.quartz.SchedulerException;
import org.quartz.SimpleScheduleBuilder;
import org.quartz.Trigger;
import org.quartz.TriggerBuilder;
import org.quartz.TriggerKey;
import org.quartz.impl.StdSchedulerFactory;

import java.time.Instant;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证 Quartz 任务管理器在真实调度器上的注册、暂停、恢复、删除与立即触发行为。
 *
 * <p>任务的启停直接改变线上调度：暂停与恢复写错会让任务无法执行或重复执行，删除写错会留下
 * 无法再创建的孤儿 Job，立即触发写错会让任务拿到空的参数或错误的任务编号。因此这里使用真实的
 * Quartz {@link Scheduler}（RAMJobStore）与线程池，断言调度器上可观察的状态与真实执行副作用：</p>
 * <ul>
 *   <li>Job 与 Trigger 使用同一个 handler 名称作为唯一标识，且触发数据带上重试默认值 0；</li>
 *   <li>暂停把 Trigger 置为 PAUSED、恢复回到 NORMAL；</li>
 *   <li>删除同时移除 Trigger 与 Job，且对不存在的任务幂等无异常；</li>
 *   <li>立即触发真实执行一次 Job，并把任务编号、处理器名称与参数合并进执行数据；</li>
 *   <li>Quartz 被禁用（构造传入 null）时每个操作都必须以"功能未实现"失败，而不是静默无效。</li>
 * </ul>
 *
 * @author shady2713
 */
class SchedulerManagerTest {

    /** 未来很久才到期的 CRON，保证用例期间不会被调度器自动触发。 */
    private static final String FAR_FUTURE_CRON = "0 0 3 1 1 ? 2099";

    /** 本用例独占的调度器与任务名称，避免用例之间共享状态。 */
    private final String suffix = UUID.randomUUID().toString().replace("-", "");

    /** 真实 Quartz 调度器。 */
    private Scheduler scheduler;
    /** 被测的任务管理器。 */
    private SchedulerManager schedulerManager;

    /** 启动一个使用内存 JobStore 的真实调度器，使状态与执行都可观察。 */
    @BeforeEach
    void setUp() throws SchedulerException {
        Properties properties = new Properties();
        properties.setProperty("org.quartz.scheduler.instanceName", "scheduler-manager-test-" + suffix);
        properties.setProperty("org.quartz.scheduler.instanceId", "AUTO");
        properties.setProperty("org.quartz.threadPool.threadCount", "2");
        properties.setProperty("org.quartz.jobStore.class", "org.quartz.simpl.RAMJobStore");
        scheduler = new StdSchedulerFactory(properties).getScheduler();
        scheduler.start();
        schedulerManager = new SchedulerManager(scheduler);
    }

    /** 关闭调度器并释放线程池，避免用例之间残留调度线程。 */
    @AfterEach
    void tearDown() throws SchedulerException {
        if (scheduler != null) {
            scheduler.shutdown(true);
        }
    }

    /** 新增任务必须注册 Job 与 Trigger，并把重试参数写入执行数据。 */
    @Test
    void addJobRegistersJobAndTriggerWithRetryDefaults() throws SchedulerException {
        String handlerName = "handler-add-" + suffix;

        schedulerManager.addJob(10L, handlerName, "DUMMY-PARAM", FAR_FUTURE_CRON, 3, 2000);

        JobKey jobKey = JobKey.jobKey(handlerName);
        TriggerKey triggerKey = TriggerKey.triggerKey(handlerName);
        assertThat(scheduler.checkExists(jobKey)).as("Job 必须以 handler 名称登记").isTrue();
        assertThat(scheduler.checkExists(triggerKey)).isTrue();
        assertThat(scheduler.getJobDetail(jobKey).getJobDataMap().get(JobDataKeyEnum.JOB_ID.name())).isEqualTo(10L);
        assertThat(scheduler.getJobDetail(jobKey).getJobDataMap().get(JobDataKeyEnum.JOB_HANDLER_NAME.name()))
                .isEqualTo(handlerName);
        assertThat(scheduler.getTrigger(triggerKey).getJobDataMap().get(JobDataKeyEnum.JOB_HANDLER_PARAM.name()))
                .isEqualTo("DUMMY-PARAM");
        assertThat(scheduler.getTrigger(triggerKey).getJobDataMap().get(JobDataKeyEnum.JOB_RETRY_COUNT.name())).isEqualTo(3);
        assertThat(scheduler.getTrigger(triggerKey).getJobDataMap().get(JobDataKeyEnum.JOB_RETRY_INTERVAL.name())).isEqualTo(2000);
        assertThat(scheduler.getTriggerState(triggerKey)).isEqualTo(Trigger.TriggerState.NORMAL);
    }

    /** 暂停与恢复必须反映到 Trigger 的真实状态上。 */
    @Test
    void pauseAndResumeSwitchTriggerState() throws SchedulerException {
        String handlerName = "handler-pause-" + suffix;
        schedulerManager.addJob(11L, handlerName, null, FAR_FUTURE_CRON, null, null);
        TriggerKey triggerKey = TriggerKey.triggerKey(handlerName);

        schedulerManager.pauseJob(handlerName);

        assertThat(scheduler.getTriggerState(triggerKey)).as("暂停后 Trigger 必须为 PAUSED")
                .isEqualTo(Trigger.TriggerState.PAUSED);
        assertThat(scheduler.getTrigger(triggerKey).getJobDataMap().get(JobDataKeyEnum.JOB_RETRY_COUNT.name()))
                .as("空重试次数按 0 处理").isEqualTo(0);

        schedulerManager.resumeJob(handlerName);

        assertThat(scheduler.getTriggerState(triggerKey)).as("恢复后 Trigger 必须回到 NORMAL")
                .isEqualTo(Trigger.TriggerState.NORMAL);
    }

    /** 删除必须同时移除 Trigger 与 Job，并对不存在的任务保持幂等。 */
    @Test
    void deleteJobRemovesTriggerAndJobIdempotently() throws SchedulerException {
        String handlerName = "handler-delete-" + suffix;
        schedulerManager.addJob(12L, handlerName, "DUMMY-PARAM", FAR_FUTURE_CRON, null, null);
        TriggerKey triggerKey = TriggerKey.triggerKey(handlerName);
        JobKey jobKey = JobKey.jobKey(handlerName);
        schedulerManager.pauseJob(handlerName);

        schedulerManager.deleteJob(handlerName);

        assertThat(scheduler.getTrigger(triggerKey)).as("删除后 Trigger 必须不可见").isNull();
        assertThat(scheduler.checkExists(jobKey)).as("删除后 Job 必须不可见").isFalse();
        assertThatCode(() -> schedulerManager.deleteJob(handlerName))
                .as("重复删除不得抛错").doesNotThrowAnyException();
    }

    /**
     * 立即触发必须真实执行一次任务，并携带任务编号、处理器名称与参数。
     *
     * <p>执行数据由调度器合并，只有真实执行才能证明数据到达处理器；这里用只负责记录的真实
     * Job 实现与执行监听等待结果，并断言"只执行一次"和"不携带重试参数"两个契约。</p>
     */
    @Test
    void triggerJobExecutesOnceWithMergedData() throws Exception {
        String handlerName = "handler-trigger-" + suffix;
        RecordingJob.reset();
        scheduler.scheduleJob(
                JobBuilder.newJob(RecordingJob.class).withIdentity(handlerName).build(),
                TriggerBuilder.newTrigger().withIdentity(handlerName)
                        // 起始时间放到未来，保证本用例唯一的执行来自立即触发
                        .startAt(Date.from(Instant.now().plusSeconds(3600)))
                        .withSchedule(SimpleScheduleBuilder.simpleSchedule()
                                .withIntervalInHours(1).repeatForever())
                        .build());
        schedulerManager.triggerJob(13L, handlerName, "DUMMY-PARAM");

        assertThat(RecordingJob.awaitExecution(5, TimeUnit.SECONDS)).as("立即触发必须真实执行任务").isTrue();
        assertThat(RecordingJob.executionCount()).isEqualTo(1);
        assertThat(RecordingJob.mergedData())
                .containsEntry(JobDataKeyEnum.JOB_ID.name(), 13L)
                .containsEntry(JobDataKeyEnum.JOB_HANDLER_NAME.name(), handlerName)
                .containsEntry(JobDataKeyEnum.JOB_HANDLER_PARAM.name(), "DUMMY-PARAM")
                .as("立即触发不设置重试参数").doesNotContainKeys(
                        JobDataKeyEnum.JOB_RETRY_COUNT.name(), JobDataKeyEnum.JOB_RETRY_INTERVAL.name());
    }

    /** Quartz 被禁用时每个操作都必须以"功能未实现"失败，不能静默无效。 */
    @Test
    void disabledSchedulerRejectsEveryOperation() {
        SchedulerManager disabled = new SchedulerManager(null);

        assertThatThrownBy(() -> disabled.addJob(1L, "handler", null, FAR_FUTURE_CRON, null, null))
                .isInstanceOf(ServiceException.class).hasMessageContaining("定时任务 - 已禁用");
        assertThatThrownBy(() -> disabled.updateJob("handler", null, FAR_FUTURE_CRON, null, null))
                .isInstanceOf(ServiceException.class).hasMessageContaining("定时任务 - 已禁用");
        assertThatThrownBy(() -> disabled.deleteJob("handler"))
                .isInstanceOf(ServiceException.class).hasMessageContaining("定时任务 - 已禁用");
        assertThatThrownBy(() -> disabled.pauseJob("handler"))
                .isInstanceOf(ServiceException.class).hasMessageContaining("定时任务 - 已禁用");
        assertThatThrownBy(() -> disabled.resumeJob("handler"))
                .isInstanceOf(ServiceException.class).hasMessageContaining("定时任务 - 已禁用");
        assertThatThrownBy(() -> disabled.triggerJob(1L, "handler", null))
                .isInstanceOf(ServiceException.class).hasMessageContaining("定时任务 - 已禁用");
    }

    /**
     * 只记录执行数据的真实 Job 实现，用于观察立即触发是否真实执行以及合并后的执行数据。
     *
     * @author shady2713
     */
    public static class RecordingJob implements Job {

        /** 每次执行的合并数据快照，按执行顺序追加。 */
        private static final List<Map<String, Object>> MERGED = new CopyOnWriteArrayList<>();

        /** 清空上一例的执行记录。 */
        static void reset() {
            MERGED.clear();
        }

        /**
         * 在超时预算内等待至少一次真实执行完成。
         *
         * @param timeout 超时时长
         * @param unit 时间单位
         * @return 超时前是否观察到执行
         * @throws InterruptedException 等待被中断时抛出
         */
        static boolean awaitExecution(long timeout, TimeUnit unit) throws InterruptedException {
            long deadline = System.nanoTime() + unit.toNanos(timeout);
            while (MERGED.isEmpty() && System.nanoTime() < deadline) {
                Thread.sleep(20L);
            }
            return !MERGED.isEmpty();
        }

        /**
         * 返回真实执行次数。
         *
         * @return 执行次数
         */
        static int executionCount() {
            return MERGED.size();
        }

        /**
         * 返回最近一次执行的合并数据快照。
         *
         * @return 合并数据
         */
        static Map<String, Object> mergedData() {
            return MERGED.get(MERGED.size() - 1);
        }

        /**
         * 记录本次执行的数据。
         *
         * @param context Quartz 执行上下文
         */
        @Override
        public void execute(JobExecutionContext context) {
            MERGED.add(new HashMap<>(context.getMergedJobDataMap()));
        }
    }

}
