/** 跨模块暴露对象存储容量和日志统计契约。 */
package com.basicframework.module.infra.api.monitor;

import com.basicframework.module.infra.api.monitor.dto.InfraLogStatisticsDTO;
import com.basicframework.module.infra.api.monitor.dto.InfraStorageStatisticsDTO;

import java.time.LocalDateTime;

/**
 * 基础设施监控统计 API。
 *
 * <p>面向业务模块提供文件和日志的只读统计，避免业务模块越过 API 边界直接访问基础设施数据表。</p>
 *
 * @author 李杰
 */
public interface InfraMonitorStatisticsApi {

    /**
     * 读取当前桶对象容量快照，覆盖直接上传、复制和文件登记链路。
     *
     * @return 分类统计与采集完整性；已完成快照缓存 60 秒，并发采集时立即返回明确标记的旧结果或 unavailable；部分或失败数据不能作为当前桶总量
     */
    InfraStorageStatisticsDTO getStorageStatistics();

    /**
     * 统计指定时间之后的 API 异常和定时任务日志。
     *
     * @param since 统计开始时间
     * @return 日志分类统计
     */
    InfraLogStatisticsDTO getLogStatistics(LocalDateTime since);
}
