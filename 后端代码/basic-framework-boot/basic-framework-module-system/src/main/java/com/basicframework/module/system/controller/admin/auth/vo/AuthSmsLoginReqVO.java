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
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 2 行，移除或改写上游 2 行；import 新增 1 行、移除 1 行；补充注释 11 行。
 * 来源验收：尚未验收
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
