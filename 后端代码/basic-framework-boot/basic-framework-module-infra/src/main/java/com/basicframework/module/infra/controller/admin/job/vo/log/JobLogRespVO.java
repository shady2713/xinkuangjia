package com.basicframework.module.infra.controller.admin.job.vo.log;

import com.basicframework.framework.excel.core.annotations.DictFormat;
import com.basicframework.framework.excel.core.convert.DictConvert;
import com.basicframework.module.infra.enums.DictTypeConstants;
import cn.idev.excel.annotation.ExcelIgnoreUnannotated;
import cn.idev.excel.annotation.ExcelProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 管理后台定时任务日志响应。
 *
 * 同时用于定时任务日志 Excel 导出。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 定时任务日志 Response VO")
@Data
@ExcelIgnoreUnannotated
public class JobLogRespVO {

    /**
     * 日志编号。
     */
    @Schema(description = "日志编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @ExcelProperty("日志编号")
    private Long id;

    /**
     * 任务编号。
     */
    @Schema(description = "任务编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @ExcelProperty("任务编号")
    private Long jobId;

    /**
     * 处理器的名字。
     */
    @Schema(description = "处理器的名字", requiredMode = Schema.RequiredMode.REQUIRED, example = "sysUserSessionTimeoutJob")
    @ExcelProperty("处理器的名字")
    private String handlerName;

    /**
     * 处理器的参数。
     */
    @Schema(description = "处理器的参数", example = "userId=1")
    @ExcelProperty("处理器的参数")
    private String handlerParam;

    /**
     * 第几次执行。
     */
    @Schema(description = "第几次执行", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @ExcelProperty("第几次执行")
    private Integer executeIndex;

    /**
     * 开始执行时间。
     */
    @Schema(description = "开始执行时间", requiredMode = Schema.RequiredMode.REQUIRED)
    @ExcelProperty("开始执行时间")
    private LocalDateTime beginTime;

    /**
     * 结束执行时间。
     */
    @Schema(description = "结束执行时间")
    @ExcelProperty("结束执行时间")
    private LocalDateTime endTime;

    /**
     * 执行时长。
     */
    @Schema(description = "执行时长", example = "123")
    @ExcelProperty("执行时长")
    private Integer duration;

    /**
     * 任务状态，参见 JobLogStatusEnum 枚举。
     */
    @Schema(description = "任务状态，参见 JobLogStatusEnum 枚举", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @ExcelProperty(value = "任务状态", converter = DictConvert.class)
    @DictFormat(DictTypeConstants.JOB_LOG_STATUS)
    private Integer status;

    /**
     * 结果数据。
     */
    @Schema(description = "结果数据", example = "执行成功")
    @ExcelProperty("结果数据")
    private String result;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", requiredMode = Schema.RequiredMode.REQUIRED)
    @ExcelProperty("创建时间")
    private LocalDateTime createTime;

}
