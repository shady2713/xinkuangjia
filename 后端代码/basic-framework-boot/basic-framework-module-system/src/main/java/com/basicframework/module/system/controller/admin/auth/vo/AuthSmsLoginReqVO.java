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
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/auth/vo/AuthSmsLoginReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 2 行，上游代码 2 行在本地被移除或改写，例如 @Schema(description = "手机号", requiredMode = Schema.RequiredMode.REQUIRED)；@Schema(description = "短信验证码", requiredMode = Schema.RequiredMode.REQUIRED)；本地补充注释 6 行。
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
