package com.basicframework.module.infra.controller.admin.job.vo.job;

import com.basicframework.framework.common.pojo.PageParam;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 管理后台定时任务分页查询请求。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-infra/src/main/java/cn/iocoder/yudao/module/infra/controller/admin/job/vo/job/JobPageReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 1 行，例如 @EqualsAndHashCode(callSuper = false)；本地补充注释 9 行。
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
