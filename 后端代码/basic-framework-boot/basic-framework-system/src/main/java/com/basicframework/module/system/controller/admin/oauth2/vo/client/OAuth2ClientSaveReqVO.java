package com.basicframework.module.system.controller.admin.oauth2.vo.client;

import com.basicframework.framework.common.util.json.JsonUtils;
import com.fasterxml.jackson.annotation.JsonIgnore;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.List;
import java.util.stream.Stream;

/**
 * 管理后台 OAuth2 客户端创建或修改请求。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - OAuth2 客户端创建/修改 Request VO")
@Data
public class OAuth2ClientSaveReqVO {

    private static final int SERIALIZED_LIST_MAX_LENGTH = 255;

    @Schema(description = "编号", example = "1024")
    private Long id;

    @Schema(description = "客户端编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "portal-web")
    @NotBlank(message = "客户端编号不能为空")
    @Size(max = 255, message = "客户端编号长度不能超过 255 个字符")
    private String clientId;

    @Schema(description = "客户端密钥；创建时必填，更新时留空表示不变", example = "CHANGE_ME_CLIENT_SECRET")
    @Size(max = 255, message = "客户端密钥长度不能超过 255 个字符")
    private String secret;

    @Schema(description = "应用名", requiredMode = Schema.RequiredMode.REQUIRED, example = "门户客户端")
    @NotBlank(message = "应用名不能为空")
    @Size(max = 255, message = "应用名长度不能超过 255 个字符")
    private String name;

    @Schema(description = "应用描述", example = "第三方业务系统")
    @Size(max = 255, message = "应用描述长度不能超过 255 个字符")
    private String description;

    @Schema(description = "状态，参见 CommonStatusEnum 枚举", requiredMode = Schema.RequiredMode.REQUIRED, example = "0")
    @NotNull(message = "状态不能为空")
    private Integer status;

    @Schema(description = "访问令牌的有效期（秒）", requiredMode = Schema.RequiredMode.REQUIRED, example = "8640")
    @NotNull(message = "访问令牌的有效期不能为空")
    @Min(value = 1, message = "访问令牌有效期必须大于 0 秒")
    private Integer accessTokenValiditySeconds;

    @Schema(description = "刷新令牌的有效期（秒）", requiredMode = Schema.RequiredMode.REQUIRED, example = "8640000")
    @NotNull(message = "刷新令牌的有效期不能为空")
    @Min(value = 1, message = "刷新令牌有效期必须大于 0 秒")
    private Integer refreshTokenValiditySeconds;

    @Schema(description = "授权类型，参见 OAuth2GrantTypeEnum 枚举", requiredMode = Schema.RequiredMode.REQUIRED, example = "client_credentials")
    @NotNull(message = "授权类型不能为空")
    private List<String> authorizedGrantTypes;

    @Schema(description = "授权范围", example = "user_info")
    private List<String> scopes;

    @AssertTrue(message = "OAuth2 集合配置序列化后长度不能超过 255 个字符")
    @JsonIgnore
    public boolean isSerializedListLengthValid() {
        return Stream.of(authorizedGrantTypes, scopes)
                .allMatch(value -> value == null || JsonUtils.toJsonString(value).length() <= SERIALIZED_LIST_MAX_LENGTH);
    }

}
