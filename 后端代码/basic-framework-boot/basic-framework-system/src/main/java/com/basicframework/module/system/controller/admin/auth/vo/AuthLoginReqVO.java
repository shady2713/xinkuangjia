package com.basicframework.module.system.controller.admin.auth.vo;

import com.basicframework.framework.common.validation.Username;
import com.basicframework.module.system.framework.security.sm2.Sm2PasswordCipher;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

/**
 * AuthLoginReqVO 请求对象，承载接口输入参数。
 *
 * @author shady
 */
@Schema(description = "管理后台 - 账号密码登录 Request VO")
@Data
@EqualsAndHashCode(callSuper = false)
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AuthLoginReqVO extends CaptchaVerificationReqVO {

    /**
     * 账号。
     */
    @Schema(description = "账号", requiredMode = Schema.RequiredMode.REQUIRED, example = "basicframework")
    @NotBlank(message = "登录账号不能为空")
    @Username
    private String username;

    /**
     * SM2 密码密文，明文载荷为 {@code {"p":密码,"t":时间戳,"n":随机串}}。
     */
    @Schema(description = "SM2 密码密文（C1C3C2）", requiredMode = Schema.RequiredMode.REQUIRED, example = "")
    @NotBlank(message = "密码不能为空")
    @Size(max = Sm2PasswordCipher.MAX_CIPHERTEXT_HEX_LENGTH, message = "密码密文格式不正确")
    private String password;

}
