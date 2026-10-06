package com.basicframework.module.system.controller.admin.logger.vo.operatelog;

import static cn.hutool.core.date.DatePattern.NORM_DATETIME_PATTERN;

import java.time.LocalDateTime;

import org.springframework.format.annotation.DateTimeFormat;

import com.basicframework.framework.common.pojo.PageParam;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * OperateLogPageReqVO 请求对象，承载接口输入参数。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/logger/vo/operatelog/OperateLogPageReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 3 行，上游代码 2 行在本地被移除或改写，例如 @EqualsAndHashCode(callSuper = false)；@Schema(description = "用户编号", example = "1")；本地补充注释 18 行。
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
     * 操作模块，模拟匹配。
     */
    @Schema(description = "操作模块，模拟匹配", example = "订单")
    private String type;

    /**
     * 操作名，模拟匹配。
     */
    @Schema(description = "操作名，模拟匹配", example = "创建订单")
    private String subType;

    /**
     * 操作明细，模拟匹配。
     */
    @Schema(description = "操作明细，模拟匹配", example = "修改编号为 1 的用户信息")
    private String action;

    /**
     * 开始时间。
     */
    @Schema(description = "开始时间", example = "[2022-07-01 00:00:00,2022-07-01 23:59:59]")
    @DateTimeFormat(pattern = NORM_DATETIME_PATTERN)
    private LocalDateTime[] createTime;

}
