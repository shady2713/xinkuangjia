package com.basicframework.module.system.framework.security.login;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.security.config.RedisUnavailableStrategy;
import com.basicframework.framework.security.config.SecurityProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.time.Duration;
import java.util.concurrent.TimeUnit;

import static com.basicframework.module.system.enums.ErrorCodeConstants.AUTH_LOGIN_ACCOUNT_LOCKED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证登录失败计数、锁定、解锁、关闭开关以及 Redis 不可用时的降级策略。
 *
 * @author shady2713
 */
@ExtendWith(MockitoExtension.class)
class LoginFailureLockServiceTest {

    @Mock
    private StringRedisTemplate stringRedisTemplate;
    @Mock
    private ValueOperations<String, String> valueOperations;

    private SecurityProperties securityProperties;
    private LoginFailureLockService lockService;

    /**
     * 构造三次失败即锁定 30 分钟的服务。
     */
    @BeforeEach
    void setUp() {
        securityProperties = new SecurityProperties();
        securityProperties.getLoginLock().setEnabled(true);
        securityProperties.getLoginLock().setMaxFailures(3);
        securityProperties.getLoginLock().setLockDuration(Duration.ofMinutes(30));
        securityProperties.getLoginLock().setFailureWindow(Duration.ofMinutes(30));
        lockService = new LoginFailureLockService(securityProperties,
                new LoginAttemptStore(securityProperties, stringRedisTemplate));
        lenient().when(stringRedisTemplate.opsForValue()).thenReturn(valueOperations);
    }

    /** 验证首次失败写入带 TTL 的计数键。 */
    @Test
    void recordsFirstFailureWithExpiry() {
        when(valueOperations.increment(anyString())).thenReturn(1L);

        lockService.recordFailure("Admin");

        verify(stringRedisTemplate).expire(anyString(), eq(Duration.ofMinutes(30).toMillis()),
                eq(TimeUnit.MILLISECONDS));
    }

    /** 验证达到阈值后写入锁定键并清理失败计数。 */
    @Test
    void locksAccountAtThreshold() {
        when(valueOperations.increment(anyString())).thenReturn(3L);

        lockService.recordFailure("Admin");

        verify(valueOperations).set(anyString(), eq("1"), eq(Duration.ofMinutes(30).toMillis()),
                eq(TimeUnit.MILLISECONDS));
        verify(stringRedisTemplate).delete(anyString());
    }

    /** 验证锁定状态会带剩余分钟数返回通用错误。 */
    @Test
    void rejectsLockedAccountWithRemainingMinutes() {
        when(stringRedisTemplate.hasKey(anyString())).thenReturn(true);
        when(stringRedisTemplate.getExpire(anyString(), eq(TimeUnit.SECONDS))).thenReturn(90L);

        assertThatThrownBy(() -> lockService.assertNotLocked("Admin"))
                .isInstanceOfSatisfying(ServiceException.class, ex -> {
                    assertThat(ex.getCode()).isEqualTo(AUTH_LOGIN_ACCOUNT_LOCKED.getCode());
                    assertThat(ex.getMessage()).contains("2");
                });
    }

    /** 验证成功登录同时清除计数和锁定键。 */
    @Test
    void clearsFailuresAfterSuccess() {
        lockService.clearFailures("Admin");

        verify(stringRedisTemplate, times(2)).delete(anyString());
    }

    /** 验证关闭开关后不再读写 Redis。 */
    @Test
    void disabledLockDoesNotTouchRedis() {
        securityProperties.getLoginLock().setEnabled(false);

        assertThat(lockService.isLocked("Admin")).isFalse();
        lockService.recordFailure("Admin");
        lockService.clearFailures("Admin");

        verifyNoInteractions(valueOperations);
        verify(stringRedisTemplate, never()).delete(anyString());
    }

    /** 验证 Redis 不可用且策略为本地兜底时，仍能按内存计数锁定账号。 */
    @Test
    void locksAccountLocallyWhenRedisUnavailable() {
        securityProperties.setRedisUnavailableStrategy(RedisUnavailableStrategy.LOCAL_FALLBACK);
        when(valueOperations.increment(anyString())).thenThrow(new IllegalStateException("redis down"));
        doThrow(new IllegalStateException("redis down")).when(valueOperations)
                .set(anyString(), eq("1"), anyLong(), eq(TimeUnit.MILLISECONDS));
        when(stringRedisTemplate.hasKey(anyString())).thenThrow(new IllegalStateException("redis down"));

        lockService.recordFailure("Admin");
        lockService.recordFailure("Admin");
        lockService.recordFailure("Admin");

        assertThat(lockService.isLocked("Admin")).isTrue();
    }

    /** 验证本地兜底锁定也能返回剩余分钟数。 */
    @Test
    void localLockReturnsRemainingMinutes() {
        securityProperties.setRedisUnavailableStrategy(RedisUnavailableStrategy.LOCAL_FALLBACK);
        when(valueOperations.increment(anyString())).thenThrow(new IllegalStateException("redis down"));
        doThrow(new IllegalStateException("redis down")).when(valueOperations)
                .set(anyString(), eq("1"), anyLong(), eq(TimeUnit.MILLISECONDS));
        when(stringRedisTemplate.hasKey(anyString())).thenThrow(new IllegalStateException("redis down"));

        lockService.recordFailure("Admin");
        lockService.recordFailure("Admin");
        lockService.recordFailure("Admin");

        assertThatThrownBy(() -> lockService.assertNotLocked("Admin"))
                .isInstanceOfSatisfying(ServiceException.class, ex -> {
                    assertThat(ex.getCode()).isEqualTo(AUTH_LOGIN_ACCOUNT_LOCKED.getCode());
                    assertThat(ex.getMessage()).contains("30");
                });
    }

    /** 验证 Redis 不可用且策略为失败关闭时，不再放行登录。 */
    @Test
    void failsClosedWhenRedisUnavailable() {
        securityProperties.setRedisUnavailableStrategy(RedisUnavailableStrategy.FAIL_CLOSED);
        when(stringRedisTemplate.hasKey(anyString())).thenThrow(new IllegalStateException("redis down"));

        assertThat(lockService.isLocked("Admin")).isTrue();
        assertThatThrownBy(() -> lockService.assertNotLocked("Admin"))
                .isInstanceOf(ServiceException.class);
    }

    /** 验证本地兜底计数在成功登录后会被清理。 */
    @Test
    void clearsLocalFailuresAfterSuccess() {
        securityProperties.setRedisUnavailableStrategy(RedisUnavailableStrategy.LOCAL_FALLBACK);
        when(valueOperations.increment(anyString())).thenThrow(new IllegalStateException("redis down"));
        when(stringRedisTemplate.hasKey(anyString())).thenThrow(new IllegalStateException("redis down"));

        lockService.recordFailure("Admin");
        lockService.recordFailure("Admin");
        lockService.clearFailures("Admin");

        assertThat(lockService.isLocked("Admin")).isFalse();
    }
}
