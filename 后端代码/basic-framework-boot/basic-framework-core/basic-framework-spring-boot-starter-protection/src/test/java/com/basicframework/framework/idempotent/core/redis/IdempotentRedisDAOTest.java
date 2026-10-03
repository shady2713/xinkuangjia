package com.basicframework.framework.idempotent.core.redis;

import com.basicframework.framework.protection.support.ProtectionRedisTestSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证幂等占位 Key 在真实 Redis 上的原子写入、过期与释放行为。
 *
 * <p>{@code setIfAbsent} 的“只写一次”语义是幂等组件的全部根基：它必须在多实例并发下让同一个业务 Key
 * 只有一次写入成功。用内存 Map 或 mock 替身验证只能证明方法被调用过，证明不了 SETNX 的原子性与 TTL 生效，
 * 因此这里直接打真实实例。</p>
 *
 * @author shady2713
 */
class IdempotentRedisDAOTest extends ProtectionRedisTestSupport {

    /** 被测 DAO，全部方法都走真实 Redis。 */
    private IdempotentRedisDAO idempotentRedisDAO;

    /**
     * 为每个用例创建独立的被测 DAO，避免用例之间共享可变状态。
     */
    @BeforeEach
    void setUp() {
        idempotentRedisDAO = new IdempotentRedisDAO(stringRedisTemplate);
    }

    /**
     * 验证首次写入成功并落到 {@code idempotent:} 前缀的 Key 上。
     *
     * <p>Key 前缀是幂等占位与其它业务数据共存的前提，写错前缀会污染同库其它 Key 的清理与统计，
     * 因此这里直接断言真实 Key 名。</p>
     */
    @Test
    @DisplayName("首次写入幂等占位成功，并落到 idempotent: 前缀的 Key 上")
    void shouldWriteIdempotentKeyOnFirstAttempt() {
        String key = nextKey("first-attempt");

        assertThat(idempotentRedisDAO.setIfAbsent(key, 60, TimeUnit.SECONDS)).isTrue();

        assertThat(stringRedisTemplate.hasKey("idempotent:" + key)).isTrue();
    }

    /**
     * 验证同一个业务 Key 第二次写入失败，这正是“重复请求”能被识别的依据。
     */
    @Test
    @DisplayName("同一业务 Key 重复写入失败，重复请求因此可被拦截")
    void shouldRejectSecondWriteForSameKey() {
        String key = nextKey("duplicate");

        assertThat(idempotentRedisDAO.setIfAbsent(key, 60, TimeUnit.SECONDS)).isTrue();
        assertThat(idempotentRedisDAO.setIfAbsent(key, 60, TimeUnit.SECONDS))
                .as("占位未过期前必须拒绝重复写入")
                .isFalse();
    }

    /**
     * 验证不同业务 Key 之间互不影响，不会因为共用前缀就互相顶掉。
     */
    @Test
    @DisplayName("不同业务 Key 的占位互相独立")
    void shouldIsolateDifferentBusinessKeys() {
        String first = nextKey("order-1001");
        String second = nextKey("order-1002");

        assertThat(idempotentRedisDAO.setIfAbsent(first, 60, TimeUnit.SECONDS)).isTrue();
        assertThat(idempotentRedisDAO.setIfAbsent(second, 60, TimeUnit.SECONDS))
                .as("另一个业务 Key 不应被已占用的 Key 牵连")
                .isTrue();
    }

    /**
     * 验证过期时间按注解给定的单位真实下发给 Redis。
     *
     * <p>幂等超时是业务可配的，若单位换算写错，占位会提前失效（重复请求穿透）或迟迟不失效
     * （正常请求被误拦），因此按秒与按分钟分别校验。</p>
     */
    @Test
    @DisplayName("占位的过期时间按注解给定的单位下发给 Redis")
    void shouldApplyConfiguredTimeoutWithGivenUnit() {
        String secondsKey = nextKey("timeout-seconds");
        String minutesKey = nextKey("timeout-minutes");

        idempotentRedisDAO.setIfAbsent(secondsKey, 30, TimeUnit.SECONDS);
        idempotentRedisDAO.setIfAbsent(minutesKey, 2, TimeUnit.MINUTES);

        assertThat(stringRedisTemplate.getExpire("idempotent:" + secondsKey, TimeUnit.SECONDS))
                .isBetween(1L, 30L);
        assertThat(stringRedisTemplate.getExpire("idempotent:" + minutesKey, TimeUnit.SECONDS))
                .isBetween(30L, 120L);
    }

    /**
     * 验证删除占位后同一个业务 Key 可以重新写入，业务失败后重试才能成功。
     */
    @Test
    @DisplayName("删除占位后同一业务 Key 可以重新写入")
    void shouldAllowRewriteAfterKeyDeleted() {
        String key = nextKey("retry-after-failure");

        assertThat(idempotentRedisDAO.setIfAbsent(key, 60, TimeUnit.SECONDS)).isTrue();
        idempotentRedisDAO.delete(key);

        assertThat(stringRedisTemplate.hasKey("idempotent:" + key)).isFalse();
        assertThat(idempotentRedisDAO.setIfAbsent(key, 60, TimeUnit.SECONDS))
                .as("业务异常后释放占位，重试必须能再次执行")
                .isTrue();
    }

    /**
     * 验证删除一个不存在的占位不会抛异常，异常分支清理因此可以无条件调用。
     */
    @Test
    @DisplayName("删除不存在的占位不抛异常，异常清理可以无条件调用")
    void shouldIgnoreDeleteOfAbsentKey() {
        String key = nextKey("never-written");

        idempotentRedisDAO.delete(key);

        assertThat(stringRedisTemplate.hasKey("idempotent:" + key)).isFalse();
    }
}
