/** 对象存储分类容量、采集时间和完整性模型。 */
package com.basicframework.module.infra.api.monitor.dto;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 当前对象桶的容量快照；各计数仅在 complete 时表示全量，其他状态必须结合完整性解释。
 *
 * @author 李杰
 */
@Data
public class InfraStorageStatisticsDTO {

    /** 采集状态：complete 完成、partial 部分或刷新中的旧结果、unavailable 未取得数据；结合采集时间和说明判断。 */
    private String collectionStatus;

    /** 可公开展示的采集边界或失败说明，不含地址和凭据。 */
    private String collectionMessage;

    /** 本次采集结束时间；与页面刷新时间分开表达缓存新鲜度。 */
    private LocalDateTime collectedAt;

    /** 当前桶已扫描的对象数量；仅 complete 时表示全量。 */
    private Long totalFiles;

    /** 当前桶已扫描的对象逻辑字节数；仅 complete 时表示全量。 */
    private Long totalBytes;

    /** 临时识别帧对象数量；仅 complete 时表示全量。 */
    private Long frameFiles;

    /** 临时识别帧字节数；仅 complete 时表示全量。 */
    private Long frameBytes;

    /** 业务留存图片对象数量；仅 complete 时表示全量。 */
    private Long businessImageFiles;

    /** 业务留存图片字节数；仅 complete 时表示全量。 */
    private Long businessImageBytes;

    /** 未归入图片或视频的其他对象数量；仅 complete 时表示全量。 */
    private Long otherFiles;

    /** 其他对象字节数；仅 complete 时表示全量。 */
    private Long otherBytes;

    /** 全部图片对象数量，包含临时帧、业务留存图片和其他图片。 */
    private Long imageFiles;

    /** 全部图片对象逻辑字节数，包含临时帧和业务留存子分类。 */
    private Long imageBytes;

    /** 事件视频片段数量。 */
    private Long clipFiles;

    /** 事件视频片段总字节数。 */
    private Long clipBytes;

    /** 告警视频目录之外按扩展名识别的视频对象数量。 */
    private Long uploadVideoFiles;

    /** 告警视频目录之外的视频对象逻辑字节数。 */
    private Long uploadVideoBytes;
}
