package com.basicframework.module.system.controller.admin.dept.vo.dept;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * DeptRespVO 响应对象，承载接口输出数据。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 部门信息 Response VO")
@Data
public class DeptRespVO {

    /**
     * 部门编号。
     */
    @Schema(description = "部门编号", example = "1024")
    private Long id;

    /**
     * 部门名称。
     */
    @Schema(description = "部门名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "总公司")
    private String name;

    /**
     * 父部门 ID。
     */
    @Schema(description = "父部门 ID", example = "1024")
    private Long parentId;

    /**
     * 显示顺序。
     */
    @Schema(description = "显示顺序", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    private Integer sort;

    /**
     * 负责人的用户编号。
     */
    @Schema(description = "负责人的用户编号", example = "2048")
    private Long leaderUserId;

    /**
     * 联系电话。
     */
    @Schema(description = "联系电话", example = "")
    private String phone;

    /**
     * 邮箱。
     */
    @Schema(description = "邮箱", example = "dept@example.com")
    private String email;

    /**
     * 状态,见 CommonStatusEnum 枚举。
     */
    @Schema(description = "状态,见 CommonStatusEnum 枚举", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    private Integer status;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", requiredMode = Schema.RequiredMode.REQUIRED, example = "时间戳格式")
    private LocalDateTime createTime;

}
