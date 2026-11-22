package com.basicframework.module.system.controller.admin.permission.vo.menu;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * MenuSimpleRespVO 响应对象，承载接口输出数据。
 *
 * @author 李杰
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
