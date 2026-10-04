package com.basicframework.framework.quartz.config;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.quartz.core.enums.JobDataKeyEnum;
import com.basicframework.framework.quartz.core.handler.JobHandlerInvoker;
import com.basicframework.framework.quartz.core.scheduler.SchedulerManager;
import org.junit.jupiter.api.Test;
import org.quartz.CronTrigger;
import org.quartz.JobDetail;
import org.quartz.Scheduler;
import org.quartz.Trigger;
import org.quartz.TriggerKey;
import org.mockito.ArgumentCaptor;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * 校验 Quartz 自动配置按“调度器是否存在”装配可用或禁用管理器的真实行为。
 *
 * <p>Quartz 可能被显式排除（例如不需要定时任务的部署形态），此时容器里没有
 * {@link Scheduler}，自动配置必须仍然提供 {@link SchedulerManager} Bean，并把禁用状态
 * 如实传递下去：调用方在新增、修改任务时得到 501 的明确提示，而不是空指针或静默不生效。
 * 调度器存在时必须把该实例本身交给管理器，并携带正确的任务标识、Cron 表达式与重试参数，
 * 否则任务会以错误的键注册或被挂到错误的调度器上。</p>
 *
 * @author shady2713
 */
class BasicFrameworkQuartzAutoConfigurationTest {

    /** 未启用 Quartz 时必须装配“禁用”管理器，所有任务操作都给出 501 明确提示。 */
    @Test
    void schedulerManagerWithoutSchedulerFailsFastOnEveryOperation() {
        SchedulerManager manager = new BasicFrameworkQuartzAutoConfiguration()
                .schedulerManager(Optional.empty());

        assertThatThrownBy(() -> manager.addJob(1L, "demoJob", "{}", "0/5 * * * * ?", null, null))
                .isInstanceOf(ServiceException.class)
                .hasMessageContaining("[定时任务 - 已禁用]")
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(501);
        assertThatThrownBy(() -> manager.updateJob("demoJob", "{}", "0/5 * * * * ?", null, null))
                .isInstanceOf(ServiceException.class);
        assertThatThrownBy(() -> manager.deleteJob("demoJob"))
                .isInstanceOf(ServiceException.class);
        assertThatThrownBy(() -> manager.pauseJob("demoJob"))
                .isInstanceOf(ServiceException.class);
        assertThatThrownBy(() -> manager.resumeJob("demoJob"))
                .isInstanceOf(ServiceException.class);
        assertThatThrownBy(() -> manager.triggerJob(1L, "demoJob", "{}"))
                .isInstanceOf(ServiceException.class);
    }

    /** 容器中存在调度器时必须交给管理器使用，并按任务标识与重试参数真实注册。 */
    @Test
    void schedulerManagerUsesPresentSchedulerWithJobIdentityAndRetryData() throws Exception {
        Scheduler scheduler = mock(Scheduler.class);
        SchedulerManager manager = new BasicFrameworkQuartzAutoConfiguration()
                .schedulerManager(Optional.of(scheduler));

        manager.addJob(66L, "demoJob", "{\"id\":1}", "0/5 * * * * ?", null, null);

        ArgumentCaptor<JobDetail> jobDetailCaptor = ArgumentCaptor.forClass(JobDetail.class);
        ArgumentCaptor<Trigger> triggerCaptor = ArgumentCaptor.forClass(Trigger.class);
        verify(scheduler).scheduleJob(jobDetailCaptor.capture(), triggerCaptor.capture());

        JobDetail jobDetail = jobDetailCaptor.getValue();
        assertThat(jobDetail.getJobClass()).isEqualTo(JobHandlerInvoker.class);
        assertThat(jobDetail.getKey().getName()).as("任务处理器名即唯一标识").isEqualTo("demoJob");
        assertThat(jobDetail.getJobDataMap().getLong(JobDataKeyEnum.JOB_ID.name())).isEqualTo(66L);
        assertThat(jobDetail.getJobDataMap().getString(JobDataKeyEnum.JOB_HANDLER_NAME.name()))
                .isEqualTo("demoJob");

        Trigger trigger = triggerCaptor.getValue();
        assertThat(trigger.getKey().getName()).isEqualTo("demoJob");
        assertThat(((CronTrigger) trigger).getCronExpression()).isEqualTo("0/5 * * * * ?");
        assertThat(trigger.getJobDataMap().getString(JobDataKeyEnum.JOB_HANDLER_PARAM.name()))
                .isEqualTo("{\"id\":1}");
        assertThat(trigger.getJobDataMap().getInt(JobDataKeyEnum.JOB_RETRY_COUNT.name()))
                .as("重试次数为空时按 0 处理").isZero();
        assertThat(trigger.getJobDataMap().getInt(JobDataKeyEnum.JOB_RETRY_INTERVAL.name()))
                .as("重试间隔为空时按 0 处理").isZero();
    }

    /** 更新任务时必须按同一任务标识重排触发器，并写入显式给定的重试参数。 */
    @Test
    void schedulerManagerReschedulesTriggerOnUpdate() throws Exception {
        Scheduler scheduler = mock(Scheduler.class);
        SchedulerManager manager = new BasicFrameworkQuartzAutoConfiguration()
                .schedulerManager(Optional.of(scheduler));

        manager.updateJob("demoJob", "{\"id\":2}", "0/9 * * * * ?", 3, 5000);

        ArgumentCaptor<TriggerKey> triggerKeyCaptor = ArgumentCaptor.forClass(TriggerKey.class);
        ArgumentCaptor<Trigger> triggerCaptor = ArgumentCaptor.forClass(Trigger.class);
        verify(scheduler).rescheduleJob(triggerKeyCaptor.capture(), triggerCaptor.capture());

        assertThat(triggerKeyCaptor.getValue().getName()).isEqualTo("demoJob");
        assertThat(((CronTrigger) triggerCaptor.getValue()).getCronExpression()).isEqualTo("0/9 * * * * ?");
        assertThat(triggerCaptor.getValue().getJobDataMap().getInt(JobDataKeyEnum.JOB_RETRY_COUNT.name()))
                .isEqualTo(3);
        assertThat(triggerCaptor.getValue().getJobDataMap().getInt(JobDataKeyEnum.JOB_RETRY_INTERVAL.name()))
                .isEqualTo(5000);
    }
}
