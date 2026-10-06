package com.basicframework.module.system.controller.admin.permission.vo.role;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * RoleSimpleRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/permission/vo/role/RoleSimpleRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 1 行，上游代码 1 行在本地被移除或改写，例如 @Schema(description = "角色名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "管理员")；本地补充注释 6 行。
 */
@Schema(description = "管理后台 - 角色精简信息 Response VO")
@Data
public class RoleSimpleRespVO {

    /**
     * 角色编号。
     */
    @Schema(description = "角色编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    private Long id;

    /**
     * 角色名称。
     */
    @Schema(description = "角色名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "管理员")
    private String name;

}
