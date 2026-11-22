package com.basicframework.module.system.controller.admin.auth.vo;

import com.basicframework.framework.common.validation.Mobile;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotEmpty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 管理后台短信重置密码请求。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 短信重置账号密码 Request VO")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AuthResetPasswordReqVO {

    /**
     * SM2 密码密文，明文载荷为 {@code {"p":密码,"t":时间戳,"n":随机串}}。
     */
    @Schema(description = "SM2 密码密文（C1C3C2）", requiredMode = Schema.RequiredMode.REQUIRED, example = "")
    @NotEmpty(message = "密码不能为空")
    private String password;

    /**
     * 手机号。
     */
    @Schema(description = "手机号", requiredMode = Schema.RequiredMode.REQUIRED, example = "")
    @NotEmpty(message = "手机号不能为空")
    @Mobile
    private String mobile;

    /**
     * 手机短信验证码。
     */
    @Schema(description = "手机短信验证码", requiredMode = Schema.RequiredMode.REQUIRED, example = "")
    @NotEmpty(message = "手机短信验证码不能为空")
    private String code;
}
