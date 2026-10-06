package com.basicframework.module.system.controller.admin.dept.vo.post;

import cn.idev.excel.annotation.ExcelProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * PostSimpleRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
 * 上游文件续：system/controller/admin/dept/vo/post/PostSimpleRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地补充注释 6 行。
 * 来源验收：尚未验收
 */
@Schema(description = "管理后台 - 岗位信息的精简 Response VO")
@Data
public class PostSimpleRespVO {

    /**
     * 岗位序号。
     */
    @Schema(description = "岗位序号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @ExcelProperty("岗位序号")
    private Long id;

    /**
     * 岗位名称。
     */
    @Schema(description = "岗位名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "小土豆")
    @ExcelProperty("岗位名称")
    private String name;

}
