package com.basicframework.module.system.controller.admin.user.vo.profile;

import com.basicframework.module.system.framework.security.sm2.Sm2PasswordCipher;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 管理后台个人中心修改密码请求。
 *
 * @author shady
 */
@Schema(description = "管理后台 - 用户个人中心更新密码 Request VO")
@Data
public class UserProfileUpdatePasswordReqVO {

    /**
     * 旧密码的 SM2 密文，与当前登录请求保持一致。
     */
    @Schema(description = "旧密码的 SM2 密文（C1C3C2）", requiredMode = Schema.RequiredMode.REQUIRED, example = "")
    @NotBlank(message = "旧密码不能为空")
    @Size(max = Sm2PasswordCipher.MAX_CIPHERTEXT_HEX_LENGTH, message = "密码密文格式不正确")
    private String oldPassword;

    /**
     * 新密码的 SM2 密文；服务端解密后校验等保二级复杂度并使用 BCrypt 存储。
     */
    @Schema(description = "新密码的 SM2 密文（C1C3C2）", requiredMode = Schema.RequiredMode.REQUIRED, example = "")
    @NotBlank(message = "新密码不能为空")
    @Size(max = Sm2PasswordCipher.MAX_CIPHERTEXT_HEX_LENGTH, message = "密码密文格式不正确")
    private String newPassword;

}
