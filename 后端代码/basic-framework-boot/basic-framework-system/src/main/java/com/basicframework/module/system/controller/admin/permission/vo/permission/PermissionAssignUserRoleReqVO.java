package com.basicframework.module.system.controller.admin.permission.vo.permission;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.Collections;
import java.util.Set;

/**
 * PermissionAssignUserRoleReqVO 请求对象，承载接口输入参数。
 *
 * @author shady
 */
@Schema(description = "管理后台 - 赋予用户角色 Request VO")
@Data
public class PermissionAssignUserRoleReqVO {

    /**
     * 用户编号。
     */
    @Schema(description = "用户编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @NotNull(message = "用户编号不能为空")
    private Long userId;

    /**
     * 角色编号列表。
     */
    @Schema(description = "角色编号列表", example = "1,3,5")
    @Size(max = 100, message = "角色数量不能超过 100 个")
    private Set<@NotNull(message = "角色编号不能为空") Long> roleIds = Collections.emptySet(); // 兜底

}
