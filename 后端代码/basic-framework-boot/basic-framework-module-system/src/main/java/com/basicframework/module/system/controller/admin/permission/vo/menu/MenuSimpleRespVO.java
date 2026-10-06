package com.basicframework.module.system.controller.admin.permission.vo.menu;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * MenuSimpleRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
 * 上游文件续：system/controller/admin/permission/vo/menu/MenuSimpleRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 3 行，移除或改写上游 1 行；import 新增 0 行、移除 3 行；补充注释 20 行。
 */
@Schema(description = "管理后台 - 菜单精简信息 Response VO")
@Data
public class MenuSimpleRespVO {

    /**
     * 菜单编号。
     */
    @Schema(description = "菜单编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    private Long id;

    /**
     * 菜单名称。
     */
    @Schema(description = "菜单名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "系统管理")
    private String name;

    /**
     * 所属后台类型。
     */
    @Schema(description = "所属后台类型", requiredMode = Schema.RequiredMode.REQUIRED, example = "business_admin")
    private String menuType;

    /**
     * 父菜单 ID。
     */
    @Schema(description = "父菜单 ID", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    private Long parentId;

    /**
     * 类型，参见 MenuTypeEnum 枚举类。
     */
    @Schema(description = "类型，参见 MenuTypeEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    private Integer type;

}
