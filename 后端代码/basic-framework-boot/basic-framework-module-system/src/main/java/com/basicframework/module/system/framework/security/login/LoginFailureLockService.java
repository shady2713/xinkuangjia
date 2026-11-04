package com.basicframework.module.system.framework.security.login;

import cn.hutool.core.util.StrUtil;
import cn.hutool.crypto.digest.DigestUtil;
import com.basicframework.framework.security.config.SecurityProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.module.system.enums.ErrorCodeConstants.AUTH_LOGIN_ACCOUNT_LOCKED;

/**
 * 登录失败锁定服务，按账号统计连续失败次数并在达到阈值后临时锁定。
 *
 * <p>统计键只保存账号的 SHA-256 摘要，不把账号原文写入 Redis。锁定与计数都带 TTL，
 * 成功登录后同时清除失败计数和锁定标记。账号不存在时也按同一账号键计数，
 * 避免从锁定行为推断账号是否存在。</p>
 *
 * @author shady2713
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LoginFailureLockService {

    /** 失败计数键前缀。 */
    private static final String FAILURE_KEY_PREFIX = "security:login:fail:";

    /** 锁定标记键前缀。 */
    private static final String LOCK_KEY_PREFIX = "security:login:lock:";

    private final SecurityProperties securityProperties;

    private final StringRedisTemplate stringRedisTemplate;

    /**
     * 检查账号是否处于锁定期。
     *
     * @param username 登录账号
     * @return 已锁定返回 true
     */
    public boolean isLocked(String username) {
        if (!isEnabled()) {
            return false;
        }
        try {
            return Boolean.TRUE.equals(stringRedisTemplate.hasKey(formatLockKey(username)));
        } catch (RuntimeException ex) {
            // 锁定能力依赖 Redis；不可用时放行登录，由其他认证措施继续保护。
            log.warn("[login-lock][读取锁定状态失败: {}]", ex.getClass().getSimpleName());
            return false;
        }
    }

    /**
     * 在锁定时抛出带剩余分钟数的通用提示。
     *
     * @param username 登录账号
     * @throws com.basicframework.framework.common.exception.ServiceException 账号处于锁定期时抛出
     */
    public void assertNotLocked(String username) {
        if (!isLocked(username)) {
            return;
        }
        throw exception(AUTH_LOGIN_ACCOUNT_LOCKED, resolveRemainingMinutes(username));
    }

    /**
     * 记录一次登录失败；达到阈值后写入锁定标记并清除失败计数。
     *
     * @param username 登录账号
     */
    public void recordFailure(String username) {
        if (!isEnabled()) {
            return;
        }
        String failureKey = formatFailureKey(username);
        try {
            Long count = stringRedisTemplate.opsForValue().increment(failureKey);
            if (count == null) {
                return;
            }
            if (count == 1L) {
                stringRedisTemplate.expire(failureKey,
                        securityProperties.getLoginLock().getFailureWindow().toMillis(), TimeUnit.MILLISECONDS);
            }
            if (count >= securityProperties.getLoginLock().getMaxFailures()) {
                stringRedisTemplate.opsForValue().set(formatLockKey(username), "1",
                        securityProperties.getLoginLock().getLockDuration().toMillis(), TimeUnit.MILLISECONDS);
                stringRedisTemplate.delete(failureKey);
            }
        } catch (RuntimeException ex) {
            // 失败计数不可用时不阻断正常业务，也不能把异常细节返回给登录调用方。
            log.warn("[login-lock][记录登录失败失败: {}]", ex.getClass().getSimpleName());
        }
    }

    /**
     * 登录成功后清除失败计数与锁定标记。
     *
     * @param username 登录账号
     */
    public void clearFailures(String username) {
        if (!isEnabled()) {
            return;
        }
        try {
            stringRedisTemplate.delete(formatFailureKey(username));
            stringRedisTemplate.delete(formatLockKey(username));
        } catch (RuntimeException ex) {
            log.warn("[login-lock][清理失败计数失败: {}]", ex.getClass().getSimpleName());
        }
    }

    /**
     * 判断是否启用登录失败锁定。
     *
     * @return 启用返回 true
     */
    private boolean isEnabled() {
        return Boolean.TRUE.equals(securityProperties.getLoginLock().getEnabled());
    }

    /**
     * 解析剩余锁定分钟数，至少返回 1。
     *
     * @param username 登录账号
     * @return 分钟数
     */
    private long resolveRemainingMinutes(String username) {
        Long seconds;
        try {
            seconds = stringRedisTemplate.getExpire(formatLockKey(username), TimeUnit.SECONDS);
        } catch (RuntimeException ex) {
            seconds = null;
        }
        if (seconds == null || seconds <= 0) {
            Duration duration = securityProperties.getLoginLock().getLockDuration();
            return Math.max(1L, (duration.toMillis() + 59_999L) / 60_000L);
        }
        return Math.max(1L, (seconds + 59L) / 60L);
    }

    /**
     * 生成失败计数键。
     *
     * @param username 登录账号
     * @return Redis 键
     */
    private String formatFailureKey(String username) {
        return FAILURE_KEY_PREFIX + hashUsername(username);
    }

    /**
     * 生成锁定标记键。
     *
     * @param username 登录账号
     * @return Redis 键
     */
    private String formatLockKey(String username) {
        return LOCK_KEY_PREFIX + hashUsername(username);
    }

    /**
     * 对账号做规范化并计算摘要，避免 Redis 键中出现账号原文。
     *
     * @param username 登录账号
     * @return SHA-256 十六进制摘要
     */
    private String hashUsername(String username) {
        String normalized = StrUtil.trimToEmpty(username).toLowerCase(Locale.ROOT);
        return DigestUtil.sha256Hex(normalized);
    }
}
