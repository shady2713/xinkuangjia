package com.basicframework.framework.quartz.core.scheduler;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.quartz.core.enums.JobDataKeyEnum;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.quartz.JobDetail;
import org.quartz.JobKey;
import org.quartz.Scheduler;
import org.quartz.Trigger;
import org.quartz.TriggerKey;

import static com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants.NOT_IMPLEMENTED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * 验证 {@link SchedulerManager} 在启用与禁用 Quartz 两种状态下的调度行为。
 *
 * @author shady2713
 */
class SchedulerManagerTest {

    /**
     * 验证未注入 Quartz {@link Scheduler} 时返回未启用标记，且写操作快速抛出 {@code NOT_IMPLEMENTED}。
     */
    @Test
    void disabledSchedulerRejectsMutations() {
        SchedulerManager manager = new SchedulerManager(null);

        assertThat(manager.isEnabled()).isFalse();
        assertThatThrownBy(() -> manager.addJob(1L, "cleanAccessLogJob", "", "0 0 2 * * ?", 2, 1000))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(NOT_IMPLEMENTED.getCode()));
    }

    /**
     * 验证启用 Quartz 后新增、暂停、恢复、触发与删除任务均按处理器名称委托到底层调度器。
     */
    @Test
    void enabledSchedulerDelegatesLifecycleOperations() throws Exception {
        Scheduler scheduler = mock(Scheduler.class);
        SchedulerManager manager = new SchedulerManager(scheduler);

        assertThat(manager.isEnabled()).isTrue();
        manager.addJob(7L, "sampleJob", "{\"days\":7}", "0 0/5 * * * ?", null, null);

        ArgumentCaptor<JobDetail> jobCaptor = ArgumentCaptor.forClass(JobDetail.class);
        ArgumentCaptor<Trigger> triggerCaptor = ArgumentCaptor.forClass(Trigger.class);
        verify(scheduler).scheduleJob(jobCaptor.capture(), triggerCaptor.capture());
        assertThat(jobCaptor.getValue().getKey()).isEqualTo(new JobKey("sampleJob"));
        assertThat(jobCaptor.getValue().getJobDataMap().getLong(JobDataKeyEnum.JOB_ID.name())).isEqualTo(7L);
        assertThat(triggerCaptor.getValue().getJobDataMap().getInt(JobDataKeyEnum.JOB_RETRY_COUNT.name())).isZero();

        manager.pauseJob("sampleJob");
        verify(scheduler).pauseJob(new JobKey("sampleJob"));

        manager.resumeJob("sampleJob");
        verify(scheduler).resumeJob(new JobKey("sampleJob"));
        verify(scheduler).resumeTrigger(new TriggerKey("sampleJob"));

        manager.triggerJob(7L, "sampleJob", "manual");
        manager.deleteJob("sampleJob");
        verify(scheduler).pauseTrigger(new TriggerKey("sampleJob"));
        verify(scheduler).unscheduleJob(new TriggerKey("sampleJob"));
        verify(scheduler).deleteJob(new JobKey("sampleJob"));
    }

}
