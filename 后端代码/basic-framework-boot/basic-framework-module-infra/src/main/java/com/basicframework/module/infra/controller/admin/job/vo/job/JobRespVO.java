package com.basicframework.module.infra.controller.admin.job.vo.job;

import com.basicframework.framework.excel.core.annotations.DictFormat;
import com.basicframework.framework.excel.core.convert.DictConvert;
import com.basicframework.module.infra.enums.DictTypeConstants;
import cn.idev.excel.annotation.ExcelIgnoreUnannotated;
import cn.idev.excel.annotation.ExcelProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 管理后台定时任务响应。
 *
 * 同时用于定时任务 Excel 导出。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-infra/src/main/java/cn/iocoder/yudao/module/infra/controller/admin/job/vo/job/JobRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 1 行，上游代码 1 行在本地被移除或改写，例如 @Schema(description = "处理器的参数", example = "userId=1")；本地补充注释 30 行。
 */
@Schema(description = "管理后台 - 定时任务 Response VO")
@Data
@ExcelIgnoreUnannotated
public class JobRespVO {

    /**
     * 任务编号。
     */
    @Schema(description = "任务编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @ExcelProperty("任务编号")
    private Long id;

    /**
     * 任务名称。
     */
    @Schema(description = "任务名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "测试任务")
    @ExcelProperty("任务名称")
    private String name;

    /**
     * 任务状态。
     */
    @Schema(description = "任务状态", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @ExcelProperty(value = "任务状态", converter = DictConvert.class)
    @DictFormat(DictTypeConstants.JOB_STATUS)
    private Integer status;

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
     * CRON 表达式。
     */
    @Schema(description = "CRON 表达式", requiredMode = Schema.RequiredMode.REQUIRED, example = "0/10 * * * * ? *")
    @ExcelProperty("CRON 表达式")
    private String cronExpression;

    /**
     * 重试次数。
     */
    @Schema(description = "重试次数", requiredMode = Schema.RequiredMode.REQUIRED, example = "3")
    @NotNull(message = "重试次数不能为空")
    private Integer retryCount;

    /**
     * 重试间隔。
     */
    @Schema(description = "重试间隔", requiredMode = Schema.RequiredMode.REQUIRED, example = "1000")
    private Integer retryInterval;

    /**
     * 监控超时时间。
     */
    @Schema(description = "监控超时时间", example = "1000")
    @ExcelProperty("监控超时时间")
    private Integer monitorTimeout;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", requiredMode = Schema.RequiredMode.REQUIRED)
    @ExcelProperty("创建时间")
    private LocalDateTime createTime;

}
