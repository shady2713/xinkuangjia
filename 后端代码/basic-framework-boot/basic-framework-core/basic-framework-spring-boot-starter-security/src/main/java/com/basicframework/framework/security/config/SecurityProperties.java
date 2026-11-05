package com.basicframework.framework.security.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;
import java.util.Collections;
import java.util.List;

/**
 * 安全框架的配置属性类
 *
 * @author 李杰
 */
@ConfigurationProperties(prefix = "basic-framework.security")
@Validated
@Data
public class SecurityProperties {

    /**
     * HTTP 请求时，访问令牌的请求 Header
     */
    @NotEmpty(message = "Token Header 不能为空")
    private String tokenHeader = "Authorization";
    /**
     * HTTP 请求时，访问令牌的请求参数
     *
     * 初始目的：解决 WebSocket 无法通过 header 传参，只能通过 token 参数拼接
     */
    @NotEmpty(message = "Token Parameter 不能为空")
    private String tokenParameter = "token";

    /**
     * mock 模式的开关
     */
    @NotNull(message = "mock 模式的开关不能为空")
    private Boolean mockEnable = false;
    /**
     * mock 模式的密钥
     * 一定要配置密钥，保证安全性
     */
    @NotEmpty(message = "mock 模式的密钥不能为空") // 仅当 mockEnable 为 true 时需要配置，请使用高强度密钥
    private String mockSecret = "PLEASE_CHANGE_THIS_SECRET";

    /**
     * 免登录的 URL 列表
     */
    private List<String> permitAllUrls = Collections.emptyList();

    /**
     * PasswordEncoder 加密复杂度，越高开销越大
     */
    private Integer passwordEncoderLength = 10;

    /**
     * SM2 密码传输配置。
     *
     * <p>私钥只允许通过环境变量或仓库外配置注入；缺失或格式错误时应用启动失败，
     * 避免在未启用国密传输的情况下继续运行。</p>
     */
    @Valid
    @NotNull(message = "SM2 密码传输配置不能为空")
    private Sm2 sm2 = new Sm2();

    /**
     * 登录失败锁定配置。
     */
    @Valid
    @NotNull(message = "登录失败锁定配置不能为空")
    private LoginLock loginLock = new LoginLock();

    /**
     * 短信登录失败锁定配置。
     */
    @Valid
    @NotNull(message = "短信登录失败锁定配置不能为空")
    private SmsLoginLock smsLoginLock = new SmsLoginLock();

    /**
     * 管理端登录会话配置。
     */
    @Valid
    @NotNull(message = "登录会话配置不能为空")
    private Session session = new Session();

    /**
     * Redis 不可用时的安全降级策略，作用于登录失败锁定、短信登录限流和令牌空闲校验。
     *
     * <p>默认使用本地内存计数兜底，避免 Redis 故障直接阻断全部登录；需要严格失败关闭的部署
     * 可显式改为 {@link RedisUnavailableStrategy#FAIL_CLOSED}。</p>
     */
    @NotNull(message = "Redis 降级策略不能为空")
    private RedisUnavailableStrategy redisUnavailableStrategy = RedisUnavailableStrategy.LOCAL_FALLBACK;

    /**
     * SM2 密码传输配置项。
     */
    @Data
    public static class Sm2 {

        /**
         * 服务端 SM2 私钥，32 字节（64 位十六进制），不得写入源码或提交的配置文件。
         */
        @NotBlank(message = "SM2 私钥未配置：请通过环境变量 SM2_PRIVATE_KEY 注入 64 位十六进制私钥")
        @Pattern(regexp = "^[0-9a-fA-F]{64}$",
                message = "SM2 私钥格式错误：必须为 64 位十六进制字符串")
        private String privateKey = "";

        /**
         * 时间戳允许的偏差窗口，默认 5 分钟。
         */
        @NotNull(message = "SM2 时间戳窗口不能为空")
        private Duration timestampWindow = Duration.ofMinutes(5);

        /**
         * 防重放 nonce 的 Redis 保留时长；小于时间戳窗口时按窗口的两倍兜底。
         */
        @NotNull(message = "SM2 nonce 保留时长不能为空")
        private Duration nonceTtl = Duration.ofMinutes(10);

        /**
         * 是否校验 nonce 一次性；关闭后仅保留时间戳校验，供没有 Redis 的降级环境使用。
         */
        @NotNull(message = "SM2 防重放开关不能为空")
        private Boolean replayCheckEnabled = true;
    }

    /**
     * 登录失败锁定配置项。
     */
    @Data
    public static class LoginLock {

        /**
         * 是否启用登录失败锁定。
         */
        @NotNull(message = "登录失败锁定开关不能为空")
        private Boolean enabled = true;

        /**
         * 触发锁定所需的连续失败次数。
         */
        @NotNull(message = "登录失败锁定次数不能为空")
        @Min(value = 1, message = "登录失败锁定次数必须大于 0")
        private Integer maxFailures = 5;

        /**
         * 锁定时长。
         */
        @NotNull(message = "登录锁定时长不能为空")
        private Duration lockDuration = Duration.ofMinutes(30);

        /**
         * 失败计数保留时长；从首次失败开始计算。
         */
        @NotNull(message = "登录失败计数窗口不能为空")
        private Duration failureWindow = Duration.ofMinutes(30);
    }

    /**
     * 短信登录失败锁定配置项。
     */
    @Data
    public static class SmsLoginLock {

        /**
         * 是否启用短信登录失败锁定。
         */
        @NotNull(message = "短信登录失败锁定开关不能为空")
        private Boolean enabled = true;

        /**
         * 同一手机号允许的连续验证码失败次数。
         */
        @NotNull(message = "短信登录手机号失败次数不能为空")
        @Min(value = 1, message = "短信登录手机号失败次数必须大于 0")
        private Integer maxFailures = 5;

        /**
         * 同一 IP 在失败窗口内允许的连续验证码失败次数。
         */
        @NotNull(message = "短信登录 IP 失败次数不能为空")
        @Min(value = 1, message = "短信登录 IP 失败次数必须大于 0")
        private Integer ipMaxFailures = 20;

        /**
         * 锁定时长。
         */
        @NotNull(message = "短信登录锁定时长不能为空")
        private Duration lockDuration = Duration.ofMinutes(30);

        /**
         * 失败计数保留时长；从首次失败开始计算。
         */
        @NotNull(message = "短信登录失败计数窗口不能为空")
        private Duration failureWindow = Duration.ofMinutes(30);
    }

    /**
     * 管理端登录会话配置项。
     *
     * <p>访问令牌和刷新令牌的有效期由本配置下发给内部会话客户端，不再依赖
     * {@code system_oauth2_client} 中的记录。空闲超时按访问令牌的最后活动时间计算，
     * 小于等于 0 时关闭空闲校验。</p>
     */
    @Data
    public static class Session {

        /**
         * 会话空闲超时；默认 30 分钟，设置 0 或负值关闭空闲校验。
         */
        @NotNull(message = "会话空闲超时不能为空")
        private Duration idleTimeout = Duration.ofMinutes(30);

        /**
         * 访问令牌有效期。
         */
        @NotNull(message = "访问令牌有效期不能为空")
        private Duration accessTokenValidity = Duration.ofMinutes(30);

        /**
         * 刷新令牌有效期。
         */
        @NotNull(message = "刷新令牌有效期不能为空")
        private Duration refreshTokenValidity = Duration.ofDays(30);
    }
}
