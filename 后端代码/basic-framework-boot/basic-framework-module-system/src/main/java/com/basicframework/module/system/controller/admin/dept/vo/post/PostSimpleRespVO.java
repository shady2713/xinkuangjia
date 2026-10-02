package com.basicframework.module.system.controller.admin.dept.vo.post;

import cn.idev.excel.annotation.ExcelProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * PostSimpleRespVO 响应对象，承载接口输出数据。
 *
 * @author 李杰
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
