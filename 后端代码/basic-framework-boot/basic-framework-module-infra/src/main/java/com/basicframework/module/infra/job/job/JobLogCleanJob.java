package com.basicframework.module.infra.job.job;

import com.basicframework.framework.quartz.core.handler.JobHandler;

import com.basicframework.module.infra.service.job.JobLogService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import jakarta.annotation.Resource;

/**
 * 物理删除 N 天前的任务日志的 Job
 *
 * @author 李杰
 */
@Slf4j
@Component
public class JobLogCleanJob implements JobHandler {

    @Resource
    private JobLogService jobLogService;

    /**
     * 清理超过（14）天的日志
     */
    private static final Integer JOB_CLEAN_RETAIN_DAY = 14;

    /**
     * 每次删除间隔的条数，如果值太高可能会造成数据库的压力过大
     */
    private static final Integer DELETE_LIMIT = 100;

    /**
     * 执行任务日志清理任务。
     *
     * @param param 调度参数，当前未使用
     * @return 清理结果描述
     */
    @Override
    public String execute(String param) {
        Integer count = jobLogService.cleanJobLog(JOB_CLEAN_RETAIN_DAY, DELETE_LIMIT);
        log.info("[execute][定时执行清理定时任务日志数量 ({}) 个]", count);
        return String.format("定时执行清理定时任务日志数量 %s 个", count);
    }

}
