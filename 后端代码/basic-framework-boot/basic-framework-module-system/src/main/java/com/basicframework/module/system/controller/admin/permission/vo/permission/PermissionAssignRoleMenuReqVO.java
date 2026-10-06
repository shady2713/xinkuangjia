package com.basicframework.module.system.controller.admin.permission.vo.permission;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import jakarta.validation.constraints.NotNull;
import java.util.Collections;
import java.util.Set;

/**
 * PermissionAssignRoleMenuReqVO 请求对象，承载接口输入参数。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/
 * 上游文件续：controller/admin/permission/vo/permission/PermissionAssignRoleMenuReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地补充注释 6 行。
 */
@Schema(description = "管理后台 - 赋予角色菜单 Request VO")
@Data
public class PermissionAssignRoleMenuReqVO {

    /**
     * 角色编号。
     */
    @Schema(description = "角色编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @NotNull(message = "角色编号不能为空")
    private Long roleId;

    /**
     * 菜单编号列表。
     */
    @Schema(description = "菜单编号列表", example = "1,3,5")
    private Set<Long> menuIds = Collections.emptySet(); // 兜底

}
