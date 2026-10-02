package com.basicframework.module.infra.api.monitor.dto;

import lombok.Data;

/**
 * 基础设施日志统计数据。
 *
 * @author 李杰
 */
@Data
public class InfraLogStatisticsDTO {

    /** API 异常日志数量。 */
    private Long apiErrorLogs;

    /** 执行失败的定时任务日志数量。 */
    private Long failedJobLogs;

    /** 发生重试的定时任务日志数量。 */
    private Long retryJobLogs;
}
