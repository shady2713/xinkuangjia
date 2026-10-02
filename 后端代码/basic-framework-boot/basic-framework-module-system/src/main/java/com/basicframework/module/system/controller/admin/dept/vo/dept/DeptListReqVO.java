package com.basicframework.module.system.controller.admin.dept.vo.dept;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * DeptListReqVO 请求对象，承载接口输入参数。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 部门列表 Request VO")
@Data
public class DeptListReqVO {

    /**
     * 部门名称，模糊匹配。
     */
    @Schema(description = "部门名称，模糊匹配", example = "总公司")
    private String name;

    /**
     * 展示状态，参见 CommonStatusEnum 枚举类。
     */
    @Schema(description = "展示状态，参见 CommonStatusEnum 枚举类", example = "1")
    private Integer status;

}
