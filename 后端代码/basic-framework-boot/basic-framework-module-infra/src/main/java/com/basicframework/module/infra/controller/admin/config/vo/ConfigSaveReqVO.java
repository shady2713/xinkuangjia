package com.basicframework.module.infra.controller.admin.config.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 管理后台参数配置创建和修改请求。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-infra/src/main/java/cn/iocoder/yudao/module/infra/controller/admin/config/vo/ConfigSaveReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 3 行，上游代码 3 行在本地被移除或改写，例如 @Size(max = 50, message = "参数分类不能超过 50 个字符")；@Schema(description = "参数键名", requiredMode = Schema.RequiredMode.REQUIRED, example = "")；本地补充注释 21 行。
 */
@Schema(description = "管理后台 - 参数配置创建/修改 Request VO")
@Data
public class ConfigSaveReqVO {

    /**
     * 参数配置序号。
     */
    @Schema(description = "参数配置序号", example = "1024")
    private Long id;

    /**
     * 参数分组。
     */
    @Schema(description = "参数分组", requiredMode = Schema.RequiredMode.REQUIRED, example = "biz")
    @NotEmpty(message = "参数分组不能为空")
    @Size(max = 50, message = "参数分类不能超过 50 个字符")
    private String category;

    /**
     * 参数名称。
     */
    @Schema(description = "参数名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "数据库名")
    @NotBlank(message = "参数名称不能为空")
    @Size(max = 100, message = "参数名称不能超过 100 个字符")
    private String name;

    /**
     * 参数键名。
     */
    @Schema(description = "参数键名", requiredMode = Schema.RequiredMode.REQUIRED, example = "")
    @NotBlank(message = "参数键名长度不能为空")
    @Size(max = 100, message = "参数键名长度不能超过 100 个字符")
    private String key;

    /**
     * 参数键值。
     */
    @Schema(description = "参数键值", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @NotBlank(message = "参数键值不能为空")
    @Size(max = 500, message = "参数键值长度不能超过 500 个字符")
    private String value;

    /**
     * 是否可见。
     */
    @Schema(description = "是否可见", requiredMode = Schema.RequiredMode.REQUIRED, example = "true")
    @NotNull(message = "是否可见不能为空")
    private Boolean visible;

    /**
     * 备注。
     */
    @Schema(description = "备注", example = "")
    private String remark;

}
