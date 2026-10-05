package com.basicframework.framework.ratelimiter.core.redis;

import com.basicframework.framework.protection.support.ProtectionRedisTestSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.redisson.api.RLock;
import org.redisson.api.RRateLimiter;
import org.redisson.api.RateType;
import org.redisson.api.RedissonClient;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.time.Duration;
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
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
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

    /** 动态改参前使用的旧配额，取大于 1 以便先耗尽旧窗口，使放行只可能来自重建。 */
    private static final int CHANGED_FROM_COUNT = 2;

    /**
     * 等待重建锁租约真实到期的上限（秒）
     *
     * 被测实现的固定租约是 10 秒，这里只作为轮询上限：用例断言的是“锁 Key 真的消失了”，
     * 而不是“睡了固定时长”，租约取值变化时用例仍能给出准确结论。
     */
    private static final long LOCK_EXPIRE_WAIT_SECONDS = 30;

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
     * 验证两个并发请求都读到“旧配置”并各自重建速率时，新配额只放行一次且只重建一次。
     *
     * <p>动态改参是限流的第二个初始化竞争点：限流器已存在，{@code trySetRate} 对两个请求都必然失败，
     * 于是它们都读到同一份旧配置、都判定“配置变了”。修复前两个请求各自调用 {@code setRate}，而
     * Redisson 3.52.0 的 {@code setRate} Lua 以 {@code del valueName permitsName} 结尾，会清空
     * 前一次重建后已经消费掉的令牌，{@code count=1} 也能放行多次——调小限流反而多放行，是安全缺口。</p>
     *
     * <p>这里先用旧配额把真实窗口耗尽，再用同步代理让两个请求严格按“都读到旧配置 → 先到者重建并消费
     * 新配额 → 后到者才重建”的顺序执行，断言服务端真实放行次数恰好等于新配额、重建次数恰好为 1。
     * 同步代理只改变配置读写与速率重建的先后顺序，令牌计算仍由真实 Redisson 与服务端完成。</p>
     *
     * @throws Exception 线程等待超时或任务执行失败时抛出，避免把并发故障当成通过
     */
    @Test
    @DisplayName("并发改参只重建一次速率，count=1 时合计只放行一次")
    void shouldGrantOnceWhenConcurrentRequestsRebuildChangedRate() throws Exception {
        String key = nextKey("rate-change-concurrent");
        String redisKey = "rate_limiter:" + key;
        int newCount = 1;
        // 1. 用旧参数建立真实限流器并耗尽旧窗口，此后只有“重建”才可能再次放行
        RRateLimiter realLimiter = redissonClient.getRateLimiter(redisKey);
        assertThat(realLimiter.trySetRate(RateType.OVERALL, CHANGED_FROM_COUNT, Duration.ofSeconds(PERIOD_SECONDS)))
                .as("旧配置必须由本用例真实建立")
                .isTrue();
        realLimiter.expire(Duration.ofSeconds(PERIOD_SECONDS));
        for (int index = 0; index < CHANGED_FROM_COUNT; index++) {
            assertThat(realLimiter.tryAcquire()).as("旧配额第 %s 次应放行", index + 1).isTrue();
        }
        assertThat(realLimiter.tryAcquire())
                .as("旧配额必须已经耗尽，否则无法证明放行只来自重建")
                .isFalse();

        // 2. 两个并发请求同时按新参数调用，用同步代理稳定复现“后一次重建清空前一次已用配额”
        ChangeRaceHandler raceHandler = new ChangeRaceHandler(realLimiter);
        RRateLimiter racingLimiter = (RRateLimiter) Proxy.newProxyInstance(RRateLimiter.class.getClassLoader(),
                new Class<?>[] {RRateLimiter.class}, raceHandler);
        RedissonClient client = mock(RedissonClient.class);
        when(client.getRateLimiter(redisKey)).thenReturn(racingLimiter);
        when(client.getLock(anyString())).thenAnswer(invocation -> redissonClient.getLock((String) invocation.getArgument(0)));
        RateLimiterRedisDAO dao = new RateLimiterRedisDAO(client);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            List<Future<Boolean>> results = new ArrayList<>();
            for (int index = 0; index < 2; index++) {
                results.add(pool.submit(() -> {
                    start.await();
                    return dao.tryAcquire(key, newCount, PERIOD_SECONDS, TimeUnit.SECONDS);
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
                    .as("两个请求都读到旧配置时，改参后 count=%s 的新窗口合计只能放行 %s 次", newCount, newCount)
                    .isEqualTo(newCount);
            assertThat(raceHandler.rebuiltRateCount.get())
                    .as("并发改参只允许重建一次；每次重复重建都会清空已消费的令牌")
                    .isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }

        // 3. 服务端配置必须是新参数，且新配额已被并发请求用尽，不留额外配额
        assertThat(realLimiter.getConfig().getRate()).isEqualTo((long) newCount);
        assertThat(realLimiter.getConfig().getRateInterval()).isEqualTo(TimeUnit.SECONDS.toMillis(PERIOD_SECONDS));
        assertThat(realLimiter.tryAcquire())
                .as("并发改参不得留下额外配额")
                .isFalse();
    }

    /**
     * 验证重建锁租约到期、旧持有者仍继续写入时，不得重置后继请求已经消耗掉的额度。
     *
     * <p>重建锁用固定租约（不使用看门狗续期）：持有者若在临界区内被长时间挂起，锁会在租约到期后由 Redis
     * 自动删除，后继请求随即可以进入同一临界区。此时两者都持有“重建前”的配置判断，若旧持有者醒来后照样
     * 调用 {@code setRate}，Redisson 的重建 Lua 会再次删除消费记录，把后继请求已经消耗掉的令牌凭空还回来，
     * {@code count=1} 也会放行两次——这正是“锁租约失效后旧持有者继续写入”的真实缺陷。</p>
     *
     * <p>本用例不靠并发碰运气，而是用门闩固定交错：旧持有者在锁内读完旧配置后挂起 → 断言此刻锁 Key 真实
     * 存在 → 轮询等 Redis 按 TTL 真正删除锁 Key（真实租约到期，不是替身模拟）→ 后继请求取锁、重建并消耗
     * 新配额 → 放行旧持有者继续执行。因此放行次数与重建次数都只可能来自“旧持有者是否在租约失效后写了
     * 一次”，普通并发用例无法区分这两种结果。</p>
     *
     * @throws Exception 线程等待超时或任务执行失败时抛出，避免把并发故障当成通过
     */
    @Test
    @DisplayName("重建锁租约到期后旧持有者继续写入，不得重置后继请求已消耗的额度")
    void shouldNotResetConsumedQuotaWhenStaleHolderOutlivesRebuildLockLease() throws Exception {
        String key = nextKey("rate-lease-expired");
        String redisKey = "rate_limiter:" + key;
        String rebuildLockKey = redisKey + ":rebuild";
        int newCount = 1;

        // 1. 先用旧配额建立真实限流器并耗尽旧窗口，此后任何一次放行都只可能来自“重建清空了已消费的令牌”
        RRateLimiter realLimiter = redissonClient.getRateLimiter(redisKey);
        assertThat(realLimiter.trySetRate(RateType.OVERALL, CHANGED_FROM_COUNT, Duration.ofSeconds(PERIOD_SECONDS)))
                .as("旧配置必须由本用例真实建立")
                .isTrue();
        realLimiter.expire(Duration.ofSeconds(PERIOD_SECONDS));
        for (int index = 0; index < CHANGED_FROM_COUNT; index++) {
            assertThat(realLimiter.tryAcquire()).as("旧配额第 %s 次应放行", index + 1).isTrue();
        }
        assertThat(realLimiter.tryAcquire()).as("旧配额必须已经耗尽，否则无法证明放行只来自重建").isFalse();

        // 2. 旧持有者读到旧配置后在锁内挂起，挂起期间等待真实租约到期
        StaleHolderHandler handler = new StaleHolderHandler(realLimiter, redissonClient.getLock(rebuildLockKey));
        RRateLimiter staleLimiter = (RRateLimiter) Proxy.newProxyInstance(RRateLimiter.class.getClassLoader(),
                new Class<?>[] {RRateLimiter.class}, handler);
        RedissonClient client = mock(RedissonClient.class);
        when(client.getRateLimiter(redisKey)).thenReturn(staleLimiter);
        when(client.getLock(anyString())).thenAnswer(invocation -> redissonClient.getLock((String) invocation.getArgument(0)));
        RateLimiterRedisDAO dao = new RateLimiterRedisDAO(client);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            Future<Boolean> staleHolderResult = pool.submit(() -> {
                handler.staleHolder.set(Thread.currentThread());
                return dao.tryAcquire(key, newCount, PERIOD_SECONDS, TimeUnit.SECONDS);
            });

            assertThat(handler.enteredRebuildSection.await(30, TimeUnit.SECONDS))
                    .as("旧持有者必须进入重建临界区并挂起")
                    .isTrue();
            assertThat(redissonClient.getKeys().countExists(rebuildLockKey))
                    .as("旧持有者挂起时重建锁必须真实存在，否则不构成租约失效场景")
                    .isEqualTo(1);

            // 3. 轮询到 Redis 按 TTL 真正删除锁 Key：租约失效是真实发生的，而不是被替身模拟出来的
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(LOCK_EXPIRE_WAIT_SECONDS);
            while (System.nanoTime() < deadline && redissonClient.getKeys().countExists(rebuildLockKey) > 0) {
                Thread.sleep(50);
            }
            assertThat(redissonClient.getKeys().countExists(rebuildLockKey))
                    .as("锁必须在租约到期后由 Redis 释放，后继请求才能在旧持有者仍挂起时进入临界区")
                    .isZero();

            // 4. 后继请求取得已失效的锁，按同一份新参数重建并消耗掉新配额
            assertThat(dao.tryAcquire(key, newCount, PERIOD_SECONDS, TimeUnit.SECONDS))
                    .as("后继请求应在锁释放后完成重建并消耗掉新配额中的 1 次")
                    .isTrue();

            // 5. 放行旧持有者：它手上是“重建前”的配置，若不做租约内持有者校验就会再重建一次
            handler.releaseStaleHolder.countDown();
            assertThat(staleHolderResult.get(30, TimeUnit.SECONDS))
                    .as("新配额已被后继请求用尽，旧持有者醒来后必须继续被拒绝")
                    .isFalse();
        } finally {
            handler.releaseStaleHolder.countDown();
            pool.shutdownNow();
        }

        assertThat(handler.rebuiltRateCount.get())
                .as("同一份新参数只允许重建一次，旧持有者不得在租约失效后再次重建")
                .isEqualTo(1);
        assertThat(realLimiter.getConfig().getRate()).isEqualTo((long) newCount);
        assertThat(realLimiter.tryAcquire())
                .as("旧持有者不得把后继请求已消耗的额度还回来")
                .isFalse();
    }

    /**
     * 验证并发改参期间的真实流量合计放行次数恰好等于新配额，改参完成后窗口继续按新配额拒绝。
     *
     * <p>与同步代理用例互补：这里不注入任何顺序控制，用屏障把 {@value #CONCURRENT_REQUESTS} 个请求同时压到
     * 一个已存在旧配置的 Key 上，全部声明同一份新参数。修复前每个请求都会独立重建一次速率，重建次数不受
     * 约束；修复后重建被串行化且只发生一次，因此服务端真实放行次数必须恰好等于新配额，多一次都说明
     * 有重建清空了已消费的令牌。</p>
     *
     * @throws Exception 线程等待超时或任务执行失败时抛出，避免把并发故障当成通过
     */
    @Test
    @DisplayName("并发改参期间合计放行次数恰好等于新配额")
    void shouldGrantExactlyNewCountWhileRateIsChangedConcurrently() throws Exception {
        String key = nextKey("rate-change-storm");
        String redisKey = "rate_limiter:" + key;
        int newCount = 3;
        RRateLimiter realLimiter = redissonClient.getRateLimiter(redisKey);
        assertThat(realLimiter.trySetRate(RateType.OVERALL, CHANGED_FROM_COUNT, Duration.ofSeconds(PERIOD_SECONDS)))
                .as("旧配置必须由本用例真实建立")
                .isTrue();
        realLimiter.expire(Duration.ofSeconds(PERIOD_SECONDS));
        for (int index = 0; index < CHANGED_FROM_COUNT; index++) {
            assertThat(realLimiter.tryAcquire()).isTrue();
        }
        assertThat(realLimiter.tryAcquire()).as("旧配额必须已经耗尽").isFalse();

        CountDownLatch ready = new CountDownLatch(CONCURRENT_REQUESTS);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(CONCURRENT_REQUESTS);
        try {
            List<Future<Boolean>> results = new ArrayList<>();
            for (int index = 0; index < CONCURRENT_REQUESTS; index++) {
                results.add(pool.submit(() -> {
                    ready.countDown();
                    start.await();
                    return rateLimiterRedisDAO.tryAcquire(key, newCount, PERIOD_SECONDS, TimeUnit.SECONDS);
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
                    .as("改参期间合计放行次数必须恰好等于新配额 %s", newCount)
                    .isEqualTo(newCount);
        } finally {
            pool.shutdownNow();
        }

        assertThat(realLimiter.getConfig().getRate()).isEqualTo((long) newCount);
        assertThat(rateLimiterRedisDAO.tryAcquire(key, newCount, PERIOD_SECONDS, TimeUnit.SECONDS))
                .as("改参结束后新配额应已用尽，必须继续拒绝")
                .isFalse();
    }

    /**
     * 验证改回原参数时同样按新窗口重建，且不会因为“参数值曾经出现过”而复用旧窗口。
     *
     * <p>运维回滚限流参数与首次改参一样必须立即生效：若实现用历史参数值判断“无需重建”，回滚后仍会
     * 沿用改大后的窗口，限流长时间失效。这里按 1 → 3 → 1 连续改参，逐段断言放行次数与落盘配置。</p>
     */
    @Test
    @DisplayName("改回原参数时按新窗口重建，不复用历史窗口")
    void shouldRebuildWhenRateIsRestoredToPreviousValue() {
        String key = nextKey("rate-restore");
        int raisedCount = 3;

        assertThat(rateLimiterRedisDAO.tryAcquire(key, 1, PERIOD_SECONDS, TimeUnit.SECONDS)).isTrue();
        assertThat(rateLimiterRedisDAO.tryAcquire(key, 1, PERIOD_SECONDS, TimeUnit.SECONDS))
                .as("1 次/周期的配额应已用尽")
                .isFalse();

        // 放大到 3 次：第一次调用完成重建并消费 1 次，剩余 2 次放行后再次拒绝
        assertThat(rateLimiterRedisDAO.tryAcquire(key, raisedCount, PERIOD_SECONDS, TimeUnit.SECONDS)).isTrue();
        for (int index = 0; index < raisedCount - 1; index++) {
            assertThat(rateLimiterRedisDAO.tryAcquire(key, raisedCount, PERIOD_SECONDS, TimeUnit.SECONDS))
                    .as("放大后剩余 %s 次应放行", raisedCount - 1 - index)
                    .isTrue();
        }
        assertThat(rateLimiterRedisDAO.tryAcquire(key, raisedCount, PERIOD_SECONDS, TimeUnit.SECONDS))
                .as("放大后的配额应已用尽")
                .isFalse();

        // 回滚到 1 次：必须重新按 1 次建立窗口，而不是复用最初那个已经用尽的窗口
        assertThat(rateLimiterRedisDAO.tryAcquire(key, 1, PERIOD_SECONDS, TimeUnit.SECONDS))
                .as("回滚到更小配额后应重新建立窗口并放行 1 次")
                .isTrue();
        assertThat(redissonClient.getRateLimiter("rate_limiter:" + key).getConfig().getRate())
                .as("落盘配置必须回滚为 1")
                .isEqualTo(1L);
        assertThat(rateLimiterRedisDAO.tryAcquire(key, 1, PERIOD_SECONDS, TimeUnit.SECONDS))
                .as("回滚后的 1 次配额应已用尽")
                .isFalse();
    }

    /**
     * 验证改参只影响被改的那个业务 Key，其它 Key 的配额与落盘配置都不受影响。
     *
     * <p>限流按业务 Key 隔离是注解语义的一部分：重建走的是带业务前缀的独立键，若实现误用共享键或
     * 全局状态，改一个 Key 的限流会把别的 Key 一起重置。</p>
     */
    @Test
    @DisplayName("改参只影响目标 Key，其它 Key 的配额与配置不受影响")
    void shouldKeepOtherKeysUnaffectedWhenRateChanges() {
        String changedKey = nextKey("rate-scope-changed");
        String untouchedKey = nextKey("rate-scope-untouched");

        assertThat(rateLimiterRedisDAO.tryAcquire(changedKey, 1, PERIOD_SECONDS, TimeUnit.SECONDS)).isTrue();
        assertThat(rateLimiterRedisDAO.tryAcquire(untouchedKey, 1, PERIOD_SECONDS, TimeUnit.SECONDS)).isTrue();
        assertThat(rateLimiterRedisDAO.tryAcquire(untouchedKey, 1, PERIOD_SECONDS, TimeUnit.SECONDS))
                .as("另一个 Key 的配额应已用尽")
                .isFalse();

        // 只放大 changedKey，untouchedKey 必须保持“1 次且已用尽”
        assertThat(rateLimiterRedisDAO.tryAcquire(changedKey, 5, PERIOD_SECONDS, TimeUnit.SECONDS)).isTrue();
        assertThat(redissonClient.getRateLimiter("rate_limiter:" + changedKey).getConfig().getRate())
                .isEqualTo(5L);
        assertThat(redissonClient.getRateLimiter("rate_limiter:" + untouchedKey).getConfig().getRate())
                .as("未被改参的 Key 配置不得变化")
                .isEqualTo(1L);
        assertThat(rateLimiterRedisDAO.tryAcquire(untouchedKey, 1, PERIOD_SECONDS, TimeUnit.SECONDS))
                .as("未被改参的 Key 配额不得被重置")
                .isFalse();
        assertThat(rateLimiterRedisDAO.tryAcquire(changedKey, 5, PERIOD_SECONDS, TimeUnit.SECONDS))
                .as("被改参的 Key 应按新配额继续放行")
                .isTrue();
    }

    /**
     * 验证限流器整体过期后按新参数重新初始化，不会把过期前的窗口状态带进新窗口。
     *
     * <p>限流器 Key 带 TTL 是为了不长期残留，但过期后重新初始化必须是一张白纸：新窗口可用次数等于
     * 新声明的配额，且不再受过期前“已用尽”的影响。这里用 1 秒周期真实等待配置、令牌与许可 Key 全部
     * 过期（三者 TTL 相同，逐个等待可避免残留 Key 让新窗口沿用旧计数）。</p>
     *
     * @throws Exception 等待过期被中断时抛出，避免把中断当成过期成功
     */
    @Test
    @DisplayName("限流器过期后按新参数重新初始化，不残留旧窗口")
    void shouldReinitializeWithNewRateAfterRateLimiterExpired() throws Exception {
        String key = nextKey("rate-expire");
        int shortPeriodSeconds = 1;

        assertThat(rateLimiterRedisDAO.tryAcquire(key, 1, shortPeriodSeconds, TimeUnit.SECONDS)).isTrue();
        assertThat(rateLimiterRedisDAO.tryAcquire(key, 1, shortPeriodSeconds, TimeUnit.SECONDS))
                .as("1 次/1 秒的配额应在周期内用尽")
                .isFalse();

        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        while (System.nanoTime() < deadline && !scanOwnedKeysMatching(key).isEmpty()) {
            Thread.sleep(50);
        }
        assertThat(scanOwnedKeysMatching(key))
                .as("限流器相关 Key 应在周期结束后全部过期，实际残留: %s", scanOwnedKeysMatching(key))
                .isEmpty();

        int newCount = 2;
        for (int index = 0; index < newCount; index++) {
            assertThat(rateLimiterRedisDAO.tryAcquire(key, newCount, PERIOD_SECONDS, TimeUnit.SECONDS))
                    .as("过期后重建的新窗口第 %s 次应放行", index + 1)
                    .isTrue();
        }
        assertThat(rateLimiterRedisDAO.tryAcquire(key, newCount, PERIOD_SECONDS, TimeUnit.SECONDS))
                .as("新窗口的 %s 次配额用尽后必须拒绝", newCount)
                .isFalse();
        assertThat(redissonClient.getRateLimiter("rate_limiter:" + key).getConfig().getRate())
                .as("过期后必须按新参数重新初始化")
                .isEqualTo((long) newCount);
    }

    /**
     * 按业务 Key 过滤本类独占前缀下已存在的 Redis Key，用于观察限流器的过期与残留。
     *
     * @param key 业务 Key
     * @return 命中该业务 Key 的 Redis Key 集合，可能为空
     */
    private static Set<String> scanOwnedKeysMatching(String key) {
        Set<String> matched = new LinkedHashSet<>();
        for (String candidate : scanOwnedKeys()) {
            if (candidate.contains(key)) {
                matched.add(candidate);
            }
        }
        return matched;
    }

    /**
     * 动态改参竞争的同步代理：精确构造“两个请求读到同一份旧配置，后一次重建夹在先到者已消费之后”。
     *
     * <p>前两次 {@code getConfig} 用屏障保证两个请求读到同一份旧配置；第二次及以后的 {@code setRate}
     * 重建让后到请求等到先到请求已经消费完新配额，从而稳定复现“后一次重建清除前一次已用配额、
     * count=1 放行两次”。修复后的实现只在慢路径的锁内做二次比较，因此重建只发生一次、屏障单边到达时
     * 按超时继续，不会把正常路径挂死。</p>
     */
    private static final class ChangeRaceHandler implements InvocationHandler {

        /** 两个并发请求都读取旧配置后释放的屏障。 */
        private final CyclicBarrier bothRequestsReadConfig = new CyclicBarrier(2);

        /** 先到请求完成一次真实配额消费后释放的信号。 */
        private final CountDownLatch firstRequestConsumedPermit = new CountDownLatch(1);

        /** 真实 Redisson 限流器，除顺序外不做任何替换。 */
        private final RRateLimiter real;

        /** 配置读取次数，用于只对两个请求的首次读取施加屏障。 */
        private final AtomicInteger configReadCount = new AtomicInteger();

        /** 实际发生的速率重建次数，用于断言并发改参只重建一次。 */
        private final AtomicInteger rebuiltRateCount = new AtomicInteger();

        /**
         * 绑定真实限流器。
         *
         * @param real 真实 Redisson 限流器
         */
        private ChangeRaceHandler(RRateLimiter real) {
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
            if ("getConfig".equals(method.getName()) && configReadCount.incrementAndGet() <= 2) {
                awaitBothRequests(bothRequestsReadConfig);
            }
            if ("setRate".equals(method.getName()) && rebuiltRateCount.incrementAndGet() > 1) {
                // 第二个重建请求必须等先到请求真的消费掉新配额，才能稳定复现“重建清空已用配额”。
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
     * 租约失效场景的同步代理：让旧持有者在锁内读完配置后挂起，直到后继请求完成重建与消费。
     *
     * <p>代理先把真实配置读回来再挂起，使旧持有者手上保留的是“重建前”的判断，醒来后必然继续走重建分支；
     * 只有旧持有者线程会被挂起，后继请求不受影响。令牌计算、锁租约与放行判定仍由真实 Redisson 与 Redis
     * 完成，代理只改变配置读取与速率重建之间的先后顺序。</p>
     */
    private static final class StaleHolderHandler implements InvocationHandler {

        /** 旧持有者线程，用于把挂起精确限制在它身上。 */
        private final AtomicReference<Thread> staleHolder = new AtomicReference<>();

        /** 旧持有者已在锁内读完配置的信号。 */
        private final CountDownLatch enteredRebuildSection = new CountDownLatch(1);

        /** 允许旧持有者离开临界区的信号。 */
        private final CountDownLatch releaseStaleHolder = new CountDownLatch(1);

        /** 实际发生的速率重建次数，用于断言租约失效后没有第二次重建。 */
        private final AtomicInteger rebuiltRateCount = new AtomicInteger();

        /** 真实 Redisson 限流器，除顺序外不做任何替换。 */
        private final RRateLimiter real;

        /** 真实 Redisson 重建锁，用于判断当前线程是否正处于重建临界区内。 */
        private final RLock rebuildLock;

        /**
         * 绑定真实限流器与真实重建锁。
         *
         * @param real        真实 Redisson 限流器
         * @param rebuildLock 真实 Redisson 重建锁
         */
        private StaleHolderHandler(RRateLimiter real, RLock rebuildLock) {
            this.real = real;
            this.rebuildLock = rebuildLock;
        }

        /**
         * 统计重建次数，并让旧持有者在锁内读完配置后挂起，其余调用原样委托真实限流器。
         *
         * @param proxy  代理对象
         * @param method 被调用的接口方法
         * @param args   调用参数
         * @return 真实限流器的返回值
         * @throws Throwable 真实调用抛出的异常原样传播
         */
        @Override
        public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
            if ("setRate".equals(method.getName())) {
                rebuiltRateCount.incrementAndGet();
            }
            Object result;
            try {
                result = method.invoke(real, args);
            } catch (InvocationTargetException exception) {
                throw exception.getCause();
            }
            if ("getConfig".equals(method.getName())
                    && Thread.currentThread() == staleHolder.get()
                    && rebuildLock.isHeldByCurrentThread()) {
                // 配置已按“重建前”的值读回，此刻挂起：挂起期间固定租约会真实到期
                enteredRebuildSection.countDown();
                if (!releaseStaleHolder.await(60, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("旧持有者未被放行，租约失效场景无法继续");
                }
            }
            return result;
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
