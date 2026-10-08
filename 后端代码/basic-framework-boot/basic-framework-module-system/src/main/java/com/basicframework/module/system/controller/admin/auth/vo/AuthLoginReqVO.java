package com.basicframework.module.system.controller.admin.auth.vo;

import com.basicframework.framework.common.validation.Username;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

/**
 * AuthLoginReqVO 请求对象，承载接口输入参数。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/auth/vo/AuthLoginReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 5 行，移除或改写上游 19 行；import 新增 4 行、移除 7 行；补充注释 16 行，上游注释 1 行未保留；新增@Pattern约束
 * 来源验收：尚未验收
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
    @NotEmpty(message = "登录账号不能为空")
    @Username
    private String username;

    /**
     * 前端完成原密码复杂度校验后提交的密码 MD5 摘要，服务层按其直接使用 BCrypt 存储。
     *
     * <p>短信重置与登录必须保持同一协议值，否则重置后的存储摘要与登录提交的摘要不同源，
     * 用户会被永久挡在密码登录之外。原始口令不在服务端出现，因此只能约束摘要格式，
     * 不能在此校验原密码长度与字符组成。</p>
     */
    @Schema(description = "密码摘要", requiredMode = Schema.RequiredMode.REQUIRED, example = "")
    @NotEmpty(message = "密码不能为空")
    @Pattern(regexp = "^[a-fA-F0-9]{32}$", message = "密码摘要必须为 32 位十六进制字符串")
    private String password;

}
