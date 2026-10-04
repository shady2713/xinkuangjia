package com.basicframework.framework.redis.core;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.cache.Cache;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheWriter;
import org.redisson.Redisson;
import org.redisson.api.RedissonClient;
import org.redisson.config.Config;
import org.redisson.spring.data.connection.RedissonConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证带过期时间后缀的缓存管理器在真实 Redis 上的键名与 TTL 契约。
 *
 * <p>缓存名形如 {@code name#ttl}，其中 ttl 的最后一位是时间单位（d/h/m/s，缺省为秒），
 * 并可带 {@code :} 后缀继续拼进最终缓存名。业务注解直接使用该写法，因此三种结果都必须正确：
 * 键名去掉 ttl 段（否则 Redis 里会留下带时间单位的键、缓存无法复用）、TTL 按声明生效
 * （写错会让验证码等短时效数据长期驻留或让热点缓存瞬间失效）、无后缀的缓存沿用默认
 * 配置（不得被误加 TTL）。</p>
 *
 * <p>断言读取真实 Redis 的键是否存在与剩余过期秒数，并在每例后清理本类创建的键；
 * 缺少隔离 Redis 环境变量时直接失败，不退化成内存替身。</p>
 *
 * @author shady2713
 */
class TimeoutRedisCacheManagerTest {

    /** 时间单位换算的允许误差（秒），避免把网络往返与时钟粒度当成契约失败。 */
    private static final long TTL_TOLERANCE_SECONDS = 5L;

    /** 本测试类独占的键前缀，清理只按它定位。 */
    private static String keyPrefix;
    /** 真实 Redis 连接工厂，与生产一致使用 Redisson。 */
    private static RedissonConnectionFactory connectionFactory;
    /** 真实 Redisson 客户端，结束时关闭。 */
    private static RedissonClient redissonClient;
    /** 直连 Redis 的字符串模板，用于独立观察键与 TTL。 */
    private static StringRedisTemplate probe;
    /** 受测的缓存管理器。 */
    private static TimeoutRedisCacheManager cacheManager;

    /** 连接隔离 Redis 并构建受测管理器，缺少环境变量时直接失败。 */
    @BeforeAll
    static void startRedis() throws Exception {
        int port = Integer.parseInt(requiredEnvironment("BF_TEST_REDIS_PORT"));
        Config redissonConfig = new Config();
        redissonConfig.useSingleServer()
                .setAddress("redis://127.0.0.1:" + port)
                .setPassword(requiredEnvironment("BF_TEST_REDIS_PASSWORD"))
                .setConnectionMinimumIdleSize(1)
                .setConnectionPoolSize(4);
        redissonClient = Redisson.create(redissonConfig);
        connectionFactory = new RedissonConnectionFactory(redissonClient);
        connectionFactory.afterPropertiesSet();
        probe = new StringRedisTemplate(connectionFactory);
        probe.afterPropertiesSet();
        assertThat(probe.getConnectionFactory()).as("必须建立真实 Redis 连接").isNotNull();
        keyPrefix = "r8-timeout-cache-" + UUID.randomUUID() + ":";
        cacheManager = new TimeoutRedisCacheManager(
                RedisCacheWriter.nonLockingRedisCacheWriter(connectionFactory),
                RedisCacheConfiguration.defaultCacheConfig());
    }

    /** 删除本类写入的键，避免污染同一隔离实例上的其它任务。 */
    @AfterEach
    void cleanKeys() {
        deleteOwnedKeys();
    }

    /** 关闭连接工厂前再次清理，保证不留下带本类前缀的键。 */
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

    /** 秒级后缀必须从缓存名中移除，TTL 精确到秒。 */
    @Test
    void secondSuffixIsRemovedFromNameAndAppliedToTtl() {
        Cache cache = cacheManager.getCache(keyPrefix + "alpha#10s");

        cache.put("k1", "v1");

        String key = keyPrefix + "alpha::k1";
        assertThat(probe.hasKey(key)).as("缓存名必须去掉 #10s 段，键名为 name::key").isTrue();
        assertThat(probe.getExpire(key)).as("TTL 必须按声明生效").isBetween(10L - TTL_TOLERANCE_SECONDS, 10L);
    }

    /**
     * 分/时/天后缀必须按单位换算，且 {@code :} 之后的内容要保留在缓存名中。
     *
     * <p>ttl 段的 {@code :} 后缀被当作缓存名的组成部分（例如区分业务子域），只有时间部分参与解析。</p>
     */
    @Test
    void minuteHourAndDaySuffixesUseTheirUnitsAndKeepNameSuffix() {
        cacheManager.getCache(keyPrefix + "beta#2m:sub").put("k2", "v2");
        cacheManager.getCache(keyPrefix + "gamma#1h").put("k3", "v3");
        cacheManager.getCache(keyPrefix + "delta#1d").put("k4", "v4");

        assertThat(probe.hasKey(keyPrefix + "beta:sub::k2")).as("ttl 段后面的 :sub 必须留在缓存名里").isTrue();
        assertThat(probe.getExpire(keyPrefix + "beta:sub::k2")).as("分钟单位").isBetween(120L - TTL_TOLERANCE_SECONDS, 120L);
        assertThat(probe.getExpire(keyPrefix + "gamma::k3")).as("小时单位").isBetween(3600L - TTL_TOLERANCE_SECONDS, 3600L);
        assertThat(probe.getExpire(keyPrefix + "delta::k4")).as("天单位").isBetween(86400L - TTL_TOLERANCE_SECONDS, 86400L);
    }

    /** 纯数字后缀缺省按秒解析，与显式 s 后缀等价。 */
    @Test
    void numericSuffixDefaultsToSeconds() {
        cacheManager.getCache(keyPrefix + "epsilon#30").put("k5", "v5");

        assertThat(probe.getExpire(keyPrefix + "epsilon::k5")).isBetween(30L - TTL_TOLERANCE_SECONDS, 30L);
    }

    /** 没有 ttl 段的缓存名必须原样使用，且不附加过期时间。 */
    @Test
    void nameWithoutSuffixKeepsDefaultConfiguration() {
        Cache cache = cacheManager.getCache(keyPrefix + "plain");

        cache.put("k6", "v6");

        String key = keyPrefix + "plain::k6";
        assertThat(probe.hasKey(key)).as("无后缀缓存名必须原样保留").isTrue();
        assertThat(probe.getExpire(key)).as("未声明 TTL 时不得自动加过期时间").isEqualTo(-1L);
    }

    /** 缓存名中出现多个 {@code #} 时不按自定义 TTL 处理，避免误解析出错误时间。 */
    @Test
    void nameWithMoreThanTwoSegmentsUsesDefaultConfiguration() {
        cacheManager.getCache(keyPrefix + "multi#1s#2s").put("k7", "v7");

        assertThat(probe.getExpire(keyPrefix + "multi#1s#2s::k7")).as("多段 # 不得触发自定义 TTL").isEqualTo(-1L);
    }

    /** 空缓存名走父类默认实现，仍返回可用缓存对象而不是抛错。 */
    @Test
    void emptyNameUsesParentImplementation() {
        Cache cache = cacheManager.getCache("");

        assertThat(cache).isNotNull();
        assertThat(cache.getName()).isEmpty();
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
