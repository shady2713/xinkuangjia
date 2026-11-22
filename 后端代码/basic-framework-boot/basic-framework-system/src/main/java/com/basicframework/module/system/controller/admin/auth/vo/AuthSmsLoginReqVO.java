package com.basicframework.module.system.controller.admin.auth.vo;

import com.basicframework.framework.common.validation.Mobile;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import jakarta.validation.constraints.NotEmpty;

/**
 * AuthSmsLoginReqVO 请求对象，承载接口输入参数。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 短信验证码的登录 Request VO")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AuthSmsLoginReqVO {

    /**
     * 手机号。
     */
    @Schema(description = "手机号", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotEmpty(message = "手机号不能为空")
    @Mobile
    private String mobile;

    /**
     * 短信验证码。
     */
    @Schema(description = "短信验证码", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotEmpty(message = "验证码不能为空")
    private String code;

}
