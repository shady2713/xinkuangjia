package com.basicframework.module.system.controller.admin.user.vo.user;

import com.basicframework.module.system.framework.security.sm2.Sm2PasswordCipher;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 管理后台更新指定用户密码请求。
 *
 * @author shady
 */
@Schema(description = "管理后台 - 用户更新密码 Request VO")
@Data
public class UserUpdatePasswordReqVO {

    /**
     * 用户编号。
     */
    @Schema(description = "用户编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @NotNull(message = "用户编号不能为空")
    private Long id;

    /**
     * 管理员重置密码的 SM2 密码密文，服务端解密后校验复杂度并使用 BCrypt 存储。
     */
    @Schema(description = "SM2 密码密文（C1C3C2）", requiredMode = Schema.RequiredMode.REQUIRED, example = "")
    @NotBlank(message = "密码不能为空")
    @Size(max = Sm2PasswordCipher.MAX_CIPHERTEXT_HEX_LENGTH, message = "密码密文格式不正确")
    private String password;

}
