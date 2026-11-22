package com.basicframework.module.infra.controller.admin.file.vo.file;

import static cn.hutool.core.date.DatePattern.NORM_DATETIME_PATTERN;

import java.time.LocalDateTime;

import org.springframework.format.annotation.DateTimeFormat;

import com.basicframework.framework.common.pojo.PageParam;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 管理后台文件分页查询条件。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 文件分页 Request VO")
@Data
@EqualsAndHashCode(callSuper = false)
public class FilePageReqVO extends PageParam {

    /**
     * 文件路径，模糊匹配。
     */
    @Schema(description = "文件路径，模糊匹配", example = "/profile/avatar.png")
    private String path;

    /**
     * 文件类型，模糊匹配。
     */
    @Schema(description = "文件类型，模糊匹配", example = "jpg")
    private String type;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", example = "[2022-07-01 00:00:00, 2022-07-01 23:59:59]")
    @DateTimeFormat(pattern = NORM_DATETIME_PATTERN)
    private LocalDateTime[] createTime;

}
