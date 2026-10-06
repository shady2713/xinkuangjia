package com.basicframework.framework.quartz.config;

import com.basicframework.framework.quartz.core.scheduler.SchedulerManager;
import lombok.extern.slf4j.Slf4j;
import org.quartz.Scheduler;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.annotation.EnableScheduling;

import java.util.Optional;

/**
 * Quartz 定时任务自动配置类。
 *
 * <p>负责注册 {@link SchedulerManager}，并在 Quartz 自动配置被排除时提供不可用状态的管理器，
 * 让上层业务在调用时获得统一的错误提示。</p>
 *
 * @author 李杰
 * 署名验收：尚未验收
 */
@AutoConfiguration
@EnableScheduling // 开启 Spring 自带的定时任务
@Slf4j
public class BasicFrameworkQuartzAutoConfiguration {

    /**
     * 创建 Quartz 调度管理器。
     *
     * @param scheduler Spring 容器中的 Quartz 调度器，禁用 Quartz 时为空
     * @return Quartz 调度管理器
     */
    @Bean
    public SchedulerManager schedulerManager(Optional<Scheduler> scheduler) {
        if (!scheduler.isPresent()) {
            log.info("[定时任务 - 已禁用]");
            return new SchedulerManager(null);
        }
        return new SchedulerManager(scheduler.get());
    }

}
