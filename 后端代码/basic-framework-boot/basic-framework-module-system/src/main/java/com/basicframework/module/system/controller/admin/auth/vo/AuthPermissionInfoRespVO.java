package com.basicframework.module.system.controller.admin.auth.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Set;

/**
 * AuthPermissionInfoRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
 * 上游文件续：system/controller/admin/auth/vo/AuthPermissionInfoRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 8 行，移除或改写上游 6 行；补充注释 31 行，上游注释 1 行未保留。
 * 来源验收：尚未验收
 */
@Schema(description = "管理后台 - 登录用户的权限信息 Response VO，额外包括用户信息和角色列表")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AuthPermissionInfoRespVO {

    /**
     * 用户信息。
     */
    @Schema(description = "用户信息", requiredMode = Schema.RequiredMode.REQUIRED)
    private UserVO user;

    /**
     * 角色标识数组。
     */
    @Schema(description = "角色标识数组", requiredMode = Schema.RequiredMode.REQUIRED)
    private Set<String> roles;

    /**
     * 操作权限数组。
     */
    @Schema(description = "操作权限数组", requiredMode = Schema.RequiredMode.REQUIRED)
    private Set<String> permissions;

    /**
     * 菜单树。
     */
    @Schema(description = "菜单树", requiredMode = Schema.RequiredMode.REQUIRED)
    private List<MenuVO> menus;

    /**
     * UserVO 内部数据模型，用于封装 AuthPermissionInfoRespVO 的组成信息。
     *
     * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
     * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
     * 上游文件续：system/controller/admin/auth/vo/AuthPermissionInfoRespVO.java
     * 来源依据：固定见证版本；历史引入版本未核实。
     * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 8 行，移除或改写上游 6 行；补充注释 31 行，上游注释 1 行未保留。
     * 来源验收：尚未验收
     */
    @Schema(description = "用户信息 VO")
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class UserVO {

        /**
         * 用户编号。
         */
        @Schema(description = "用户编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
        private Long id;

        /**
         * 用户昵称。
         */
        @Schema(description = "用户昵称", requiredMode = Schema.RequiredMode.REQUIRED, example = "目录")
        private String nickname;

        /**
         * 用户头像。
         */
        @Schema(description = "用户头像", requiredMode = Schema.RequiredMode.REQUIRED, example = "https://www.example.com/xx.jpg")
        private String avatar;

        /**
         * 部门编号。
         */
        @Schema(description = "部门编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "2048")
        private Long deptId;

        /**
         * 用户账号。
         */
        @Schema(description = "用户账号", requiredMode = Schema.RequiredMode.REQUIRED, example = "目录")
        private String username;

        /**
         * 所属后台类型。
         */
        @Schema(description = "所属后台类型", requiredMode = Schema.RequiredMode.REQUIRED, example = "business_admin")
        private String userType;

        /**
         * 用户邮箱。
         */
        @Schema(description = "用户邮箱", example = "admin@example.com")
        private String email;

    }

    /**
     * MenuVO 内部数据模型，用于封装 AuthPermissionInfoRespVO 的组成信息。
     *
     * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
     * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
     * 上游文件续：system/controller/admin/auth/vo/AuthPermissionInfoRespVO.java
     * 来源依据：固定见证版本；历史引入版本未核实。
     * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 8 行，移除或改写上游 6 行；补充注释 31 行，上游注释 1 行未保留。
     * 来源验收：尚未验收
     */
    @Schema(description = "管理后台 - 登录用户的菜单信息 Response VO")
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class MenuVO {

        /**
         * 菜单名称。
         */
        @Schema(description = "菜单名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "目录")
        private Long id;

        /**
         * 父菜单 ID。
         */
        @Schema(description = "父菜单 ID", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
        private Long parentId;

        /**
         * 菜单名称。
         */
        @Schema(description = "菜单名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "目录")
        private String name;

        /**
         * 路由地址,仅菜单类型为菜单或者目录时，才需要传。
         */
        @Schema(description = "路由地址,仅菜单类型为菜单或者目录时，才需要传", example = "post")
        private String path;

        /**
         * 组件路径,仅菜单类型为菜单时，才需要传。
         */
        @Schema(description = "组件路径,仅菜单类型为菜单时，才需要传", example = "system/post/index")
        private String component;

        /**
         * 组件名。
         */
        @Schema(description = "组件名", example = "SystemUser")
        private String componentName;

        /**
         * 菜单图标,仅菜单类型为菜单或者目录时，才需要传。
         */
        @Schema(description = "菜单图标,仅菜单类型为菜单或者目录时，才需要传", example = "/menu/list")
        private String icon;

        /**
         * 是否可见。
         */
        @Schema(description = "是否可见", requiredMode = Schema.RequiredMode.REQUIRED, example = "false")
        private Boolean visible;

        /**
         * 是否缓存。
         */
        @Schema(description = "是否缓存", requiredMode = Schema.RequiredMode.REQUIRED, example = "false")
        private Boolean keepAlive;

        /**
         * 是否总是显示。
         */
        @Schema(description = "是否总是显示", example = "false")
        private Boolean alwaysShow;

        /**
         * 子路由。
         */
        private List<MenuVO> children;

    }

}
