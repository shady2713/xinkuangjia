package com.basicframework.module.system.controller.admin.auth.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotEmpty;
import lombok.Data;

/**
 * CaptchaVerificationReqVO 请求对象，承载接口输入参数。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
 * 上游文件续：system/controller/admin/auth/vo/CaptchaVerificationReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地补充注释 2 行。
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
    @NotEmpty(message = "验证码不能为空", groups = CodeEnableGroup.class)
    private String captchaVerification;

    /**
     * 开启验证码的 Group
     * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
     * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
     * 上游文件续：system/controller/admin/auth/vo/CaptchaVerificationReqVO.java
     * 来源依据：固定见证版本；历史引入版本未核实。
     * 本地修改：该类型相对固定版本无内容改动。
     */
    public interface CodeEnableGroup {
    }
}
