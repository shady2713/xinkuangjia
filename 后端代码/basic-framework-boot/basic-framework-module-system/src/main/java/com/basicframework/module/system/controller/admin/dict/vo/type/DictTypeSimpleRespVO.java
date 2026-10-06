package com.basicframework.module.system.controller.admin.dict.vo.type;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * DictTypeSimpleRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
 * 上游文件续：system/controller/admin/dict/vo/type/DictTypeSimpleRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 2 行，移除或改写上游 2 行；补充注释 14 行。
 * 来源验收：尚未验收
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
