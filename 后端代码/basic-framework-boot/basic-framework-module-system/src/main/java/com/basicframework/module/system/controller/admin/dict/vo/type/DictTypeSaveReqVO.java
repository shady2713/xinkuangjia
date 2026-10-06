package com.basicframework.module.system.controller.admin.dict.vo.type;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 管理后台字典类型创建或修改请求。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/dict/vo/type/DictTypeSaveReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 1 行，例如 @Size(max = 500, message = "备注长度不能超过 500 个字符")；本地补充注释 15 行。
 */
@Schema(description = "管理后台 - 字典类型创建/修改 Request VO")
@Data
public class DictTypeSaveReqVO {

    /**
     * 字典类型编号。
     */
    @Schema(description = "字典类型编号", example = "1024")
    private Long id;

    /**
     * 字典名称。
     */
    @Schema(description = "字典名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "性别")
    @NotBlank(message = "字典名称不能为空")
    @Size(max = 100, message = "字典类型名称长度不能超过100个字符")
    private String name;

    /**
     * 字典类型。
     */
    @Schema(description = "字典类型", requiredMode = Schema.RequiredMode.REQUIRED, example = "sys_common_sex")
    @NotNull(message = "字典类型不能为空")
    @Size(max = 100, message = "字典类型类型长度不能超过 100 个字符")
    private String type;

    /**
     * 状态，参见 CommonStatusEnum 枚举类。
     */
    @Schema(description = "状态，参见 CommonStatusEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @NotNull(message = "状态不能为空")
    private Integer status;

    /**
     * 备注。
     */
    @Schema(description = "备注", example = "快乐的备注")
    @Size(max = 500, message = "备注长度不能超过 500 个字符")
    private String remark;

}
