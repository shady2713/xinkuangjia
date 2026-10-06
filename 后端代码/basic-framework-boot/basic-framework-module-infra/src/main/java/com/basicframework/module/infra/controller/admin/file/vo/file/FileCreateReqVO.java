package com.basicframework.module.infra.controller.admin.file.vo.file;

import com.basicframework.module.infra.framework.file.core.utils.FilePathUtils;
import com.fasterxml.jackson.annotation.JsonIgnore;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 预签名上传完成后的文件登记请求。
 *
 * <p>请求中的 URL 只保留兼容性，服务端会根据对象路径重新生成受控公开地址。</p>
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-infra/src/main/java/cn/iocoder/yudao/module/infra/controller/admin/file/vo/file/FileCreateReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：命名空间/模块名/类名前缀适配、配置前缀 yudao.*→basic-framework.*；改写/新增 17 行，移除或改写上游 9 行；import 新增 7 行、移除 1 行；补充注释 27 行。
 */
@Schema(description = "管理后台 - 文件创建 Request VO")
@Data
public class FileCreateReqVO {

    /**
     * 文件路径。
     */
    @NotBlank(message = "文件路径不能为空")
    @Size(max = FilePathUtils.MAX_OBJECT_PATH_LENGTH, message = "文件路径长度不能超过 {max} 个字符")
    @Schema(description = "文件路径", requiredMode = Schema.RequiredMode.REQUIRED, example = "basic-framework.jpg")
    private String path;

    /**
     * 原文件名。
     */
    @NotBlank(message = "原文件名不能为空")
    @Size(max = FilePathUtils.MAX_FILE_NAME_LENGTH, message = "原文件名长度不能超过 {max} 个字符")
    @Schema(description = "原文件名", requiredMode = Schema.RequiredMode.REQUIRED, example = "basic-framework.jpg")
    private String name;

    /**
     * 文件 URL（兼容字段，服务端按 path 重新生成）。
     */
    @NotBlank(message = "文件 URL 不能为空")
    @Size(max = FilePathUtils.MAX_FILE_URL_LENGTH, message = "文件 URL 长度不能超过 {max} 个字符")
    @Schema(description = "文件 URL（兼容字段，服务端按 path 重新生成）", requiredMode = Schema.RequiredMode.REQUIRED,
            example = "https://www.example.com/basic-framework.jpg")
    private String url;

    /**
     * 文件 MIME 类型。
     */
    @Size(max = FilePathUtils.MAX_MIME_TYPE_LENGTH, message = "文件 MIME 类型长度不能超过 {max} 个字符")
    @Schema(description = "文件 MIME 类型", example = "application/octet-stream")
    private String type;

    /**
     * 文件大小。
     */
    @NotNull(message = "文件大小不能为空")
    @Positive(message = "文件大小必须大于 0")
    @Schema(description = "文件大小", example = "2048", requiredMode = Schema.RequiredMode.REQUIRED)
    private Long size;

    /**
     * 校验登记路径必须是受限的对象相对路径。
     *
     * @return 路径格式安全时返回 true
     */
    @AssertTrue(message = "文件路径不正确")
    @JsonIgnore
    public boolean isPathValid() {
        return FilePathUtils.isObjectPathValid(path);
    }

}
