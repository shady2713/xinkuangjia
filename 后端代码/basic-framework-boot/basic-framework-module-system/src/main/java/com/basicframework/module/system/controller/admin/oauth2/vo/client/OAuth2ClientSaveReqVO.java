package com.basicframework.module.system.controller.admin.oauth2.vo.client;

import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.util.json.JsonUtils;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import org.hibernate.validator.constraints.URL;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.stream.Stream;

/**
 * 管理后台 OAuth2 客户端创建或修改请求。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/
 * 上游文件续：controller/admin/oauth2/vo/client/OAuth2ClientSaveReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 15 行，移除或改写上游 5 行；import 新增 6 行、移除 4 行；补充注释 66 行。
 * 来源验收：尚未验收
 */
@Schema(description = "管理后台 - OAuth2 客户端创建/修改 Request VO")
@Data
public class OAuth2ClientSaveReqVO {

    /**
     * 集合类字段序列化为 JSON 后允许的最大长度，与数据库 varchar(255) 对齐。
     */
    private static final int SERIALIZED_LIST_MAX_LENGTH = 255;

    /**
     * 编号。
     */
    @Schema(description = "编号", example = "1024")
    private Long id;

    /**
     * 客户端编号。
     */
    @Schema(description = "客户端编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "tudou")
    @NotNull(message = "客户端编号不能为空")
    @Size(max = 255, message = "客户端编号长度不能超过 255 个字符")
    private String clientId;

    /**
     * 客户端密钥；创建时必填，更新时留空表示不变。
     */
    @Schema(description = "客户端密钥；创建时必填，更新时留空表示不变", example = "CHANGE_ME_CLIENT_SECRET")
    @Size(max = 255, message = "客户端密钥长度不能超过 255 个字符")
    private String secret;

    /**
     * 应用名。
     */
    @Schema(description = "应用名", requiredMode = Schema.RequiredMode.REQUIRED, example = "土豆")
    @NotNull(message = "应用名不能为空")
    @Size(max = 255, message = "应用名长度不能超过 255 个字符")
    private String name;

    /**
     * 应用图标。
     */
    @Schema(description = "应用图标", requiredMode = Schema.RequiredMode.REQUIRED, example = "https://www.example.com/xx.png")
    @NotNull(message = "应用图标不能为空")
    @URL(message = "应用图标的地址不正确")
    @Size(max = 255, message = "应用图标地址长度不能超过 255 个字符")
    private String logo;

    /**
     * 应用描述。
     */
    @Schema(description = "应用描述", example = "我是一个应用")
    @Size(max = 255, message = "应用描述长度不能超过 255 个字符")
    private String description;

    /**
     * 状态，参见 CommonStatusEnum 枚举。
     */
    @Schema(description = "状态，参见 CommonStatusEnum 枚举", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @NotNull(message = "状态不能为空")
    private Integer status;

    /**
     * 访问令牌的有效期。
     */
    @Schema(description = "访问令牌的有效期", requiredMode = Schema.RequiredMode.REQUIRED, example = "8640")
    @NotNull(message = "访问令牌的有效期不能为空")
    private Integer accessTokenValiditySeconds;

    /**
     * 刷新令牌的有效期。
     */
    @Schema(description = "刷新令牌的有效期", requiredMode = Schema.RequiredMode.REQUIRED, example = "8640000")
    @NotNull(message = "刷新令牌的有效期不能为空")
    private Integer refreshTokenValiditySeconds;

    /**
     * 可重定向的 URI 地址。
     */
    @Schema(description = "可重定向的 URI 地址", requiredMode = Schema.RequiredMode.REQUIRED, example = "https://www.example.com")
    @NotNull(message = "可重定向的 URI 地址不能为空")
    private List<@NotEmpty(message = "重定向的 URI 不能为空") @URL(message = "重定向的 URI 格式不正确") String> redirectUris;

    /**
     * 授权类型，参见 OAuth2GrantTypeEnum 枚举。
     */
    @Schema(description = "授权类型，参见 OAuth2GrantTypeEnum 枚举", requiredMode = Schema.RequiredMode.REQUIRED, example = "password")
    @NotNull(message = "授权类型不能为空")
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
    @Size(max = 4096, message = "附加信息长度不能超过 4096 个字符")
    private String additionalInformation;

    /**
     * 校验附加信息是否为合法 JSON。
     *
     * @return 为空或 JSON 格式合法时返回 {@code true}
     */
    @AssertTrue(message = "附加信息必须是 JSON 格式")
    public boolean isAdditionalInformationJson() {
        return StrUtil.isEmpty(additionalInformation) || JsonUtils.isJson(additionalInformation);
    }

    /**
     * 按数据库实际存储形式校验集合字段，避免集合转为 JSON 后超过 varchar(255)。
     *
     * @return 所有集合的 JSON 长度均未超过数据库字段上限时返回 {@code true}
     */
    @AssertTrue(message = "OAuth2 集合配置序列化后长度不能超过 255 个字符")
    public boolean isSerializedListLengthValid() {
        return Stream.of(redirectUris, authorizedGrantTypes, scopes, autoApproveScopes, authorities, resourceIds)
                .allMatch(value -> value == null || JsonUtils.toJsonString(value).length() <= SERIALIZED_LIST_MAX_LENGTH);
    }

}
