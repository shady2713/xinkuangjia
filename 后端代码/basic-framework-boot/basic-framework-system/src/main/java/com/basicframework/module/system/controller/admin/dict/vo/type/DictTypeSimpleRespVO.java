package com.basicframework.module.system.controller.admin.dict.vo.type;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * DictTypeSimpleRespVO 响应对象，承载接口输出数据。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 字典类型精简信息 Response VO")
@Data
public class DictTypeSimpleRespVO {

    /**
     * 字典类型编号。
     */
    @Schema(description = "字典类型编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    private Long id;

    /**
     * 字典类型名称。
     */
    @Schema(description = "字典类型名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "common_status")
    private String name;

    /**
     * 字典类型。
     */
    @Schema(description = "字典类型", requiredMode = Schema.RequiredMode.REQUIRED, example = "sys_common_see")
    private String type;

}
