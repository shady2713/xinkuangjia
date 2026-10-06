package com.basicframework.module.infra.controller.admin.config.vo;

import static cn.hutool.core.date.DatePattern.NORM_DATETIME_PATTERN;

import java.time.LocalDateTime;

import org.springframework.format.annotation.DateTimeFormat;

import com.basicframework.framework.common.pojo.PageParam;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 管理后台参数配置分页查询请求。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-infra/src/main/java/cn/iocoder/yudao/module/infra/controller/admin/config/vo/ConfigPageReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 4 行，移除或改写上游 3 行；import 新增 2 行、移除 1 行；补充注释 17 行。
 * 来源验收：尚未验收
 */
@Schema(description = "管理后台 - 参数配置分页 Request VO")
@Data
@EqualsAndHashCode(callSuper = false)
public class ConfigPageReqVO extends PageParam {

    /**
     * 数据源名称，模糊匹配。
     */
    @Schema(description = "数据源名称，模糊匹配", example = "名称")
    private String name;

    /**
     * 参数键名，模糊匹配。
     */
    @Schema(description = "参数键名，模糊匹配", example = "")
    private String key;

    /**
     * 参数类型，参见 ConfigTypeEnum 枚举。
     */
    @Schema(description = "参数类型，参见 ConfigTypeEnum 枚举", example = "1")
    private Integer type;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", example = "[2022-07-01 00:00:00,2022-07-01 23:59:59]")
    @DateTimeFormat(pattern = NORM_DATETIME_PATTERN)
    private LocalDateTime[] createTime;

}
