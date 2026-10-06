package com.basicframework.module.system.framework.sms.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Min;
import org.hibernate.validator.constraints.time.DurationMin;
import java.time.Duration;

/**
 * SmsCodeProperties 配置属性对象。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/framework/sms/config/SmsCodeProperties.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配、配置前缀由 yudao.* 改为 basic-framework.*；本地改写/新增代码 18 行，上游代码 5 行在本地被移除或改写，例如 @ConfigurationProperties(prefix = "basic-framework.sms-code")；@DurationMin(millis = 1, message = "过期时间必须大于零")；本地补充注释 6 行，上游注释 2 行未保留。
 */
@ConfigurationProperties(prefix = "basic-framework.sms-code")
@Validated
@Data
public class SmsCodeProperties {

    /**
     * 过期时间
     */
    @NotNull(message = "过期时间不能为空")
    @DurationMin(millis = 1, message = "过期时间必须大于零")
    private Duration expireTimes;
    /**
     * 短信发送频率
     */
    @NotNull(message = "短信发送频率不能为空")
    @DurationMin(millis = 1, message = "发送间隔必须大于零")
    private Duration sendFrequency;
    /**
     * 每日发送最大数量
     */
    @NotNull(message = "每日发送最大数量不能为空")
    @Min(1)
    private Integer sendMaximumQuantityPerDay;

    /** 同一可信 IP 的发送请求计数窗口，包含被拒绝的发送尝试。 */
    @NotNull
    @DurationMin(millis = 1, message = "发送 IP 计数窗口必须大于零")
    private Duration sendIpWindow = Duration.ofMinutes(1);

    /** 同一可信 IP 每个窗口最多允许的验证码发送请求数。 */
    @Min(1)
    private int sendMaximumPerIp = 50;

    /** 每个最新验证码允许的最大错误次数，达到上限后即使输入正确也拒绝。 */
    @Min(1)
    private int verificationMaximumFailures = 5;

    /** 手机号和客户端 IP 验证请求的固定计数窗口。 */
    @NotNull
    @DurationMin(millis = 1, message = "验证计数窗口必须大于零")
    private Duration verificationWindow = Duration.ofMinutes(1);

    /** 同一手机号在计数窗口内允许的总验证请求数，包含重放和错误。 */
    @Min(1)
    private int verificationMaximumPerMobile = 10;

    /** 同一可信客户端 IP 在计数窗口内允许的总验证请求数。 */
    @Min(1)
    private int verificationMaximumPerIp = 50;

}
