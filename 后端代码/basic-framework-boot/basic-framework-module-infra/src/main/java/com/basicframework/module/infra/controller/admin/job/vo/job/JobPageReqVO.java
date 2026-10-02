package com.basicframework.module.infra.controller.admin.job.vo.job;

import com.basicframework.framework.common.pojo.PageParam;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 管理后台定时任务分页查询请求。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 定时任务分页 Request VO")
@Data
@EqualsAndHashCode(callSuper = false)
public class JobPageReqVO extends PageParam {

    /**
     * 任务名称，模糊匹配。
     */
    @Schema(description = "任务名称，模糊匹配", example = "测试任务")
    private String name;

    /**
     * 任务状态，参见 JobStatusEnum 枚举。
     */
    @Schema(description = "任务状态，参见 JobStatusEnum 枚举", example = "1")
    private Integer status;

    /**
     * 处理器的名字，模糊匹配。
     */
    @Schema(description = "处理器的名字，模糊匹配", example = "sysUserSessionTimeoutJob")
    private String handlerName;

}
