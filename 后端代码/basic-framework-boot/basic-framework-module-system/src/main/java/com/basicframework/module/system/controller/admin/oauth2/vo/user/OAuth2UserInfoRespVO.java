package com.basicframework.module.system.controller.admin.oauth2.vo.user;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * OAuth2UserInfoRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/oauth2/vo/user/OAuth2UserInfoRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 5 行，上游代码 5 行在本地被移除或改写，例如 @Schema(description = "用户账号", requiredMode = Schema.RequiredMode.REQUIRED, example = "管理员")；@Schema(description = "用户昵称", requiredMode = Schema.RequiredMode.REQUIRED, example = "管理员")；本地补充注释 19 行，上游注释 2 行未保留。
 */
@Schema(description = "管理后台 - OAuth2 获得用户基本信息 Response VO")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class OAuth2UserInfoRespVO {

    /**
     * 用户编号。
     */
    @Schema(description = "用户编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    private Long id;

    /**
     * 用户账号。
     */
    @Schema(description = "用户账号", requiredMode = Schema.RequiredMode.REQUIRED, example = "管理员")
    private String username;

    /**
     * 用户昵称。
     */
    @Schema(description = "用户昵称", requiredMode = Schema.RequiredMode.REQUIRED, example = "管理员")
    private String nickname;

    /**
     * 用户邮箱。
     */
    @Schema(description = "用户邮箱", example = "admin@example.com")
    private String email;
    /**
     * 手机号码。
     */
    @Schema(description = "手机号码", example = "")
    private String mobile;

    /**
     * 用户性别，参见 SexEnum 枚举类。
     */
    @Schema(description = "用户性别，参见 SexEnum 枚举类", example = "1")
    private Integer sex;

    /**
     * 用户头像。
     */
    @Schema(description = "用户头像", example = "https://www.example.com/xxx.png")
    private String avatar;

    /**
     * 所在部门。
     */
    private Dept dept;

    /**
     * 所属岗位数组。
     */
    private List<Post> posts;

    /**
     * Dept 内部数据模型，用于封装 OAuth2UserInfoRespVO 的组成信息。
     *
     * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
     * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/oauth2/vo/user/OAuth2UserInfoRespVO.java
     * 来源依据：固定见证版本；历史引入版本未核实。
     * 本地修改：本地补充注释 6 行。
     */
    @Schema(description = "部门")
    @Data
    public static class Dept {

        /**
         * 部门编号。
         */
        @Schema(description = "部门编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
        private Long id;

        /**
         * 部门名称。
         */
        @Schema(description = "部门名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "研发部")
        private String name;

    }

    /**
     * Post 内部数据模型，用于封装 OAuth2UserInfoRespVO 的组成信息。
     *
     * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
     * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/oauth2/vo/user/OAuth2UserInfoRespVO.java
     * 来源依据：固定见证版本；历史引入版本未核实。
     * 本地修改：本地补充注释 6 行。
     */
    @Schema(description = "岗位")
    @Data
    public static class Post {

        /**
         * 岗位编号。
         */
        @Schema(description = "岗位编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
        private Long id;

        /**
         * 岗位名称。
         */
        @Schema(description = "岗位名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "开发")
        private String name;

    }

}
