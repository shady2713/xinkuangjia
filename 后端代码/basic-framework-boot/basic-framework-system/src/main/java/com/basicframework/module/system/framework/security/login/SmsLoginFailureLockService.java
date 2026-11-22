package com.basicframework.module.system.framework.security.login;

import cn.hutool.core.util.StrUtil;
import cn.hutool.crypto.digest.DigestUtil;
import com.basicframework.framework.security.config.SecurityProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Locale;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.module.system.enums.ErrorCodeConstants.AUTH_LOGIN_ATTEMPT_LOCKED;

/**
 * 短信登录失败锁定服务，按手机号和客户端 IP 两个维度限流。
 *
 * <p>手机号维度限制单个账号的验证码尝试次数，IP 维度限制同一来源批量尝试不同手机号。
 * 两个维度都使用摘要键和带 TTL 的计数，成功登录后清零。锁定提示只返回剩余分钟数，
 * 不区分手机号是否已注册。Redis 不可用时的行为复用 {@link LoginAttemptStore} 的统一降级策略。</p>
 *
 * @author shady2713
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SmsLoginFailureLockService {

    /** 手机号失败计数键前缀。 */
    private static final String MOBILE_FAILURE_KEY_PREFIX = "security:sms-login:fail:mobile:";

    /** 手机号锁定标记键前缀。 */
    private static final String MOBILE_LOCK_KEY_PREFIX = "security:sms-login:lock:mobile:";

    /** IP 失败计数键前缀。 */
    private static final String IP_FAILURE_KEY_PREFIX = "security:sms-login:fail:ip:";

    /** IP 锁定标记键前缀。 */
    private static final String IP_LOCK_KEY_PREFIX = "security:sms-login:lock:ip:";

    private final SecurityProperties securityProperties;

    private final LoginAttemptStore loginAttemptStore;

    /**
     * 检查手机号或客户端 IP 是否处于锁定期。
     *
     * @param mobile 短信登录手机号
     * @param clientIp 客户端 IP，允许为空
     * @throws com.basicframework.framework.common.exception.ServiceException 任一维度处于锁定期时抛出
     */
    public void assertNotLocked(String mobile, String clientIp) {
        if (!isEnabled()) {
            return;
        }
        if (loginAttemptStore.isLocked(formatMobileLockKey(mobile))) {
            throw exception(AUTH_LOGIN_ATTEMPT_LOCKED, resolveRemainingMinutes(
                    formatMobileLockKey(mobile)));
        }
        if (StrUtil.isNotBlank(clientIp) && loginAttemptStore.isLocked(formatIpLockKey(clientIp))) {
            throw exception(AUTH_LOGIN_ATTEMPT_LOCKED, resolveRemainingMinutes(
                    formatIpLockKey(clientIp)));
        }
    }

    /**
     * 记录一次短信验证码失败；任一维度达到阈值后写入对应锁定标记。
     *
     * @param mobile 短信登录手机号
     * @param clientIp 客户端 IP，允许为空
     */
    public void recordFailure(String mobile, String clientIp) {
        if (!isEnabled()) {
            return;
        }
        SecurityProperties.SmsLoginLock config = securityProperties.getSmsLoginLock();
        recordDimensionFailure(formatMobileFailureKey(mobile), formatMobileLockKey(mobile),
                config.getMaxFailures(), config);
        if (StrUtil.isNotBlank(clientIp)) {
            recordDimensionFailure(formatIpFailureKey(clientIp), formatIpLockKey(clientIp),
                    config.getIpMaxFailures(), config);
        }
    }

    /**
     * 短信登录成功后清除手机号和 IP 的失败计数与锁定标记。
     *
     * @param mobile 短信登录手机号
     * @param clientIp 客户端 IP，允许为空
     */
    public void clearFailures(String mobile, String clientIp) {
        if (!isEnabled()) {
            return;
        }
        loginAttemptStore.delete(formatMobileFailureKey(mobile));
        loginAttemptStore.delete(formatMobileLockKey(mobile));
        if (StrUtil.isNotBlank(clientIp)) {
            loginAttemptStore.delete(formatIpFailureKey(clientIp));
            loginAttemptStore.delete(formatIpLockKey(clientIp));
        }
    }

    /**
     * 为单个维度累加失败次数，达到阈值后锁定并清除失败计数。
     *
     * @param failureKey 失败计数键
     * @param lockKey 锁定标记键
     * @param maxFailures 该维度的失败次数阈值
     * @param config 短信登录锁定配置
     */
    private void recordDimensionFailure(String failureKey, String lockKey,
                                        Integer maxFailures, SecurityProperties.SmsLoginLock config) {
        long count = loginAttemptStore.incrementFailure(failureKey, config.getFailureWindow());
        if (count < 0) {
            // 失败关闭策略下锁定检查会拒绝请求，无需依赖本次计数结果。
            return;
        }
        if (count >= maxFailures) {
            loginAttemptStore.lock(lockKey, config.getLockDuration());
            loginAttemptStore.delete(failureKey);
        }
    }

    /**
     * 判断是否启用短信登录失败锁定。
     *
     * @return 启用返回 true
     */
    private boolean isEnabled() {
        return Boolean.TRUE.equals(securityProperties.getSmsLoginLock().getEnabled());
    }

    /**
     * 解析锁定标记的剩余分钟数，至少返回 1。
     *
     * @param lockKey 锁定标记键
     * @return 分钟数
     */
    private long resolveRemainingMinutes(String lockKey) {
        Duration configured = securityProperties.getSmsLoginLock().getLockDuration();
        long seconds = loginAttemptStore.remainingSeconds(lockKey, configured);
        return Math.max(1L, (seconds + 59L) / 60L);
    }

    /**
     * 生成手机号失败计数键。
     *
     * @param mobile 手机号
     * @return Redis 键
     */
    private String formatMobileFailureKey(String mobile) {
        return MOBILE_FAILURE_KEY_PREFIX + hashValue(mobile);
    }

    /**
     * 生成手机号锁定标记键。
     *
     * @param mobile 手机号
     * @return Redis 键
     */
    private String formatMobileLockKey(String mobile) {
        return MOBILE_LOCK_KEY_PREFIX + hashValue(mobile);
    }

    /**
     * 生成 IP 失败计数键。
     *
     * @param clientIp 客户端 IP
     * @return Redis 键
     */
    private String formatIpFailureKey(String clientIp) {
        return IP_FAILURE_KEY_PREFIX + hashValue(clientIp);
    }

    /**
     * 生成 IP 锁定标记键。
     *
     * @param clientIp 客户端 IP
     * @return Redis 键
     */
    private String formatIpLockKey(String clientIp) {
        return IP_LOCK_KEY_PREFIX + hashValue(clientIp);
    }

    /**
     * 规范化手机号或 IP 后计算摘要，避免键中出现原始值。
     *
     * @param value 手机号或 IP
     * @return SHA-256 十六进制摘要
     */
    private String hashValue(String value) {
        return DigestUtil.sha256Hex(StrUtil.trimToEmpty(value).toLowerCase(Locale.ROOT));
    }
}
