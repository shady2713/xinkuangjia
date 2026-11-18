package com.basicframework.module.system.controller.admin.sms.vo.channel;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import lombok.Data;
import org.hibernate.validator.constraints.URL;

import java.time.LocalDateTime;

/**
 * 管理后台短信渠道响应对象。
 *
 * <p>不向前端回传明文 {@code apiSecret}，仅通过 {@link #apiSecretConfigured} 返回密钥是否已配置。</p>
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 短信渠道 Response VO")
@Data
public class SmsChannelRespVO {

    /**
     * 编号。
     */
    @Schema(description = "编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    private Long id;

    /**
     * 短信签名。
     */
    @Schema(description = "短信签名", requiredMode = Schema.RequiredMode.REQUIRED, example = "基础框架")
    @NotNull(message = "短信签名不能为空")
    private String signature;

    /**
     * 渠道编码，参见 SmsChannelEnum 枚举类。
     */
    @Schema(description = "渠道编码，参见 SmsChannelEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "ALIYUN")
    private String code;

    /**
     * 启用状态。
     */
    @Schema(description = "启用状态", requiredMode = Schema.RequiredMode.REQUIRED, example = "0")
    @NotNull(message = "启用状态不能为空")
    private Integer status;

    /**
     * 备注。
     */
    @Schema(description = "备注", example = "生产验证码通道")
    private String remark;

    /**
     * 短信 API 的账号。
     */
    @Schema(description = "短信 API 的账号", requiredMode = Schema.RequiredMode.REQUIRED, example = "sms-access-key")
    @NotNull(message = "短信 API 的账号不能为空")
    private String apiKey;

    /**
     * 是否已配置短信 API 密钥。
     */
    @Schema(description = "是否已配置短信 API 密钥", requiredMode = Schema.RequiredMode.REQUIRED, example = "true")
    private Boolean apiSecretConfigured;

    /**
     * 短信发送回调 URL。
     */
    @Schema(description = "短信发送回调 URL", example = "https://www.example.com")
    @URL(message = "回调 URL 格式不正确")
    private String callbackUrl;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", requiredMode = Schema.RequiredMode.REQUIRED)
    private LocalDateTime createTime;

}
