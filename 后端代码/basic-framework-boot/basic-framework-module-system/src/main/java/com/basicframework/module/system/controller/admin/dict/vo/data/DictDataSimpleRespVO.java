package com.basicframework.module.system.controller.admin.dict.vo.data;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * DictDataSimpleRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
 * 上游文件续：system/controller/admin/dict/vo/data/DictDataSimpleRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地补充注释 15 行。
 * 来源验收：尚未验收
 */
@Schema(description = "管理后台 - 数据字典精简 Response VO")
@Data
public class DictDataSimpleRespVO {

    /**
     * 字典类型。
     */
    @Schema(description = "字典类型", requiredMode = Schema.RequiredMode.REQUIRED, example = "gender")
    private String dictType;

    /**
     * 字典键值。
     */
    @Schema(description = "字典键值", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    private String value;

    /**
     * 字典标签。
     */
    @Schema(description = "字典标签", requiredMode = Schema.RequiredMode.REQUIRED, example = "男")
    private String label;

    /**
     * 颜色类型，default、primary、success、info、warning、danger。
     */
    @Schema(description = "颜色类型，default、primary、success、info、warning、danger", example = "default")
    private String colorType;

    /**
     * css 样式。
     */
    @Schema(description = "css 样式", example = "btn-visible")
    private String cssClass;

}
