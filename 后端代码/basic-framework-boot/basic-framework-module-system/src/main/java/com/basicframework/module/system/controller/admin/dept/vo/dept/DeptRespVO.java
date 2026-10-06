package com.basicframework.module.system.controller.admin.dept.vo.dept;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * DeptRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/dept/vo/dept/DeptRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 3 行，移除或改写上游 3 行；补充注释 32 行。
 * 来源验收：尚未验收
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
