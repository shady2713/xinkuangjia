/** 适配对象容量统计服务及日志查询。 */
package com.basicframework.module.infra.api.monitor;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.basicframework.module.infra.api.monitor.dto.InfraLogStatisticsDTO;
import com.basicframework.module.infra.api.monitor.dto.InfraStorageStatisticsDTO;
import com.basicframework.module.infra.dal.dataobject.job.JobLogDO;
import com.basicframework.module.infra.dal.dataobject.logger.ApiErrorLogDO;
import com.basicframework.module.infra.dal.mysql.job.JobLogMapper;
import com.basicframework.module.infra.dal.mysql.logger.ApiErrorLogMapper;
import com.basicframework.module.infra.service.monitor.InfraStorageStatisticsService;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

/**
 * 基础设施监控统计 API 实现。
 *
 * <p>文件容量委托存储统计服务扫描当前桶；日志仍按类型化 Mapper 读取。</p>
 *
 * @author 李杰
 */
@Service
public class InfraMonitorStatisticsApiImpl implements InfraMonitorStatisticsApi {

    /** 定时任务执行失败状态。 */
    private static final int JOB_LOG_STATUS_FAILURE = 2;

    @Resource
    private InfraStorageStatisticsService storageStatisticsService;

    @Resource
    private ApiErrorLogMapper apiErrorLogMapper;

    @Resource
    private JobLogMapper jobLogMapper;

    /**
     * 委托存储统计服务获取当前桶容量和采集完整性。
     *
     * @return 文件分类统计
     */
    @Override
    public InfraStorageStatisticsDTO getStorageStatistics() {
        return storageStatisticsService.getStorageStatistics();
    }

    /**
     * 使用类型安全条件统计指定时间范围内的异常和任务日志。
     *
     * @param since 统计开始时间
     * @return 日志分类统计
     */
    @Override
    public InfraLogStatisticsDTO getLogStatistics(LocalDateTime since) {
        InfraLogStatisticsDTO statistics = new InfraLogStatisticsDTO();
        statistics.setApiErrorLogs(apiErrorLogMapper.selectCount(new LambdaQueryWrapper<ApiErrorLogDO>()
                .ge(ApiErrorLogDO::getExceptionTime, since)));
        statistics.setFailedJobLogs(jobLogMapper.selectCount(new LambdaQueryWrapper<JobLogDO>()
                .eq(JobLogDO::getStatus, JOB_LOG_STATUS_FAILURE)
                .ge(JobLogDO::getCreateTime, since)));
        statistics.setRetryJobLogs(jobLogMapper.selectCount(new LambdaQueryWrapper<JobLogDO>()
                .gt(JobLogDO::getExecuteIndex, 1)
                .ge(JobLogDO::getCreateTime, since)));
        return statistics;
    }

}
