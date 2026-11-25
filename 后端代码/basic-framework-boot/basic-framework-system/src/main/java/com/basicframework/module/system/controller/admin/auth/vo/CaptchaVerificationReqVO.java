package com.basicframework.module.system.controller.admin.auth.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * CaptchaVerificationReqVO 请求对象，承载接口输入参数。
 *
 * @author shady
 */
@Schema(description = "管理后台 - 验证码 Request VO")
@Data
public class CaptchaVerificationReqVO {

    // ========== 图片验证码相关 ==========

    /**
     * 验证码，验证码开启时，需要传递。
     */
    @Schema(description = "验证码，验证码开启时，需要传递", requiredMode = Schema.RequiredMode.REQUIRED,
            example = "PfcH6mgr8tpXuMWFjvW6YVaqrswIuwmWI5dsVZSg7sGpWtDCUbHuDEXl3cFB1+VvCC/rAkSwK8Fad52FSuncVg==")
    @NotBlank(message = "验证码不能为空", groups = CodeEnableGroup.class)
    @Size(max = 512, message = "验证码参数长度不正确")
    private String captchaVerification;

    /**
     * 开启验证码的 Group
     * @author shady
     */
    public interface CodeEnableGroup {
    }
}
