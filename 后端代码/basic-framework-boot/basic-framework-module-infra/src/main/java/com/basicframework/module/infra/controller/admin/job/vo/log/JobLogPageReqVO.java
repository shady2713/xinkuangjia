package com.basicframework.module.infra.controller.admin.job.vo.log;

import static cn.hutool.core.date.DatePattern.NORM_DATETIME_PATTERN;

import java.time.LocalDateTime;

import org.springframework.format.annotation.DateTimeFormat;

import com.basicframework.framework.common.pojo.PageParam;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 管理后台定时任务日志分页查询请求。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 定时任务日志分页 Request VO")
@Data
@EqualsAndHashCode(callSuper = false)
public class JobLogPageReqVO extends PageParam {

    /**
     * 任务编号。
     */
    @Schema(description = "任务编号", example = "10")
    private Long jobId;

    /**
     * 处理器的名字，模糊匹配。
     */
    @Schema(description = "处理器的名字，模糊匹配")
    private String handlerName;

    /**
     * 开始执行时间。
     */
    @DateTimeFormat(pattern = NORM_DATETIME_PATTERN)
    @Schema(description = "开始执行时间")
    private LocalDateTime beginTime;

    /**
     * 结束执行时间。
     */
    @DateTimeFormat(pattern = NORM_DATETIME_PATTERN)
    @Schema(description = "结束执行时间")
    private LocalDateTime endTime;

    /**
     * 任务状态，参见 JobLogStatusEnum 枚举。
     */
    @Schema(description = "任务状态，参见 JobLogStatusEnum 枚举")
    private Integer status;

}
