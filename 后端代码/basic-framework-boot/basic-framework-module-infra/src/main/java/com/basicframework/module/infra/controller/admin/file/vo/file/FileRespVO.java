package com.basicframework.module.infra.controller.admin.file.vo.file;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 管理后台文件元数据响应，不返回文件二进制内容。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 文件 Response VO,不返回 content 字段，太大")
@Data
public class FileRespVO {

    /**
     * 文件编号。
     */
    @Schema(description = "文件编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    private Long id;

    /**
     * 文件路径。
     */
    @Schema(description = "文件路径", requiredMode = Schema.RequiredMode.REQUIRED, example = "basic-framework.jpg")
    private String path;

    /**
     * 原文件名。
     */
    @Schema(description = "原文件名", requiredMode = Schema.RequiredMode.REQUIRED, example = "basic-framework.jpg")
    private String name;

    /**
     * 文件 URL。
     */
    @Schema(description = "文件 URL", requiredMode = Schema.RequiredMode.REQUIRED, example = "https://www.example.com/basic-framework.jpg")
    private String url;

    /**
     * 文件 MIME 类型。
     */
    @Schema(description = "文件MIME类型", example = "application/octet-stream")
    private String type;

    /**
     * 文件大小。
     */
    @Schema(description = "文件大小", example = "2048", requiredMode = Schema.RequiredMode.REQUIRED)
    private Long size;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", requiredMode = Schema.RequiredMode.REQUIRED)
    private LocalDateTime createTime;

}
