package com.basicframework.module.infra.controller.admin.job.vo.job;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Data;

/**
 * 管理后台定时任务创建和修改请求。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 定时任务创建/修改 Request VO")
@Data
public class JobSaveReqVO {

    /**
     * 任务编号。
     */
    @Schema(description = "任务编号", example = "1024")
    private Long id;

    /**
     * 任务名称。
     */
    @Schema(description = "任务名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "测试任务")
    @NotEmpty(message = "任务名称不能为空")
    private String name;

    /**
     * 处理器的名字。
     */
    @Schema(description = "处理器的名字", requiredMode = Schema.RequiredMode.REQUIRED, example = "sysUserSessionTimeoutJob")
    @NotEmpty(message = "处理器的名字不能为空")
    private String handlerName;

    /**
     * 处理器的参数。
     */
    @Schema(description = "处理器的参数", example = "userId=1")
    private String handlerParam;

    /**
     * CRON 表达式。
     */
    @Schema(description = "CRON 表达式", requiredMode = Schema.RequiredMode.REQUIRED, example = "0/10 * * * * ? *")
    @NotEmpty(message = "CRON 表达式不能为空")
    private String cronExpression;

    /**
     * 重试次数。
     */
    @Schema(description = "重试次数", requiredMode = Schema.RequiredMode.REQUIRED, example = "3")
    @NotNull(message = "重试次数不能为空")
    @PositiveOrZero(message = "重试次数不能小于 0")
    private Integer retryCount;

    /**
     * 重试间隔。
     */
    @Schema(description = "重试间隔", requiredMode = Schema.RequiredMode.REQUIRED, example = "1000")
    @NotNull(message = "重试间隔不能为空")
    @PositiveOrZero(message = "重试间隔不能小于 0")
    private Integer retryInterval;

    /**
     * 监控超时时间。
     */
    @Schema(description = "监控超时时间", example = "1000")
    @PositiveOrZero(message = "监控超时时间不能小于 0")
    private Integer monitorTimeout;

}
