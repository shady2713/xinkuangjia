package com.basicframework.framework.ratelimiter.core.redis;

import com.basicframework.framework.protection.support.ProtectionRedisTestSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.redisson.api.RRateLimiter;
import org.redisson.api.RateType;
import org.redisson.api.RedissonClient;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.BrokenBarrierException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

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

    /** 冷 Key 初始化竞争的并发请求数，取大于 2 以覆盖多个请求同时读到“未初始化配置”的交错。 */
    private static final int CONCURRENT_REQUESTS = 16;

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
     * 验证冷 Key 的并发初始化只建立一次配置，并发请求合计只放行 {@code count} 次。
     *
     * <p>冷 Key 的初始化竞争是限流最容易失效的路径：Redisson 对未创建的限流器也返回非空配置
     * （速率被填成 0），若实现按“配置对象为空”判断首次初始化，所有并发请求都会走
     * {@code setRate} 重建分支。Redisson 的 {@code setRate} Lua 会删除消费记录
     * （{@code del valueName permitsName}），于是后一次初始化把前一次已经用掉的配额清空，
     * {@code count=1} 也能放行多次。这里用屏障把 {@value #CONCURRENT_REQUESTS} 个请求同时压到同一个
     * 冷 Key 上，断言成功次数恰好等于配额；只有原子创建（{@code trySetRate}）加上“已存在只比较不重建”
     * 才能同时满足“不重复放行”和“配置变化仍可重建”。</p>
     *
     * @throws Exception 线程等待超时或任务执行失败时抛出，避免把并发故障当成通过
     */
    @Test
    @DisplayName("冷 Key 并发初始化只建立一次配置，合计放行次数等于配额")
    void shouldGrantPermitsOnceWhenColdKeyIsInitializedConcurrently() throws Exception {
        String key = nextKey("rate-cold-concurrent");
        int count = 1;
        CountDownLatch ready = new CountDownLatch(CONCURRENT_REQUESTS);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(CONCURRENT_REQUESTS);
        try {
            List<Future<Boolean>> results = new ArrayList<>();
            for (int index = 0; index < CONCURRENT_REQUESTS; index++) {
                results.add(pool.submit(() -> {
                    ready.countDown();
                    start.await();
                    return rateLimiterRedisDAO.tryAcquire(key, count, PERIOD_SECONDS, TimeUnit.SECONDS);
                }));
            }
            assertThat(ready.await(30, TimeUnit.SECONDS)).as("并发请求必须全部就绪").isTrue();
            start.countDown();

            long granted = 0;
            for (Future<Boolean> result : results) {
                if (result.get(30, TimeUnit.SECONDS)) {
                    granted++;
                }
            }
            assertThat(granted)
                    .as("count=%s 的冷 Key 在并发初始化下合计只能放行 %s 次", count, count)
                    .isEqualTo(count);
        } finally {
            pool.shutdownNow();
        }

        // 竞争结束后配置必须是本次声明的配额，且后续请求继续被拒绝，证明配额没有被重建放大。
        RRateLimiter limiter = redissonClient.getRateLimiter("rate_limiter:" + key);
        assertThat(limiter.getConfig().getRate()).isEqualTo((long) count);
        assertThat(limiter.getConfig().getRateInterval()).isEqualTo(TimeUnit.SECONDS.toMillis(PERIOD_SECONDS));
        assertThat(rateLimiterRedisDAO.tryAcquire(key, count, PERIOD_SECONDS, TimeUnit.SECONDS))
                .as("并发初始化不得留下额外配额")
                .isFalse();
    }

    /**
     * 验证两个并发请求都读到“未初始化配置”并各自重建速率时，合计仍然只放行一次。
     *
     * <p>Redisson 对未创建的限流器返回非空且速率为 0 的配置，因此“配置对象为空”不能作为首次初始化的
     * 判据。这里给真实限流器套一层同步代理，让两个请求严格按“读到同一份未初始化配置 → 第一个请求
     * 初始化并消费配额 → 第二个请求再重建速率并再次消费”的顺序执行：修复前两个请求都会走
     * {@code setRate} 重建分支，而 Redisson 的 {@code setRate} Lua 会删除消费记录
     * （{@code del valueName permitsName}），后一次重建清空前一次已用配额，count=1 因此放行两次；
     * 只有原子创建（{@code trySetRate}）加上“已存在只比较不重建”才会只放行一次、且完全不重建。</p>
     *
     * <p>同步代理只改变配置读写与速率重建的先后顺序，速率、配额与消费记录仍由真实 Redisson 与服务端
     * 计算，断言依据也是服务端真实放行次数与真实重建次数。</p>
     *
     * @throws Exception 线程等待超时或任务执行失败时抛出，避免把并发故障当成通过
     */
    @Test
    @DisplayName("两个并发请求同时读到未初始化配置并重建速率时合计只放行一次，且不重建速率")
    void shouldGrantOnceWhenBothColdRequestsReadUninitializedConfig() throws Exception {
        String key = nextKey("rate-cold-interleaved");
        String redisKey = "rate_limiter:" + key;
        InitializationRaceHandler raceHandler = new InitializationRaceHandler(
                redissonClient.getRateLimiter(redisKey));
        RRateLimiter pausedLimiter = (RRateLimiter) Proxy.newProxyInstance(RRateLimiter.class.getClassLoader(),
                new Class<?>[] {RRateLimiter.class}, raceHandler);
        RedissonClient client = mock(RedissonClient.class);
        when(client.getRateLimiter(redisKey)).thenReturn(pausedLimiter);
        RateLimiterRedisDAO dao = new RateLimiterRedisDAO(client);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            List<Future<Boolean>> results = new ArrayList<>();
            for (int index = 0; index < 2; index++) {
                results.add(pool.submit(() -> {
                    start.await();
                    return dao.tryAcquire(key, 1, PERIOD_SECONDS, TimeUnit.SECONDS);
                }));
            }
            start.countDown();

            long granted = 0;
            for (Future<Boolean> result : results) {
                if (result.get(30, TimeUnit.SECONDS)) {
                    granted++;
                }
            }
            assertThat(granted)
                    .as("两个请求都读到未初始化配置时，count=1 的配额合计只能放行 1 次")
                    .isEqualTo(1);
            assertThat(raceHandler.rebuiltRateCount.get())
                    .as("冷 Key 必须走原子初始化；任何一次重建都会删除已用配额")
                    .isZero();
        } finally {
            pool.shutdownNow();
        }
    }

    /**
     * 冷 Key 初始化竞争的同步代理：精确构造“两次 setRate 重建之间夹着一次已用配额”的顺序。
     *
     * <p>第一次 {@code getConfig} 用屏障保证两个请求读到同一份未初始化配置；第二次及以后的
     * {@code setRate} 重建让后到的请求等到先到请求已经消费完配额，从而稳定复现
     * “后一次初始化清除前一次已用配额、count=1 放行两次”。</p>
     *
     * <p>修复后的实现以 {@code trySetRate} 原子创建，配置存在且一致时不再重建；此时屏障只会等到单边
     * 请求，等待超时即继续，且重建计数保持为零。</p>
     */
    private static final class InitializationRaceHandler implements InvocationHandler {

        /** 两个并发请求都读取配置后释放的屏障。 */
        private final CyclicBarrier bothRequestsReadConfig = new CyclicBarrier(2);

        /** 先到请求完成一次真实配额消费后释放的信号。 */
        private final CountDownLatch firstRequestConsumedPermit = new CountDownLatch(1);

        /** 真实 Redisson 限流器，除顺序外不做任何替换。 */
        private final RRateLimiter real;

        /** 实际发生的速率重建次数，用于断言实现走的是原子初始化。 */
        private final AtomicInteger rebuiltRateCount = new AtomicInteger();

        /**
         * 绑定真实限流器。
         *
         * @param real 真实 Redisson 限流器
         */
        private InitializationRaceHandler(RRateLimiter real) {
            this.real = real;
        }

        /**
         * 按被调用方法调整配置读取与速率重建的先后顺序后委托真实限流器。
         *
         * @param proxy 代理对象
         * @param method 被调用的接口方法
         * @param args 调用参数
         * @return 真实限流器的返回值
         * @throws Throwable 真实调用抛出的异常原样传播
         */
        @Override
        public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
            if ("getConfig".equals(method.getName())) {
                awaitBothRequests(bothRequestsReadConfig);
            }
            if ("setRate".equals(method.getName()) && rebuiltRateCount.incrementAndGet() > 1) {
                // 第二个重建请求必须等先到请求真的消费掉配额，才能稳定复现“重建清空已用配额”。
                if (!firstRequestConsumedPermit.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("先到的限流请求未在超时内消费配额");
                }
            }
            try {
                Object result = method.invoke(real, args);
                if ("tryAcquire".equals(method.getName()) && rebuiltRateCount.get() > 0) {
                    firstRequestConsumedPermit.countDown();
                }
                return result;
            } catch (InvocationTargetException exception) {
                throw exception.getCause();
            }
        }
    }

    /**
     * 等待另一个并发请求到达同一屏障；单边到达时按超时继续，避免把修复后的正常路径挂死。
     *
     * <p>修复后的实现只在原子创建失败时读取配置，因此屏障可能只被单个请求到达；修复前两个请求都会
     * 到达，屏障立即释放，从而稳定复现初始化竞争的交错。</p>
     *
     * @param barrier 两个请求共用的屏障
     * @throws InterruptedException 线程被中断时抛出，保证中断不被吞掉
     */
    private static void awaitBothRequests(CyclicBarrier barrier) throws InterruptedException {
        try {
            barrier.await(2, TimeUnit.SECONDS);
        } catch (TimeoutException | BrokenBarrierException ignored) {
            // 单边到达：初始化已经是原子的，继续发起真实调用。
        }
    }
    /**
     * 验证限流器相关 Key 都带上了过期时间，不会长期残留在 Redis 里。
     *
     * <p>实现显式设置了过期时间来避免残留，因此这里不只要看配置哈希，还要求令牌与许可 Key 同样有 TTL；
     * 只给配置设过期而令牌永不过期，Key 数量会随业务 Key 无限增长。</p>
     */
    @Test
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
