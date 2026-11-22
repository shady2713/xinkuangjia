package com.basicframework.module.system.controller.admin.dept.vo.dept;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * DeptSimpleRespVO 响应对象，承载接口输出数据。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 部门精简信息 Response VO")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class DeptSimpleRespVO {

    /**
     * 部门编号。
     */
    @Schema(description = "部门编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    private Long id;

    /**
     * 部门名称。
     */
    @Schema(description = "部门名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "总公司")
    private String name;

    /**
     * 父部门 ID。
     */
    @Schema(description = "父部门 ID", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    private Long parentId;

}
