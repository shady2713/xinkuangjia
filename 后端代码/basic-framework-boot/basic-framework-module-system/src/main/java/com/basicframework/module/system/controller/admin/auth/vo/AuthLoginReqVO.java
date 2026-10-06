package com.basicframework.module.system.controller.admin.auth.vo;

import com.basicframework.framework.common.validation.Username;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotEmpty;
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
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 5 行，上游代码 19 行在本地被移除或改写，例如 @Schema(description = "管理后台 - 账号密码登录 Request VO")；@EqualsAndHashCode(callSuper = false)；本地补充注释 6 行，上游注释 1 行未保留。
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
     * 密码。
     */
    @Schema(description = "密码", requiredMode = Schema.RequiredMode.REQUIRED, example = "")
    @NotEmpty(message = "密码不能为空")
    private String password;

}
