package com.basicframework.module.system.controller.admin.oauth2.vo.token;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * OAuth2AccessTokenRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/oauth2/vo/token/OAuth2AccessTokenRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地补充注释 24 行。
 */
@Schema(description = "管理后台 - 访问令牌 Response VO")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class OAuth2AccessTokenRespVO {

    /**
     * 编号。
     */
    @Schema(description = "编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    private Long id;

    /**
     * 访问令牌。
     */
    @Schema(description = "访问令牌", requiredMode = Schema.RequiredMode.REQUIRED, example = "tudou")
    private String accessToken;

    /**
     * 刷新令牌。
     */
    @Schema(description = "刷新令牌", requiredMode = Schema.RequiredMode.REQUIRED, example = "nice")
    private String refreshToken;

    /**
     * 用户编号。
     */
    @Schema(description = "用户编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "666")
    private Long userId;

    /**
     * 用户类型，参见 UserTypeEnum 枚举。
     */
    @Schema(description = "用户类型，参见 UserTypeEnum 枚举", requiredMode = Schema.RequiredMode.REQUIRED, example = "2")
    private Integer userType;

    /**
     * 客户端编号。
     */
    @Schema(description = "客户端编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "2")
    private String clientId;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", requiredMode = Schema.RequiredMode.REQUIRED)
    private LocalDateTime createTime;

    /**
     * 过期时间。
     */
    @Schema(description = "过期时间", requiredMode = Schema.RequiredMode.REQUIRED)
    private LocalDateTime expiresTime;

}
