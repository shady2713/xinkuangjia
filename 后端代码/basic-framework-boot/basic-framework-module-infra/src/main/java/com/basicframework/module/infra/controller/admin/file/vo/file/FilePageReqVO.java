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
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-infra/src/main/java/cn/iocoder/yudao/module/infra/controller/admin/file/vo/file/FilePageReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 3 行，上游代码 2 行在本地被移除或改写，例如 @EqualsAndHashCode(callSuper = false)；@Schema(description = "文件路径，模糊匹配", example = "/profile/avatar.png")；本地补充注释 9 行。
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
