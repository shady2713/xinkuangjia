package com.basicframework.module.system.controller.admin.dict.vo.data;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.validation.InEnum;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 管理后台字典数据创建或修改请求。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
 * 上游文件续：system/controller/admin/dict/vo/data/DictDataSaveReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 6 行，移除或改写上游 3 行；import 新增 3 行、移除 3 行；补充注释 32 行。
 */
@Schema(description = "管理后台 - 字典数据创建/修改 Request VO")
@Data
public class DictDataSaveReqVO {

    /**
     * 字典数据编号。
     */
    @Schema(description = "字典数据编号", example = "1024")
    private Long id;

    /**
     * 显示顺序。
     */
    @Schema(description = "显示顺序", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @NotNull(message = "显示顺序不能为空")
    private Integer sort;

    /**
     * 字典标签。
     */
    @Schema(description = "字典标签", requiredMode = Schema.RequiredMode.REQUIRED, example = "启用")
    @NotBlank(message = "字典标签不能为空")
    @Size(max = 100, message = "字典标签长度不能超过100个字符")
    private String label;

    /**
     * 字典值。
     */
    @Schema(description = "字典值", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "字典键值不能为空")
    @Size(max = 100, message = "字典键值长度不能超过100个字符")
    private String value;

    /**
     * 字典类型。
     */
    @Schema(description = "字典类型", requiredMode = Schema.RequiredMode.REQUIRED, example = "sys_common_see")
    @NotBlank(message = "字典类型不能为空")
    @Size(max = 100, message = "字典类型长度不能超过100个字符")
    private String dictType;

    /**
     * 状态,见 CommonStatusEnum 枚举。
     */
    @Schema(description = "状态,见 CommonStatusEnum 枚举", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @NotNull(message = "状态不能为空")
    @InEnum(value = CommonStatusEnum.class, message = "修改状态必须是 {value}")
    private Integer status;

    /**
     * 颜色类型,default、primary、success、info、warning、danger。
     */
    @Schema(description = "颜色类型,default、primary、success、info、warning、danger", example = "default")
    @Size(max = 100, message = "颜色类型长度不能超过 100 个字符")
    private String colorType;

    /**
     * css 样式。
     */
    @Schema(description = "css 样式", example = "btn-visible")
    @Size(max = 100, message = "CSS 样式长度不能超过 100 个字符")
    private String cssClass;

    /**
     * 备注。
     */
    @Schema(description = "备注", example = "我是一个角色")
    @Size(max = 500, message = "备注长度不能超过 500 个字符")
    private String remark;

}
