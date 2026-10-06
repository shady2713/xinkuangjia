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
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-infra/src/main/java/cn/iocoder/yudao/module/infra/controller/admin/job/vo/log/JobLogPageReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 3 行，上游代码 2 行在本地被移除或改写，例如 @EqualsAndHashCode(callSuper = false)；@DateTimeFormat(pattern = NORM_DATETIME_PATTERN)；本地补充注释 15 行。
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
