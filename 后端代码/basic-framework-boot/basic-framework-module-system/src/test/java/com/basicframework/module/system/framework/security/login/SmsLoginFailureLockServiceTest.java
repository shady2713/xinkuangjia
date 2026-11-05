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
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import static com.basicframework.module.system.enums.ErrorCodeConstants.AUTH_LOGIN_ATTEMPT_LOCKED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证短信登录手机号与 IP 两个维度的失败计数、锁定、清零和 Redis 降级。
 *
 * @author shady2713
 */
@ExtendWith(MockitoExtension.class)
class SmsLoginFailureLockServiceTest {

    /** 用例手机号。 */
    private static final String MOBILE = "13800000000";
    /** 用例客户端 IP。 */
    private static final String CLIENT_IP = "192.0.2.10";

    @Mock
    private StringRedisTemplate stringRedisTemplate;
    @Mock
    private ValueOperations<String, String> valueOperations;

    private SecurityProperties securityProperties;
    private SmsLoginFailureLockService lockService;

    /**
     * 构造手机号 3 次、IP 5 次失败后锁定 30 分钟的服务。
     */
    @BeforeEach
    void setUp() {
        securityProperties = new SecurityProperties();
        securityProperties.getSmsLoginLock().setEnabled(true);
        securityProperties.getSmsLoginLock().setMaxFailures(3);
        securityProperties.getSmsLoginLock().setIpMaxFailures(5);
        securityProperties.getSmsLoginLock().setLockDuration(Duration.ofMinutes(30));
        securityProperties.getSmsLoginLock().setFailureWindow(Duration.ofMinutes(30));
        lockService = new SmsLoginFailureLockService(securityProperties,
                new LoginAttemptStore(securityProperties, stringRedisTemplate));
        lenient().when(stringRedisTemplate.opsForValue()).thenReturn(valueOperations);
    }

    /**
     * 按 Redis 键分别累加失败次数，模拟真实计数器语义。
     */
    private void mockIncrementCounters() {
        Map<String, Long> counters = new HashMap<>();
        when(valueOperations.increment(anyString())).thenAnswer(invocation ->
                counters.merge(invocation.getArgument(0), 1L, Long::sum));
    }

    /** 验证同一手机号达到阈值后写入手机号锁定标记并清理失败计数。 */
    @Test
    void locksMobileAtThreshold() {
        mockIncrementCounters();

        lockService.recordFailure(MOBILE, CLIENT_IP);
        lockService.recordFailure(MOBILE, CLIENT_IP);
        lockService.recordFailure(MOBILE, CLIENT_IP);

        verify(valueOperations).set(argThat(key -> key.contains(":mobile:")), eq("1"),
                eq(Duration.ofMinutes(30).toMillis()), eq(TimeUnit.MILLISECONDS));
        verify(stringRedisTemplate).delete(org.mockito.ArgumentMatchers.<String>argThat(
                key -> key.contains(":mobile:")));
    }

    /** 验证同一 IP 达到阈值后写入 IP 锁定标记。 */
    @Test
    void locksIpAtThreshold() {
        // 提高手机号阈值，让同一 IP 先达到锁定条件。
        securityProperties.getSmsLoginLock().setMaxFailures(10);
        mockIncrementCounters();

        for (int i = 0; i < 5; i++) {
            lockService.recordFailure("1390000000" + i, CLIENT_IP);
        }

        verify(valueOperations).set(argThat(key -> key.contains(":ip:")), eq("1"),
                eq(Duration.ofMinutes(30).toMillis()), eq(TimeUnit.MILLISECONDS));
    }

    /** 验证手机号锁定时返回剩余分钟数且提示不包含手机号。 */
    @Test
    void rejectsLockedMobileWithoutLeakingAccountExistence() {
        when(stringRedisTemplate.hasKey(argThat(key -> key.contains(":mobile:")))).thenReturn(true);
        when(stringRedisTemplate.getExpire(argThat(key -> key.contains(":mobile:")),
                eq(TimeUnit.SECONDS))).thenReturn(120L);

        assertThatThrownBy(() -> lockService.assertNotLocked(MOBILE, CLIENT_IP))
                .isInstanceOfSatisfying(ServiceException.class, ex -> {
                    assertThat(ex.getCode()).isEqualTo(AUTH_LOGIN_ATTEMPT_LOCKED.getCode());
                    assertThat(ex.getMessage()).contains("2");
                    assertThat(ex.getMessage()).doesNotContain(MOBILE);
                });
    }

    /** 验证 IP 锁定时同样返回通用提示。 */
    @Test
    void rejectsLockedIp() {
        when(stringRedisTemplate.hasKey(argThat(key -> key.contains(":ip:")))).thenReturn(true);
        when(stringRedisTemplate.getExpire(argThat(key -> key.contains(":ip:")),
                eq(TimeUnit.SECONDS))).thenReturn(60L);

        assertThatThrownBy(() -> lockService.assertNotLocked(MOBILE, CLIENT_IP))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(AUTH_LOGIN_ATTEMPT_LOCKED.getCode()));
    }

    /** 验证成功登录清空手机号和 IP 的计数与锁定。 */
    @Test
    void clearsBothDimensionsAfterSuccess() {
        lockService.clearFailures(MOBILE, CLIENT_IP);

        verify(stringRedisTemplate, times(4)).delete(anyString());
    }

    /** 验证关闭开关后不再读写 Redis。 */
    @Test
    void disabledLockDoesNotTouchRedis() {
        securityProperties.getSmsLoginLock().setEnabled(false);

        lockService.assertNotLocked(MOBILE, CLIENT_IP);
        lockService.recordFailure(MOBILE, CLIENT_IP);
        lockService.clearFailures(MOBILE, CLIENT_IP);

        verifyNoInteractions(valueOperations);
        verify(stringRedisTemplate, never()).delete(anyString());
    }

    /** 验证无客户端 IP 时只按手机号维度计数。 */
    @Test
    void skipsIpDimensionWhenIpMissing() {
        when(valueOperations.increment(anyString())).thenReturn(1L, 2L);

        lockService.recordFailure(MOBILE, " ");
        lockService.recordFailure(MOBILE, " ");

        verify(valueOperations, times(2)).increment(argThat(key -> key.contains(":mobile:")));
        verify(valueOperations, never()).increment(argThat(key -> key.contains(":ip:")));
    }

    /** 验证 Redis 不可用且策略为本地兜底时，手机号仍会被锁定。 */
    @Test
    void locksMobileLocallyWhenRedisUnavailable() {
        securityProperties.setRedisUnavailableStrategy(RedisUnavailableStrategy.LOCAL_FALLBACK);
        when(valueOperations.increment(anyString())).thenThrow(new IllegalStateException("redis down"));
        doThrow(new IllegalStateException("redis down")).when(valueOperations)
                .set(anyString(), eq("1"), anyLong(), eq(TimeUnit.MILLISECONDS));
        when(stringRedisTemplate.hasKey(anyString())).thenThrow(new IllegalStateException("redis down"));

        lockService.recordFailure(MOBILE, CLIENT_IP);
        lockService.recordFailure(MOBILE, CLIENT_IP);
        lockService.recordFailure(MOBILE, CLIENT_IP);

        assertThatThrownBy(() -> lockService.assertNotLocked(MOBILE, CLIENT_IP))
                .isInstanceOf(ServiceException.class);
    }

    /** 验证 Redis 不可用且策略为失败关闭时，直接拒绝短信登录。 */
    @Test
    void failsClosedWhenRedisUnavailable() {
        securityProperties.setRedisUnavailableStrategy(RedisUnavailableStrategy.FAIL_CLOSED);
        when(stringRedisTemplate.hasKey(anyString())).thenThrow(new IllegalStateException("redis down"));

        assertThatThrownBy(() -> lockService.assertNotLocked(MOBILE, CLIENT_IP))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(AUTH_LOGIN_ATTEMPT_LOCKED.getCode()));
    }
}
