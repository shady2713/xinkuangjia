package com.basicframework.module.system.controller.admin.sms.vo.channel;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import org.hibernate.validator.constraints.URL;

import jakarta.validation.constraints.NotNull;
import java.time.LocalDateTime;

/**
 * SmsChannelRespVO 响应对象，承载接口输出数据。
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
    @Schema(description = "渠道编码，参见 SmsChannelEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "YUN_PIAN")
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
    private String remark;

    /**
     * 短信 API 的账号。
     */
    @Schema(description = "短信 API 的账号", requiredMode = Schema.RequiredMode.REQUIRED, example = "sms-access-key")
    @NotNull(message = "短信 API 的账号不能为空")
    private String apiKey;

    /**
     * 短信 API 的密钥。
     */
    @Schema(description = "短信 API 的密钥", example = "yuanma")
    private String apiSecret;

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
