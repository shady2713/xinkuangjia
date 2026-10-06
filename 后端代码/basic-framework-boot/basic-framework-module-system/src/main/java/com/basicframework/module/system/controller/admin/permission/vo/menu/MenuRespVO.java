package com.basicframework.module.system.controller.admin.permission.vo.menu;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDateTime;

/**
 * MenuRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
 * 上游文件续：system/controller/admin/permission/vo/menu/MenuRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 3 行，移除或改写上游 1 行；import 新增 3 行、移除 6 行；补充注释 53 行。
 */
@Schema(description = "管理后台 - 菜单信息 Response VO")
@Data
public class MenuRespVO {

    /**
     * 菜单编号。
     */
    @Schema(description = "菜单编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    private Long id;

    /**
     * 菜单名称。
     */
    @Schema(description = "菜单名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "系统管理")
    @NotBlank(message = "菜单名称不能为空")
    @Size(max = 50, message = "菜单名称长度不能超过50个字符")
    private String name;

    /**
     * 权限标识,仅菜单类型为按钮时，才需要传递。
     */
    @Schema(description = "权限标识,仅菜单类型为按钮时，才需要传递", example = "sys:menu:add")
    @Size(max = 100)
    private String permission;

    /**
     * 所属后台类型。
     */
    @Schema(description = "所属后台类型", requiredMode = Schema.RequiredMode.REQUIRED, example = "business_admin")
    private String menuType;

    /**
     * 类型，参见 MenuTypeEnum 枚举类。
     */
    @Schema(description = "类型，参见 MenuTypeEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @NotNull(message = "菜单类型不能为空")
    private Integer type;

    /**
     * 显示顺序。
     */
    @Schema(description = "显示顺序", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @NotNull(message = "显示顺序不能为空")
    private Integer sort;

    /**
     * 父菜单 ID。
     */
    @Schema(description = "父菜单 ID", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @NotNull(message = "父菜单 ID 不能为空")
    private Long parentId;

    /**
     * 路由地址,仅菜单类型为菜单或者目录时，才需要传。
     */
    @Schema(description = "路由地址,仅菜单类型为菜单或者目录时，才需要传", example = "post")
    @Size(max = 200, message = "路由地址不能超过200个字符")
    private String path;

    /**
     * 菜单图标,仅菜单类型为菜单或者目录时，才需要传。
     */
    @Schema(description = "菜单图标,仅菜单类型为菜单或者目录时，才需要传", example = "/menu/list")
    private String icon;

    /**
     * 组件路径,仅菜单类型为菜单时，才需要传。
     */
    @Schema(description = "组件路径,仅菜单类型为菜单时，才需要传", example = "system/post/index")
    @Size(max = 200, message = "组件路径不能超过255个字符")
    private String component;

    /**
     * 组件名。
     */
    @Schema(description = "组件名", example = "SystemUser")
    private String componentName;

    /**
     * 状态,见 CommonStatusEnum 枚举。
     */
    @Schema(description = "状态,见 CommonStatusEnum 枚举", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @NotNull(message = "状态不能为空")
    private Integer status;

    /**
     * 是否可见。
     */
    @Schema(description = "是否可见", example = "false")
    private Boolean visible;

    /**
     * 是否缓存。
     */
    @Schema(description = "是否缓存", example = "false")
    private Boolean keepAlive;

    /**
     * 是否总是显示。
     */
    @Schema(description = "是否总是显示", example = "false")
    private Boolean alwaysShow;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", requiredMode = Schema.RequiredMode.REQUIRED, example = "时间戳格式")
    private LocalDateTime createTime;

}
