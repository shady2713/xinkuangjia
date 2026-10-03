package com.basicframework.framework.ratelimiter.core.redis;

import com.basicframework.framework.protection.support.ProtectionRedisTestSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.redisson.api.RRateLimiter;
import org.redisson.api.RateType;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证限流令牌在真实 Redis 上的发放、拒绝、配置刷新与过期行为。
 *
 * <p>限流的正确性完全依赖 Redisson 服务端的令牌计算：周期内放行次数、配置变化后是否重建令牌、
 * 以及限流器 Key 是否会长期残留，都无法用内存替身证明（替身只会让测试“看起来通过”）。因此这里全部
 * 打真实实例，并直接读取 Redisson 落盘的配置与 TTL 作为证据。</p>
 *
 * @author shady2713
 */
class RateLimiterRedisDAOTest extends ProtectionRedisTestSupport {

    /** 限流周期内的放行次数。 */
    private static final int COUNT = 3;

    /** 限流周期长度（秒），取足够长以免用例执行期间令牌自然恢复。 */
    private static final int PERIOD_SECONDS = 60;

    /** 被测 DAO，全部方法都走真实 Redisson 客户端。 */
    private RateLimiterRedisDAO rateLimiterRedisDAO;

    /**
     * 为每个用例创建独立的被测 DAO，避免用例之间共享可变状态。
     */
    @BeforeEach
    void setUp() {
        rateLimiterRedisDAO = new RateLimiterRedisDAO(redissonClient);
    }

    /**
     * 验证周期内按配置的次数放行，超出后拒绝。
     *
     * <p>这是限流对外承诺的语义：{@code count} 次以内正常放行，第 {@code count + 1} 次必须被拒。</p>
     */
    @Test
    @DisplayName("周期内按配置次数放行，超出后拒绝")
    void shouldGrantExactlyConfiguredNumberOfPermits() {
        String key = nextKey("rate-basic");

        for (int index = 0; index < COUNT; index++) {
            assertThat(rateLimiterRedisDAO.tryAcquire(key, COUNT, PERIOD_SECONDS, TimeUnit.SECONDS))
                    .as("第 %s 次请求应在配额内", index + 1)
                    .isTrue();
        }

        assertThat(rateLimiterRedisDAO.tryAcquire(key, COUNT, PERIOD_SECONDS, TimeUnit.SECONDS))
                .as("超出配额的请求必须被限流")
                .isFalse();
    }

    /**
     * 验证首次调用后限流器配置已按注解参数落盘，且 Key 名带业务前缀。
     *
     * <p>配置写成哈希字段 {@code rate}/{@code interval}/{@code type}，其中 interval 以毫秒为单位；
     * 读回来与注解一致，才能证明“限流窗口”真的就是注解声明的那个窗口。</p>
     */
    @Test
    @DisplayName("首次调用按注解参数落盘限流器配置")
    void shouldPersistConfiguredRateOnFirstAcquire() {
        String key = nextKey("rate-config");

        assertThat(rateLimiterRedisDAO.tryAcquire(key, COUNT, PERIOD_SECONDS, TimeUnit.SECONDS)).isTrue();

        RRateLimiter limiter = redissonClient.getRateLimiter("rate_limiter:" + key);
        assertThat(limiter.getConfig().getRateType()).isEqualTo(RateType.OVERALL);
        assertThat(limiter.getConfig().getRate()).isEqualTo((long) COUNT);
        assertThat(limiter.getConfig().getRateInterval())
                .as("Redisson 以毫秒记录限流间隔")
                .isEqualTo(TimeUnit.SECONDS.toMillis(PERIOD_SECONDS));
    }

    /**
     * 验证配置未变化时不会重建限流器，已经用完的配额不会被意外重置。
     *
     * <p>若实现每次都用 {@code setRate} 重建，Redisson 会清空已用令牌，同一窗口内的第 4 次请求就会被
     * 错误放行，限流形同虚设。这里连续拒绝两次来锁死这个契约。</p>
     */
    @Test
    @DisplayName("配置未变化时保持已用完的配额，不会把限流重置掉")
    void shouldKeepExhaustedQuotaWhenConfigurationUnchanged() {
        String key = nextKey("rate-stable");

        assertThat(rateLimiterRedisDAO.tryAcquire(key, 1, PERIOD_SECONDS, TimeUnit.SECONDS)).isTrue();
        assertThat(rateLimiterRedisDAO.tryAcquire(key, 1, PERIOD_SECONDS, TimeUnit.SECONDS))
                .as("1 次/周期的配额应在第 2 次请求用尽")
                .isFalse();

        assertThat(rateLimiterRedisDAO.tryAcquire(key, 1, PERIOD_SECONDS, TimeUnit.SECONDS))
                .as("同配置重复调用不得重置已用尽的配额")
                .isFalse();
        assertThat(redissonClient.getRateLimiter("rate_limiter:" + key).getConfig().getRate())
                .isEqualTo(1L);
    }

    /**
     * 验证配置变化时重建限流器：写回新配额并重新按新配额放行。
     *
     * <p>运维把限流从 1 次/分钟调到 5 次/分钟后必须立即生效，否则调大限流还要等一个旧窗口。</p>
     */
    @Test
    @DisplayName("配置变化时重建限流器并按新配额放行")
    void shouldRebuildRateLimiterWhenConfigurationChanged() {
        String key = nextKey("rate-change");
        int raisedCount = 5;

        assertThat(rateLimiterRedisDAO.tryAcquire(key, 1, PERIOD_SECONDS, TimeUnit.SECONDS)).isTrue();
        assertThat(rateLimiterRedisDAO.tryAcquire(key, 1, PERIOD_SECONDS, TimeUnit.SECONDS)).isFalse();

        // 第一次按新配置调用即完成重建，并消耗掉新配额中的 1 次。
        assertThat(rateLimiterRedisDAO.tryAcquire(key, raisedCount, PERIOD_SECONDS, TimeUnit.SECONDS))
                .as("配置放大后请求应重新被放行")
                .isTrue();
        assertThat(redissonClient.getRateLimiter("rate_limiter:" + key).getConfig().getRate())
                .isEqualTo((long) raisedCount);

        for (int index = 0; index < raisedCount - 1; index++) {
            assertThat(rateLimiterRedisDAO.tryAcquire(key, raisedCount, PERIOD_SECONDS, TimeUnit.SECONDS))
                    .as("新配额剩余的 %s 次请求应放行", raisedCount - 1 - index)
                    .isTrue();
        }
        assertThat(rateLimiterRedisDAO.tryAcquire(key, raisedCount, PERIOD_SECONDS, TimeUnit.SECONDS))
                .as("新配额用尽后必须再次拒绝")
                .isFalse();
    }

    /**
     * 固定记录“未创建过的限流器也能读到非空配置对象”这一事实。
     *
     * <p>实现按 {@code getConfig() == null} 判断“这是第一次用到该 Key”，并用只写一次的
     * {@code trySetRate} 建立配置。但 Redisson 3.52.0 对不存在的 Key 也返回一个非空的
     * {@link org.redisson.api.RateLimiterConfig}，其中速率被填成 {@code 0}，这个判断因此永远不成立：
     * 每个新 Key 实际都走“配置不同则重建”分支的 {@code setRate}，首次初始化分支无法被触达。
     *
     * <p>功能上没有偏差（速率与间隔仍会被正确写入），但“只写一次”的原子创建语义丢失了，
     * 并发场景下别的节点刚调整过的配置会被这里的 {@code setRate} 覆盖。该前提一旦被修正，
     * 本用例会立即失败并提示同步更新。</p>
     */
    @Test
    @DisplayName("未创建过的限流器也返回非空配置对象，速率被填成 0")
    void shouldReturnNonNullConfigWithZeroRateForNotYetCreatedRateLimiter() {
        String key = nextKey("rate-not-created");

        org.redisson.api.RateLimiterConfig config =
                redissonClient.getRateLimiter("rate_limiter:" + key).getConfig();

        assertThat(config)
                .as("Redisson 对未创建的限流器也返回非空配置对象")
                .isNotNull();
        assertThat(config.getRate())
                .as("该配置对象里没有任何已落盘的速率，被填成了 0")
                .isZero();
    }

    /**
     * 验证限流器相关 Key 都带上了过期时间，不会长期残留在 Redis 里。
     *
     * <p>实现显式设置了过期时间来避免残留，因此这里不只要看配置哈希，还要求令牌与许可 Key 同样有 TTL；
     * 只给配置设过期而令牌永不过期，Key 数量会随业务 Key 无限增长。</p>
     */    @Test
    @DisplayName("限流器相关 Key 都带过期时间，不会长期残留")
    void shouldExpireRateLimiterKeysToAvoidResidue() {
        String key = nextKey("rate-ttl");

        assertThat(rateLimiterRedisDAO.tryAcquire(key, COUNT, PERIOD_SECONDS, TimeUnit.SECONDS)).isTrue();

        Set<String> limiterKeys = new LinkedHashSet<>();
        for (String candidate : scanOwnedKeys()) {
            if (candidate.contains(key)) {
                limiterKeys.add(candidate);
            }
        }
        assertThat(limiterKeys)
                .as("限流器至少应产生配置 Key 与令牌 Key，实际: %s", limiterKeys)
                .hasSizeGreaterThanOrEqualTo(2);
        for (String limiterKey : limiterKeys) {
            assertThat(stringRedisTemplate.getExpire(limiterKey, TimeUnit.SECONDS))
                    .as("Key %s 缺少过期时间，会长期残留", limiterKey)
                    .isBetween(1L, (long) PERIOD_SECONDS);
        }
    }
}
