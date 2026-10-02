package com.basicframework.module.system.controller.admin.auth.vo;

import com.basicframework.framework.common.validation.Password;
import com.basicframework.framework.common.validation.Username;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * AuthRegisterReqVO 请求对象，承载接口输入参数。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 注册 Request VO")
@Data
@EqualsAndHashCode(callSuper = false)
public class AuthRegisterReqVO extends CaptchaVerificationReqVO {

    /**
     * 用户账号。
     */
    @Schema(description = "用户账号", requiredMode = Schema.RequiredMode.REQUIRED, example = "basicframework")
    @NotBlank(message = "用户账号不能为空")
    @Username
    private String username;

    /**
     * 用户昵称。
     */
    @Schema(description = "用户昵称", requiredMode = Schema.RequiredMode.REQUIRED, example = "basicframework")
    @NotBlank(message = "用户昵称不能为空")
    @Size(max = 30, message = "用户昵称长度不能超过 30 个字符")
    private String nickname;

    /**
     * 密码。
     */
    @Schema(description = "密码", requiredMode = Schema.RequiredMode.REQUIRED, example = "")
    @NotEmpty(message = "密码不能为空")
    @Password
    private String password;
}
