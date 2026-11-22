package com.basicframework.module.system.controller.open.oauth2.vo;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 第三方开放 OAuth2 客户端模式令牌响应。
 *
 * @param accessToken 访问令牌
 * @param refreshToken 刷新令牌
 * @param tokenType 令牌类型
 * @param expiresIn 访问令牌剩余有效秒数
 * @param scope 实际授权范围，使用空格分隔
 * @author 李杰
 */
@Schema(description = "开放接口 - OAuth2 客户端模式令牌 Response VO")
public record OAuth2OpenTokenRespVO(
        @Schema(description = "访问令牌", requiredMode = Schema.RequiredMode.REQUIRED) String accessToken,
        @Schema(description = "刷新令牌", requiredMode = Schema.RequiredMode.REQUIRED) String refreshToken,
        @Schema(description = "令牌类型", requiredMode = Schema.RequiredMode.REQUIRED, example = "Bearer") String tokenType,
        @Schema(description = "访问令牌剩余有效秒数", requiredMode = Schema.RequiredMode.REQUIRED) long expiresIn,
        @Schema(description = "实际授权范围", requiredMode = Schema.RequiredMode.REQUIRED) String scope) {
}
