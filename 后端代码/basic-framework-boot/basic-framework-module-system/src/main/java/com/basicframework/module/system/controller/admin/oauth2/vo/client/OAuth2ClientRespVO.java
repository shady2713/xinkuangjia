package com.basicframework.module.system.controller.admin.oauth2.vo.client;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 管理后台 OAuth2 客户端响应。
 *
 * <p>响应不得包含客户端密钥；密钥只在创建或主动轮换时由调用方提交，服务端不提供反向读取。</p>
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - OAuth2 客户端 Response VO")
@Data
public class OAuth2ClientRespVO {

    /**
     * 编号。
     */
    @Schema(description = "编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    private Long id;

    /**
     * 客户端编号。
     */
    @Schema(description = "客户端编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "tudou")
    private String clientId;

    /**
     * 应用名。
     */
    @Schema(description = "应用名", requiredMode = Schema.RequiredMode.REQUIRED, example = "土豆")
    private String name;

    /**
     * 应用图标。
     */
    @Schema(description = "应用图标", requiredMode = Schema.RequiredMode.REQUIRED, example = "https://www.example.com/xx.png")
    private String logo;

    /**
     * 应用描述。
     */
    @Schema(description = "应用描述", example = "我是一个应用")
    private String description;

    /**
     * 状态，参见 CommonStatusEnum 枚举。
     */
    @Schema(description = "状态，参见 CommonStatusEnum 枚举", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    private Integer status;

    /**
     * 访问令牌的有效期。
     */
    @Schema(description = "访问令牌的有效期", requiredMode = Schema.RequiredMode.REQUIRED, example = "8640")
    private Integer accessTokenValiditySeconds;

    /**
     * 刷新令牌的有效期。
     */
    @Schema(description = "刷新令牌的有效期", requiredMode = Schema.RequiredMode.REQUIRED, example = "8640000")
    private Integer refreshTokenValiditySeconds;

    /**
     * 可重定向的 URI 地址。
     */
    @Schema(description = "可重定向的 URI 地址", requiredMode = Schema.RequiredMode.REQUIRED, example = "https://www.example.com")
    private List<String> redirectUris;

    /**
     * 授权类型，参见 OAuth2GrantTypeEnum 枚举。
     */
    @Schema(description = "授权类型，参见 OAuth2GrantTypeEnum 枚举", requiredMode = Schema.RequiredMode.REQUIRED, example = "password")
    private List<String> authorizedGrantTypes;

    /**
     * 授权范围。
     */
    @Schema(description = "授权范围", example = "user_info")
    private List<String> scopes;

    /**
     * 自动通过的授权范围。
     */
    @Schema(description = "自动通过的授权范围", example = "user_info")
    private List<String> autoApproveScopes;

    /**
     * 权限。
     */
    @Schema(description = "权限", example = "system:user:query")
    private List<String> authorities;

    /**
     * 资源。
     */
    @Schema(description = "资源", example = "1024")
    private List<String> resourceIds;

    /**
     * 附加信息。
     */
    @Schema(description = "附加信息", example = "")
    private String additionalInformation;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", requiredMode = Schema.RequiredMode.REQUIRED)
    private LocalDateTime createTime;

}
