package com.basicframework.module.infra.framework.job;

import com.basicframework.framework.quartz.core.scheduler.SchedulerManager;
import com.basicframework.module.infra.service.job.JobService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * 应用启动期 Quartz 定时任务自动同步器。
 *
 * <p>默认使用内存 {@code RAMJobStore} 时，进程重启会清空已注册调度器；本组件在应用就绪后将
 * {@code infra_job} 表中的任务配置自动恢复至 Quartz，消除人工调用同步接口的运维缺口。</p>
 *
 * @author shady2713
 */
@Component
@ConditionalOnProperty(prefix = "basic-framework.quartz", name = "auto-sync", havingValue = "true", matchIfMissing = true)
@RequiredArgsConstructor
@Slf4j
public class JobStartupSyncRunner implements ApplicationRunner {

    private final SchedulerManager schedulerManager;
    private final JobService jobService;

    /**
     * 在应用启动完成后同步数据库中的定时任务至 Quartz 调度器。
     *
     * @param args 启动参数
     */
    @Override
    public void run(ApplicationArguments args) {
        if (!schedulerManager.isEnabled()) {
            return;
        }
        try {
            jobService.syncJob();
        } catch (Exception ex) {
            log.error("[run][启动同步定时任务到 Quartz 失败]", ex);
        }
    }

}
