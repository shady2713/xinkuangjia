package com.basicframework.module.system.framework.sms.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import jakarta.validation.constraints.NotNull;
import java.time.Duration;

/**
 * SmsCodeProperties 配置属性对象。
 *
 * @author 李杰
 */
@ConfigurationProperties(prefix = "basic-framework.sms-code")
@Validated
@Data
public class SmsCodeProperties {

    /**
     * 过期时间
     */
    @NotNull(message = "过期时间不能为空")
    private Duration expireTimes;
    /**
     * 短信发送频率
     */
    @NotNull(message = "短信发送频率不能为空")
    private Duration sendFrequency;
    /**
     * 每日发送最大数量
     */
    @NotNull(message = "每日发送最大数量不能为空")
    private Integer sendMaximumQuantityPerDay;

}
