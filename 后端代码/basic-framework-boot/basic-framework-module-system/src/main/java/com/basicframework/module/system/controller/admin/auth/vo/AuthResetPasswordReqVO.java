package com.basicframework.module.system.controller.admin.auth.vo;

import com.basicframework.framework.common.validation.Mobile;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 管理后台短信重置密码请求。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/auth/vo/AuthResetPasswordReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 5 行，上游代码 5 行在本地被移除或改写，例如 @Schema(description = "密码摘要", requiredMode = Schema.RequiredMode.REQUIRED, example = "")；@Pattern(regexp = "^[a-fA-F0-9]{32}$", message = "密码摘要必须为 32 位十六进制字符串")；本地补充注释 13 行。
 */
@Schema(description = "管理后台 - 短信重置账号密码 Request VO")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AuthResetPasswordReqVO {

    /**
     * 前端完成原密码复杂度校验后提交的密码 MD5 摘要，服务层按其直接使用 BCrypt 存储。
     *
     * <p>登录、个人改密与管理员重置同样以 MD5 摘要为协议值，找回密码必须保持一致，
     * 否则重置后的存储摘要与登录提交的摘要不同源，用户会被永久挡在密码登录之外。
     * 原始口令不在服务端出现，因此复杂度只能约束摘要格式而不能校验原密码长度与字符组成。</p>
     */
    @Schema(description = "密码摘要", requiredMode = Schema.RequiredMode.REQUIRED, example = "")
    @NotEmpty(message = "密码不能为空")
    @Pattern(regexp = "^[a-fA-F0-9]{32}$", message = "密码摘要必须为 32 位十六进制字符串")
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
