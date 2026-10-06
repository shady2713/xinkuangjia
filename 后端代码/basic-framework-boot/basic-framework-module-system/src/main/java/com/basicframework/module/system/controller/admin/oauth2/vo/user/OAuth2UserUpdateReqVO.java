package com.basicframework.module.system.controller.admin.oauth2.vo.user;

import com.basicframework.framework.common.validation.EmailEx;
import com.basicframework.framework.common.validation.Mobile;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * OAuth2UserUpdateReqVO 请求对象，承载接口输入参数。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
 * 上游文件续：system/controller/admin/oauth2/vo/user/OAuth2UserUpdateReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 5 行，移除或改写上游 5 行；import 新增 3 行、移除 3 行；补充注释 17 行。
 */
@Schema(description = "管理后台 - OAuth2 更新用户基本信息 Request VO")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class OAuth2UserUpdateReqVO {

    /**
     * 用户昵称。
     */
    @Schema(description = "用户昵称", requiredMode = Schema.RequiredMode.REQUIRED, example = "basicframework")
    @Size(max = 30, message = "用户昵称长度不能超过 30 个字符")
    private String nickname;

    /**
     * 用户邮箱。
     */
    @Schema(description = "用户邮箱", example = "basicframework@example.com")
    @EmailEx
    @Size(max = 50, message = "邮箱长度不能超过 50 个字符")
    private String email;

    /**
     * 手机号。
     */
    @Schema(description = "手机号", example = "")
    @Mobile
    private String mobile;

    /**
     * 用户性别，参见 SexEnum 枚举类。
     */
    @Schema(description = "用户性别，参见 SexEnum 枚举类", example = "1")
    private Integer sex;

}