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
 * @author 李杰
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
