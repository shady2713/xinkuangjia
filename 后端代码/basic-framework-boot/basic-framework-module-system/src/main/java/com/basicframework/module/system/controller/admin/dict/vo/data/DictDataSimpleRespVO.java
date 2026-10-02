package com.basicframework.module.system.controller.admin.dict.vo.data;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * DictDataSimpleRespVO 响应对象，承载接口输出数据。
 *
 * @author 李杰
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
