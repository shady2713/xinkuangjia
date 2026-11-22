package com.basicframework.module.system.controller.admin.auth.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 管理后台刷新访问令牌请求。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 刷新访问令牌 Request VO")
@Data
public class AuthRefreshTokenReqVO {

    /**
     * 刷新令牌。
     */
    @Schema(description = "刷新令牌", requiredMode = Schema.RequiredMode.REQUIRED, example = "")
    @Size(max = 32, message = "刷新令牌长度不能超过 32 个字符")
    private String refreshToken;

}
