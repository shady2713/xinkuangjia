package com.basicframework.module.system.framework.security.sm2;

import cn.hutool.core.util.StrUtil;
import cn.hutool.crypto.digest.DigestUtil;
import com.basicframework.framework.security.config.SecurityProperties;
import com.basicframework.module.system.enums.logger.LoginLogTypeEnum;
import com.basicframework.module.system.enums.logger.LoginResultEnum;
import com.basicframework.module.system.framework.security.audit.SecurityAuditService;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.module.system.enums.ErrorCodeConstants.AUTH_PASSWORD_TRANSPORT_INVALID;
import static com.basicframework.module.system.enums.ErrorCodeConstants.PASSWORD_TRANSPORT_INVALID;

/**
 * 密码传输服务，负责 SM2 解密、时间戳校验和 nonce 防重放。
 *
 * <p>明文载荷固定为 JSON：{@code {"p":"密码","t":毫秒时间戳,"n":"随机串"}}。
 * 密文、时间戳、重放等校验失败统一转换为通用业务错误，日志不记录明文或密文。</p>
 *
 * @author shady2713
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class Sm2PasswordTransportService {

    /** nonce 允许的字符和长度，避免把任意输入写入 Redis 键。 */
    private static final Pattern NONCE_PATTERN = Pattern.compile("^[A-Za-z0-9_-]{16,64}$");

    /** 单次密码载荷允许的最大字符数，超过后直接拒绝。 */
    private static final int MAX_PASSWORD_LENGTH = 128;

    /** Redis 防重放键前缀。 */
    private static final String NONCE_KEY_PREFIX = "security:sm2:nonce:";

    /** 只用于解析固定结构的密码载荷，不记录解析失败的输入。 */
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private final SecurityProperties securityProperties;

    private final Sm2PasswordCipher sm2PasswordCipher;

    private final StringRedisTemplate stringRedisTemplate;

    private final SecurityAuditService securityAuditService;

    /**
     * 在关闭防重放校验时输出一次启动告警，提醒部署方该实例仅剩时间戳保护。
     */
    @PostConstruct
    public void warnWhenReplayCheckDisabled() {
        if (!Boolean.TRUE.equals(securityProperties.getSm2().getReplayCheckEnabled())) {
            log.warn("[sm2][防重放校验已关闭，仅校验时间戳]");
        }
    }

    /**
     * 获取可下发给前端的 SM2 公钥。
     *
     * @return 带 04 前缀的未压缩公钥
     */
    public String getPublicKeyHex() {
        return sm2PasswordCipher.getPublicKeyHex();
    }

    /**
     * 解密通用密码字段，失败时返回通用业务错误。
     *
     * @param ciphertext SM2 密文
     * @return 解密后的明文密码
     * @throws com.basicframework.framework.common.exception.ServiceException 密文、时间戳或 nonce 校验失败时抛出
     */
    public String decryptPassword(String ciphertext) {
        return decryptInternal(ciphertext, PASSWORD_TRANSPORT_INVALID, LoginLogTypeEnum.PASSWORD_TRANSPORT);
    }

    /**
     * 解密登录密码字段，所有传输校验失败统一按账号密码错误返回。
     *
     * @param ciphertext SM2 密文
     * @return 解密后的明文密码
     * @throws com.basicframework.framework.common.exception.ServiceException 校验失败时抛出
     */
    public String decryptLoginPassword(String ciphertext) {
        return decryptInternal(ciphertext, AUTH_PASSWORD_TRANSPORT_INVALID, LoginLogTypeEnum.LOGIN_USERNAME);
    }

    /**
     * 执行解密、载荷解析、时间窗校验和 nonce 一次性校验，并把失败原因写入安全审计。
     *
     * @param ciphertext SM2 密文
     * @param errorCode 失败时返回的通用错误码
     * @param logType 审计记录使用的登录日志类型
     * @return 明文密码
     */
    private String decryptInternal(String ciphertext,
                                   com.basicframework.framework.common.exception.ErrorCode errorCode,
                                   LoginLogTypeEnum logType) {
        try {
            return doDecrypt(ciphertext);
        } catch (PasswordTransportFailure ex) {
            // 审计只记录失败原因，不记录密文、载荷或底层异常消息。
            securityAuditService.record(logType, ex.getResult(), null, null);
            throw exception(errorCode);
        }
    }

    /**
     * 执行实际的解密与校验流程。
     *
     * @param ciphertext SM2 密文
     * @return 明文密码
     * @throws PasswordTransportFailure 任一传输校验失败时抛出
     */
    private String doDecrypt(String ciphertext) {
        if (StrUtil.isBlank(ciphertext)) {
            throw new PasswordTransportFailure(LoginResultEnum.SM2_DECRYPT_ERROR);
        }
        String plaintext;
        try {
            plaintext = sm2PasswordCipher.decrypt(ciphertext);
        } catch (RuntimeException ex) {
            // 不记录密文或底层异常消息，避免把攻击输入带进日志。
            throw new PasswordTransportFailure(LoginResultEnum.SM2_DECRYPT_ERROR);
        }
        PasswordPayload payload;
        try {
            payload = objectMapper.readValue(plaintext, PasswordPayload.class);
        } catch (Exception ex) {
            throw new PasswordTransportFailure(LoginResultEnum.SM2_DECRYPT_ERROR);
        }
        if (payload == null || StrUtil.isEmpty(payload.getP())
                || payload.getP().length() > MAX_PASSWORD_LENGTH || payload.getT() == null
                || StrUtil.isEmpty(payload.getN()) || !NONCE_PATTERN.matcher(payload.getN()).matches()) {
            throw new PasswordTransportFailure(LoginResultEnum.SM2_DECRYPT_ERROR);
        }
        long now = System.currentTimeMillis();
        long windowMillis = securityProperties.getSm2().getTimestampWindow().toMillis();
        // 同时拒绝过期和超前时间戳，避免客户端时钟偏差过大或重放旧载荷。
        if (payload.getT() > now + windowMillis || payload.getT() < now - windowMillis) {
            throw new PasswordTransportFailure(LoginResultEnum.SM2_DECRYPT_ERROR);
        }
        if (Boolean.TRUE.equals(securityProperties.getSm2().getReplayCheckEnabled())) {
            validateNonceUnused(payload.getN());
        }
        return payload.getP();
    }

    /**
     * 使用 Redis SETNX 保证 nonce 在有效期内只能使用一次。
     *
     * @param nonce 随机串
     */
    private void validateNonceUnused(String nonce) {
        long ttlMillis = resolveNonceTtlMillis();
        String key = NONCE_KEY_PREFIX + DigestUtil.sha256Hex(nonce);
        Boolean firstUse;
        try {
            firstUse = stringRedisTemplate.opsForValue()
                    .setIfAbsent(key, "1", ttlMillis, TimeUnit.MILLISECONDS);
        } catch (RuntimeException ex) {
            // 防重放依赖 Redis；不可用时按失败关闭，避免重放保护静默失效。
            log.error("[sm2][防重放校验不可用: {}]", ex.getClass().getSimpleName());
            throw new PasswordTransportFailure(LoginResultEnum.SM2_REPLAY_CHECK_UNAVAILABLE);
        }
        if (!Boolean.TRUE.equals(firstUse)) {
            throw new PasswordTransportFailure(LoginResultEnum.SM2_REPLAY_REJECTED);
        }
    }

    /**
     * 计算 nonce 的 Redis 保留时长，至少覆盖两倍时间窗。
     *
     * @return 毫秒数
     */
    private long resolveNonceTtlMillis() {
        Duration configured = securityProperties.getSm2().getNonceTtl();
        Duration window = securityProperties.getSm2().getTimestampWindow();
        long minimum = Math.max(1L, window.toMillis() * 2);
        return Math.max(minimum, configured == null ? minimum : configured.toMillis());
    }

    /**
     * 密码传输校验失败，携带写入安全审计的结果原因。
     */
    private static class PasswordTransportFailure extends RuntimeException {

        /** 审计结果原因。 */
        private final LoginResultEnum result;

        /**
         * 构造携带失败原因的异常。
         *
         * @param result 审计结果原因
         */
        private PasswordTransportFailure(LoginResultEnum result) {
            super(null, null, false, false);
            this.result = result;
        }

        /**
         * 获取审计结果原因。
         *
         * @return 审计结果原因
         */
        private LoginResultEnum getResult() {
            return result;
        }
    }

    /**
     * 密码载荷结构，字段名固定为 p/t/n 以缩短密文长度。
     */
    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    private static class PasswordPayload {

        /** 明文密码。 */
        private String p;

        /** 毫秒时间戳。 */
        private Long t;

        /** 一次性随机串。 */
        private String n;
    }
}
