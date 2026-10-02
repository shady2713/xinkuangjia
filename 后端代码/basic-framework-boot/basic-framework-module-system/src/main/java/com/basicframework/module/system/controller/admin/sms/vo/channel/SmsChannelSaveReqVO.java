package com.basicframework.module.system.controller.admin.sms.vo.channel;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import org.hibernate.validator.constraints.URL;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 管理后台短信渠道创建或修改请求。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 短信渠道创建/修改 Request VO")
@Data
public class SmsChannelSaveReqVO {

    /**
     * 编号。
     */
    @Schema(description = "编号", example = "1024")
    private Long id;

    /**
     * 短信签名。
     */
    @Schema(description = "短信签名", requiredMode = Schema.RequiredMode.REQUIRED, example = "基础框架")
    @NotNull(message = "短信签名不能为空")
    @Size(max = 12, message = "短信签名长度不能超过 12 个字符")
    private String signature;

    /**
     * 渠道编码，参见 SmsChannelEnum 枚举类。
     */
    @Schema(description = "渠道编码，参见 SmsChannelEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "YUN_PIAN")
    @NotNull(message = "渠道编码不能为空")
    @Size(max = 63, message = "渠道编码长度不能超过 63 个字符")
    private String code;

    /**
     * 启用状态。
     */
    @Schema(description = "启用状态", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @NotNull(message = "启用状态不能为空")
    private Integer status;

    /**
     * 备注。
     */
    @Schema(description = "备注", example = "好吃！")
    @Size(max = 255, message = "备注长度不能超过 255 个字符")
    private String remark;

    /**
     * 短信 API 的账号。
     */
    @Schema(description = "短信 API 的账号", requiredMode = Schema.RequiredMode.REQUIRED, example = "sms-access-key")
    @NotNull(message = "短信 API 的账号不能为空")
    @Size(max = 128, message = "短信 API 账号长度不能超过 128 个字符")
    private String apiKey;

    /**
     * 短信 API 的密钥。
     */
    @Schema(description = "短信 API 的密钥", example = "yuanma")
    @Size(max = 128, message = "短信 API 密钥长度不能超过 128 个字符")
    private String apiSecret;

    /**
     * 短信发送回调 URL。
     */
    @Schema(description = "短信发送回调 URL", example = "http://www.example.com")
    @URL(message = "回调 URL 格式不正确")
    @Size(max = 255, message = "回调 URL 长度不能超过 255 个字符")
    private String callbackUrl;

}
