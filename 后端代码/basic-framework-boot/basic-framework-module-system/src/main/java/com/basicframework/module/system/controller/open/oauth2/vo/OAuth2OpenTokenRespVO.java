package com.basicframework.module.system.controller.open.oauth2.vo;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 第三方开放 OAuth2 客户端模式令牌响应。
 *
 * <p>客户端模式属于机器主体，只签发访问令牌；刷新令牌字段保留是为了固定响应结构，
 * 取值恒为 null。</p>
 *
 * @param accessToken 访问令牌；调用开放接口时放在 Authorization 请求头按 Bearer 方案携带
 * @param refreshToken 刷新令牌；客户端模式不签发刷新令牌，此处固定为 null
 * @param tokenType 令牌类型；当前固定为 Bearer，调用方按该方案组装请求头
 * @param expiresIn 访问令牌剩余有效秒数，从响应时刻起算，已过期时为 0
 * @param scope 实际授权范围，按申请顺序去重后以空格连接
 * @author 李杰
 */
@Schema(description = "开放接口 - OAuth2 客户端模式令牌 Response VO")
public record OAuth2OpenTokenRespVO(
        /** 访问令牌：客户端模式下唯一签发的凭据，按 Bearer 方案放入 Authorization 请求头。 */
        @Schema(description = "访问令牌", requiredMode = Schema.RequiredMode.REQUIRED) String accessToken,
        /** 刷新令牌：机器主体不签发续期凭据，库内哨兵值映射为 {@code null}，不能据此续期。 */
        @Schema(description = "刷新令牌", requiredMode = Schema.RequiredMode.REQUIRED) String refreshToken,
        /** 令牌类型：固定为 {@code Bearer}，调用方按该方案组装认证头，不能自行改写。 */
        @Schema(description = "令牌类型", requiredMode = Schema.RequiredMode.REQUIRED, example = "Bearer") String tokenType,
        /** 访问令牌剩余有效秒数：从生成响应时起算，令牌已过期时下限为 0，不返回负值。 */
        @Schema(description = "访问令牌剩余有效秒数", requiredMode = Schema.RequiredMode.REQUIRED) long expiresIn,
        /** 实际授权范围：按申请顺序去重后以单个空格连接；范围为空时请求已失败，不返回空串。 */
        @Schema(description = "实际授权范围", requiredMode = Schema.RequiredMode.REQUIRED) String scope) {
}
