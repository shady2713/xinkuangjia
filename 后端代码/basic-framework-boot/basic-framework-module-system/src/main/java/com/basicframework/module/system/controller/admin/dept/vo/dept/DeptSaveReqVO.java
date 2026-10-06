package com.basicframework.module.system.controller.admin.dept.vo.dept;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.validation.EmailEx;
import com.basicframework.framework.common.validation.InEnum;
import com.basicframework.framework.common.validation.Mobile;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * DeptSaveReqVO 请求对象，承载接口输入参数。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/dept/vo/dept/DeptSaveReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 8 行，上游代码 8 行在本地被移除或改写，例如 @Schema(description = "部门名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "研发部")；@Schema(description = "显示顺序", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")；本地补充注释 24 行。
 */
@Schema(description = "管理后台 - 部门创建/修改 Request VO")
@Data
public class DeptSaveReqVO {

    /**
     * 部门编号。
     */
    @Schema(description = "部门编号", example = "1024")
    private Long id;

    /**
     * 部门名称。
     */
    @Schema(description = "部门名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "研发部")
    @NotBlank(message = "部门名称不能为空")
    @Size(max = 30, message = "部门名称长度不能超过 30 个字符")
    private String name;

    /**
     * 父部门 ID。
     */
    @Schema(description = "父部门 ID", example = "1024")
    private Long parentId;

    /**
     * 显示顺序。
     */
    @Schema(description = "显示顺序", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @NotNull(message = "显示顺序不能为空")
    private Integer sort;

    /**
     * 负责人用户编号。
     */
    @Schema(description = "负责人用户编号", example = "2048")
    private Long leaderUserId;

    /**
     * 联系电话。
     */
    @Schema(description = "联系电话", example = "")
    @Mobile
    private String phone;

    /**
     * 邮箱。
     */
    @Schema(description = "邮箱", example = "basicframework@example.com")
    @EmailEx
    @Size(max = 50, message = "邮箱长度不能超过 50 个字符")
    private String email;

    /**
     * 状态，参见 CommonStatusEnum 枚举。
     */
    @Schema(description = "状态，参见 CommonStatusEnum 枚举", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @NotNull(message = "状态不能为空")
    @InEnum(value = CommonStatusEnum.class, message = "修改状态必须是 {value}")
    private Integer status;

}
