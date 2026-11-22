package com.basicframework.module.system.controller.admin.permission.vo.role;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.validation.InEnum;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * RoleSaveReqVO 请求对象，承载接口输入参数。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 角色创建/更新 Request VO. Role type is not client-selectable: the server sets it from the authenticated operator, ignores any client value, and applies platform isolation.")
@Data
public class RoleSaveReqVO {

    @Schema(description = "角色编号", example = "1")
    private Long id;

    @Schema(description = "角色名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "管理员")
    @NotBlank(message = "角色名称不能为空")
    @Size(max = 30, message = "角色名称长度不能超过 30 个字符")
    private String name;

    @NotBlank(message = "角色标志不能为空")
    @Size(max = 100, message = "角色标志长度不能超过 100 个字符")
    @Schema(description = "角色标志", requiredMode = Schema.RequiredMode.REQUIRED, example = "ADMIN")
    private String code;

    @Schema(description = "所属后台类型，后端按当前登录用户自动填充", hidden = true)
    private String roleType;

    @Schema(description = "显示顺序", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @NotNull(message = "显示顺序不能为空")
    private Integer sort;

    @Schema(description = "状态", requiredMode = Schema.RequiredMode.REQUIRED, example = "0")
    @NotNull(message = "状态不能为空")
    @InEnum(value = CommonStatusEnum.class, message = "状态必须是 {value}")
    private Integer status;

    @Schema(description = "备注", example = "我是一个角色")
    @Size(max = 500, message = "备注长度不能超过 500 个字符")
    private String remark;

}
