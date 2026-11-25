package com.basicframework.module.infra.controller.admin.file.vo.file;

import static cn.hutool.core.date.DatePattern.NORM_DATETIME_PATTERN;

import java.time.LocalDateTime;

import org.springframework.format.annotation.DateTimeFormat;

import com.basicframework.framework.common.pojo.PageParam;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 管理后台文件分页查询条件。
 *
 * @author shady
 */
@Schema(description = "管理后台 - 文件分页 Request VO")
@Data
@EqualsAndHashCode(callSuper = false)
public class FilePageReqVO extends PageParam {

    /**
     * 文件路径，模糊匹配。
     */
    @Schema(description = "文件路径，模糊匹配", example = "/profile/avatar.png")
    @Size(max = 512, message = "文件路径长度不能超过 512 个字符")
    private String path;

    /**
     * 文件类型，模糊匹配。
     */
    @Schema(description = "文件类型，模糊匹配", example = "jpg")
    @Size(max = 128, message = "文件类型长度不能超过 128 个字符")
    private String type;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", example = "[2022-07-01 00:00:00, 2022-07-01 23:59:59]")
    @DateTimeFormat(pattern = NORM_DATETIME_PATTERN)
    @Size(max = 2, message = "创建时间范围最多包含 2 个时间点")
    private LocalDateTime[] createTime;

}
