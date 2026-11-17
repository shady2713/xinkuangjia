package com.basicframework.module.system.framework.sms.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import jakarta.validation.constraints.NotNull;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 短信回调签名配置，按渠道保存验签密钥与请求时间窗口。
 *
 * <p>阿里云 SmsReport 与腾讯云短信下发状态通知的当前协议只包含业务字段，没有厂商签名字段，
 * 因此回调入口使用应用层 HMAC-SHA256 签名：调用方在 {@code X-Sms-Callback-Signature}
 * 请求头传入签名，在 {@code X-Sms-Callback-Timestamp} 请求头传入秒级时间戳。未配置密钥的
 * 渠道按失败关闭处理，不解析也不写入回执状态。</p>
 *
 * <p>厂商文档核对日期：2026-11-17。参见
 * <a href="https://help.aliyun.com/zh/sms/developer-reference/smsreport-http">阿里云 SmsReport</a>
 * 与
 * <a href="https://cloud.tencent.com/document/product/382/59178">腾讯云短信下发状态通知</a>。</p>
 *
 * @author shady2713
 */
@ConfigurationProperties(prefix = "basic-framework.sms-callback")
@Validated
@Data
public class SmsCallbackProperties {

    /**
     * 各渠道回调签名密钥。
     *
     * <p>key 为渠道编码，使用
     * {@link com.basicframework.module.system.framework.sms.core.enums.SmsChannelEnum#getCode()}
     * 的取值，例如 {@code ALIYUN}、{@code TENCENT}。key 不区分大小写。</p>
     */
    private Map<String, String> secrets = new LinkedHashMap<>();

    /**
     * 允许的请求时间戳偏差，默认 5 分钟。
     */
    @NotNull(message = "短信回调时间戳容差不能为空")
    private Duration timestampTolerance = Duration.ofMinutes(5);

}
