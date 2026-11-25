package com.basicframework.module.system.controller.admin.logger.vo.operatelog;

import static cn.hutool.core.date.DatePattern.NORM_DATETIME_PATTERN;

import java.time.LocalDateTime;

import org.springframework.format.annotation.DateTimeFormat;

import com.basicframework.framework.common.pojo.PageParam;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * OperateLogPageReqVO 请求对象，承载接口输入参数。
 *
 * @author shady
 */
@Schema(description = "管理后台 - 操作日志分页列表 Request VO")
@Data
@EqualsAndHashCode(callSuper = false)
public class OperateLogPageReqVO extends PageParam {

    /**
     * 用户编号。
     */
    @Schema(description = "用户编号", example = "1")
    private Long userId;

    /**
     * 操作模块业务编号。
     */
    @Schema(description = "操作模块业务编号", example = "1")
    private Long bizId;

    /**
     * 操作模块，模糊匹配。
     */
    @Schema(description = "操作模块，模糊匹配", example = "订单")
    @Size(max = 50, message = "操作模块长度不能超过 50 个字符")
    private String type;

    /**
     * 操作名，模糊匹配。
     */
    @Schema(description = "操作名，模糊匹配", example = "创建订单")
    @Size(max = 50, message = "操作名长度不能超过 50 个字符")
    private String subType;

    /**
     * 操作明细，模糊匹配。
     */
    @Schema(description = "操作明细，模糊匹配", example = "修改编号为 1 的用户信息")
    @Size(max = 100, message = "操作明细关键字长度不能超过 100 个字符")
    private String action;

    /**
     * 开始时间。
     */
    @Schema(description = "开始时间", example = "[2022-07-01 00:00:00,2022-07-01 23:59:59]")
    @DateTimeFormat(pattern = NORM_DATETIME_PATTERN)
    @Size(max = 2, message = "时间范围最多包含 2 个时间点")
    private LocalDateTime[] createTime;

}
