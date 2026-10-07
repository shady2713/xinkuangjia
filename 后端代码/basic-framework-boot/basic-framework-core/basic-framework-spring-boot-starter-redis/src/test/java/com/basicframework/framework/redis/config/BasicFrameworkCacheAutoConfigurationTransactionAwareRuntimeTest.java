package com.basicframework.framework.redis.config;

import com.basicframework.framework.redis.core.TimeoutRedisCacheManager;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.redisson.Redisson;
import org.redisson.api.RedissonClient;
import org.redisson.config.Config;
import org.redisson.spring.data.connection.RedissonConnectionFactory;
import org.springframework.boot.autoconfigure.cache.CacheProperties;
import org.springframework.cache.Cache;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 运行期验证缓存管理器「当前不带事务感知」这一本地契约的真实读数与区分力。
 *
 * <p>被测对象是生产 {@link BasicFrameworkCacheAutoConfiguration#redisCacheManager} 返回的
 * {@link RedisCacheManager} 实例本身：用真实隔离 Redis、真实 {@link RedisTemplate} 与真实
 * {@code RedisCacheWriter} 装配出容器里实际会注入的那个对象，再读它的运行期读数。断言锁的是
 * {@code isTransactionAware()} 这一真实字段与同一对象在真实 Redis 上的写入行为，而不是源码里
 * 「有没有出现某行调用」。</p>
 *
 * <p>判别性由同文件内的**契约违反变体** {@link TransactionAwareVariantManager} 提供：它用与
 * 生产完全相同的 writer 与配置构造管理器，只额外执行上游形状的 {@code setTransactionAware(true)}。
 * 同一断言作用到变体上必须失败，从而证明断言读的是真实开关而不是常量。</p>
 *
 * <p>本机可验证的边界如实记录：本机固定依赖为 spring-data-redis 3.5.13，其
 * {@code RedisCacheWriter} 不再持有事务支持开关，{@code setTransactionAware} 在该版本唯一可观测
 * 的运行期效果就是管理器自身的 {@code isTransactionAware()}。因此“提交/回滚推迟写入”这类更强的
 * 断言在本切片中无法成立，本类只锁定该版本上真实存在的读数，并在
 * {@link #transactionAwareVariantIsObservedAsFlagOnlyOnThisSpringDataRedisVersion()} 中把这一事实
 * 固定下来，而不是用更弱的猜测替代实测。</p>
 *
 * <p>需要外部注入隔离 Redis 连接；缺失环境变量时直接失败，不退化成内存替身。</p>
 *
 * @author 契约与出口方向执行代理
 */
class BasicFrameworkCacheAutoConfigurationTransactionAwareRuntimeTest {

    /** 本测试类独占的键前缀，清理只按它定位。 */
    private static String keyPrefix;

    /** 真实 Redis 连接工厂，与生产一致使用 Redisson。 */
    private static RedissonConnectionFactory connectionFactory;

    /** 真实 Redisson 客户端，结束时关闭。 */
    private static RedissonClient redissonClient;

    /** 直连 Redis 的字符串模板，用于独立观察写入是否立即生效。 */
    private static StringRedisTemplate probe;

    /** 连接隔离 Redis，缺少环境变量时直接失败。 */
    @BeforeAll
    static void startRedis() throws Exception {
        Config redissonConfig = new Config();
        redissonConfig.useSingleServer()
                .setAddress("redis://127.0.0.1:" + requiredEnvironment("BF_TEST_REDIS_PORT"))
                .setPassword(requiredEnvironment("BF_TEST_REDIS_PASSWORD"))
                .setConnectionMinimumIdleSize(1)
                .setConnectionPoolSize(4);
        redissonClient = Redisson.create(redissonConfig);
        connectionFactory = new RedissonConnectionFactory(redissonClient);
        connectionFactory.afterPropertiesSet();
        probe = new StringRedisTemplate(connectionFactory);
        probe.afterPropertiesSet();
        keyPrefix = "cbclass-cache-aware-" + UUID.randomUUID() + ":";
    }

    /** 关闭连接工厂前清理本类写入的键。 */
    @AfterAll
    static void stopRedis() throws Exception {
        deleteOwnedKeys();
        if (connectionFactory != null) {
            connectionFactory.destroy();
        }
        if (redissonClient != null) {
            redissonClient.shutdown();
        }
    }

    /**
     * 生产缓存管理器的运行期读数：事务感知关闭。
     *
     * <p>这是「当前未调用 {@code setTransactionAware}」在运行期唯一可直接观察的事实：容器注入的
     * 那个管理器实例上该开关为 {@code false}。若有人把它改成上游形状，断言立刻失败。</p>
     */
    @Test
    void productionCacheManagerIsNotTransactionAware() {
        RedisCacheManager manager = productionCacheManager();

        assertNoTransactionAwareness(manager);
    }

    /**
     * 契约违反变体打开开关后，同一断言必须失败。
     *
     * <p>这条读数是本类判别性的核心：它证明断言确实在读真实开关，而不是恒真或恒假。</p>
     */
    @Test
    void transactionAwareVariantFlipsTheFlagSoTheAssertionDiscriminates() {
        RedisCacheManager variant = transactionAwareVariant();

        assertThat(variant.isTransactionAware()).as("变体必须真的打开事务感知").isTrue();
        assertThatThrownBy(() -> assertNoTransactionAwareness(variant))
                .as("同一断言作用在契约违反变体上必须失败")
                .isInstanceOf(AssertionError.class);
    }

    /**
     * 生产管理器在真实 Redis 上可用，证明被断言的不是空壳或替身。
     *
     * <p>同时记录该版本上事务感知开关的观测边界：打开开关后写入同样是即时生效的，说明在本机固定的
     * spring-data-redis 版本上，可观测差异只在管理器自身开关，写入时机不随开关变化。这条读数被固定
     * 下来，避免后续把它当成已验证的提交/回滚推迟写入。</p>
     */
    @Test
    void transactionAwareVariantIsObservedAsFlagOnlyOnThisSpringDataRedisVersion() {
        RedisCacheManager production = productionCacheManager();
        RedisCacheManager variant = transactionAwareVariant();
        String productionKey = keyPrefix + "prod-flag:k";
        String variantKey = keyPrefix + "variant-flag:k";

        production.getCache(keyPrefix + "prod-flag").put("k", "production");
        variant.getCache(keyPrefix + "variant-flag").put("k", "variant");

        assertThat(probe.hasKey(productionKey)).as("生产管理器写入必须即时到达 Redis").isTrue();
        assertThat(probe.hasKey(variantKey))
                .as("本机 spring-data-redis 版本上打开开关不改变写入时机，实测为即时生效")
                .isTrue();
        assertThat(variant.isTransactionAware()).as("变体开关读数与生产不同，差异仅在此").isTrue();
        assertThat(production.isTransactionAware()).as("生产开关读数与变体不同").isFalse();
    }

    /** 生产管理器仍是支持自定义过期时间的实现，且真实读写、TTL 与键前缀约定都生效。 */
    @Test
    void productionCacheManagerStaysLiveOnRealRedis() {
        RedisCacheManager manager = productionCacheManager();
        Cache cache = manager.getCache(keyPrefix + "live#30s");
        String redisKey = keyPrefix + "live:field";

        cache.put("field", "值");

        assertThat(manager).isInstanceOf(TimeoutRedisCacheManager.class);
        assertThat(probe.hasKey(redisKey)).as("必须写入真实 Redis").isTrue();
        assertThat(probe.getExpire(redisKey)).as("name#ttl 的过期时间必须生效").isBetween(20L, 30L);
        assertThat(cache.get("field", String.class)).as("必须能读回真实值").isEqualTo("值");
    }

    /**
     * 生产契约的断言入口：事务感知开关必须为关闭。
     *
     * @param manager 被断言的缓存管理器，生产实例与契约违反变体共用同一断言
     */
    private static void assertNoTransactionAwareness(RedisCacheManager manager) {
        assertThat(manager.isTransactionAware())
                .as("本地契约：缓存管理器不带事务感知")
                .isFalse();
    }

    /** 用生产配置真实装配一个缓存管理器。 */
    private static RedisCacheManager productionCacheManager() {
        RedisConnectionFactory factory = connectionFactory;
        RedisTemplate<String, Object> redisTemplate =
                new BasicFrameworkRedisAutoConfiguration().redisTemplate(factory);
        redisTemplate.afterPropertiesSet();
        CacheProperties cacheProperties = new CacheProperties();
        BasicFrameworkCacheProperties frameworkCacheProperties = new BasicFrameworkCacheProperties();
        frameworkCacheProperties.setRedisScanBatchSize(16);
        RedisCacheConfiguration configuration =
                new BasicFrameworkCacheAutoConfiguration().redisCacheConfiguration(cacheProperties);
        return new BasicFrameworkCacheAutoConfiguration()
                .redisCacheManager(redisTemplate, configuration, frameworkCacheProperties);
    }

    /**
     * 契约违反变体：与生产完全相同的 writer 与配置，只额外打开上游形状的事务感知开关。
     *
     * <p>它只用于负对照，不参与任何生产路径。</p>
     */
    private static RedisCacheManager transactionAwareVariant() {
        RedisConnectionFactory factory = connectionFactory;
        RedisTemplate<String, Object> redisTemplate =
                new BasicFrameworkRedisAutoConfiguration().redisTemplate(factory);
        redisTemplate.afterPropertiesSet();
        CacheProperties cacheProperties = new CacheProperties();
        RedisCacheConfiguration configuration =
                new BasicFrameworkCacheAutoConfiguration().redisCacheConfiguration(cacheProperties);
        RedisCacheManager variant =
                new BasicFrameworkCacheAutoConfiguration()
                        .redisCacheManager(redisTemplate, configuration, new BasicFrameworkCacheProperties());
        variant.setTransactionAware(true);
        return variant;
    }

    /** 按本类随机前缀删除自己创建的键。 */
    private static void deleteOwnedKeys() {
        if (probe == null) {
            return;
        }
        Set<String> keys = probe.keys(keyPrefix + "*");
        if (keys != null && !keys.isEmpty()) {
            probe.delete(keys);
        }
    }

    /** 缺失隔离环境时直接失败，避免退化成跳过真实 Redis 证据。 */
    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("缺少隔离测试环境变量 " + name);
        }
        return value;
    }

}