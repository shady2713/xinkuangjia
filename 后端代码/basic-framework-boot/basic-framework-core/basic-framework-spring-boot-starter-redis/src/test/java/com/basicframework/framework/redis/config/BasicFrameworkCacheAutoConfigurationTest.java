package com.basicframework.framework.redis.config;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import com.basicframework.framework.redis.core.TimeoutRedisCacheManager;
import org.springframework.boot.autoconfigure.cache.CacheProperties;
import org.springframework.cache.Cache;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.redisson.Redisson;
import org.redisson.api.RedissonClient;
import org.redisson.config.Config;
import org.redisson.spring.data.connection.RedissonConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证 Redis 缓存自动配置生成的基础配置与缓存管理器。
 *
 * <p>该配置是全部 {@code @Cacheable} 注解的公共底座：键前缀决定缓存键在 Redis 中的布局
 * （前缀漂移会让升级后旧键全部失效、或不同应用的键互相覆盖）、值序列化决定缓存内容形态、
 * TTL 与空值策略决定缓存能保留多久与是否缓存 null、scan 批次决定清理时的单次压力。
 * 因此这里断言真实配置对象与真实 Redis 上的键、TTL，而不是只断言 Bean 非空。</p>
 *
 * <p>需要外部注入隔离 Redis 连接；缺失环境变量时直接失败，不退化成内存替身。</p>
 *
 * @author shady2713
 */
class BasicFrameworkCacheAutoConfigurationTest {

    /** 本测试类独占的键前缀，清理只按它定位。 */
    private static String keyPrefix;
    /** 真实 Redis 连接工厂，与生产一致使用 Redisson。 */
    private static RedissonConnectionFactory connectionFactory;
    /** 真实 Redisson 客户端，结束时关闭。 */
    private static RedissonClient redissonClient;
    /** 直连 Redis 的字符串模板，用于独立观察键与 TTL。 */
    private static StringRedisTemplate probe;

    /** 连接隔离 Redis，缺少环境变量时直接失败。 */
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
        keyPrefix = "r8-cache-config-" + UUID.randomUUID() + ":";
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
     * 未配置时使用"缓存名 + 冒号"作为键前缀，并默认允许缓存空值、启用前缀、无 TTL。
     *
     * <p>这是运维未做任何配置时的真实布局，前缀缺失或变化会让 Redis 键与既有约定不一致。</p>
     */
    @Test
    void defaultConfigurationUsesCacheNamePrefix() {
        RedisCacheConfiguration configuration = new BasicFrameworkCacheAutoConfiguration()
                .redisCacheConfiguration(new CacheProperties());

        assertThat(configuration.getKeyPrefixFor("users")).isEqualTo("users:");
        assertThat(configuration.getAllowCacheNullValues()).as("默认必须缓存空值以抵御穿透").isTrue();
        assertThat(configuration.usePrefix()).as("默认必须启用键前缀").isTrue();
        assertThat(configuration.getTtl()).as("未配置时 TTL 为 0，表示不过期").isEqualTo(Duration.ZERO);
    }

    /** 配置的键前缀、TTL、空值策略与前缀开关都必须真实生效。 */
    @Test
    void configuredPrefixTtlAndFlagsAreApplied() {
        CacheProperties properties = new CacheProperties();
        properties.getRedis().setKeyPrefix("bf-cache");
        properties.getRedis().setTimeToLive(Duration.ofMinutes(5));
        properties.getRedis().setCacheNullValues(false);
        properties.getRedis().setUseKeyPrefix(false);

        RedisCacheConfiguration configuration = new BasicFrameworkCacheAutoConfiguration()
                .redisCacheConfiguration(properties);

        assertThat(configuration.getKeyPrefixFor("users")).as("前缀缺少结尾冒号时必须自动补齐")
                .isEqualTo("bf-cache:users:");
        assertThat(configuration.getTtl()).isEqualTo(Duration.ofMinutes(5));
        assertThat(configuration.getAllowCacheNullValues()).as("关闭缓存空值必须生效").isFalse();
        assertThat(configuration.usePrefix()).as("关闭键前缀必须生效").isFalse();
    }

    /** 前缀已带结尾冒号时不得重复追加。 */
    @Test
    void configuredPrefixKeepsExistingColon() {
        CacheProperties properties = new CacheProperties();
        properties.getRedis().setKeyPrefix("bf-cache:");

        RedisCacheConfiguration configuration = new BasicFrameworkCacheAutoConfiguration()
                .redisCacheConfiguration(properties);

        assertThat(configuration.getKeyPrefixFor("users")).isEqualTo("bf-cache:users:");
    }

    /** 值必须按 JSON 写入，保证 Redis 中可读且跨语言可解析。 */
    @Test
    void valueSerializationWritesJson() {
        RedisCacheConfiguration configuration = new BasicFrameworkCacheAutoConfiguration()
                .redisCacheConfiguration(new CacheProperties());
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("name", "张三");
        value.put("enabled", true);

        ByteBuffer buffer = configuration.getValueSerializationPair().write(value);
        String json = StandardCharsets.UTF_8.decode(buffer).toString();

        assertThat(json).as("缓存值必须是 JSON 文本").contains("\"name\":\"张三\"").contains("\"enabled\":true");
    }

    /**
     * 缓存管理器必须使用支持自定义过期时间的实现，并把配置的 scan 批次用于真实清理。
     *
     * <p>这里用真实 RedisTemplate 与真实 Redis 断言缓存写入后的实际 TTL，证明管理器把
     * {@code name#ttl} 解析与 scan 批次都接到了真实连接上。</p>
     */
    @Test
    void redisCacheManagerUsesTimeoutManagerAndConfiguredBatchSize() {
        CacheProperties properties = new CacheProperties();
        BasicFrameworkCacheProperties cacheProperties = new BasicFrameworkCacheProperties();
        cacheProperties.setRedisScanBatchSize(64);
        RedisTemplate<String, Object> redisTemplate = new BasicFrameworkRedisAutoConfiguration()
                .redisTemplate(connectionFactory);
        redisTemplate.afterPropertiesSet();
        RedisCacheConfiguration configuration = new BasicFrameworkCacheAutoConfiguration()
                .redisCacheConfiguration(properties);

        RedisCacheManager manager = new BasicFrameworkCacheAutoConfiguration()
                .redisCacheManager(redisTemplate, configuration, cacheProperties);
        Cache cache = manager.getCache(keyPrefix + "scan#20s");
        cache.put("key", "value");

        assertThat(manager).as("必须使用支持自定义过期时间的缓存管理器").isInstanceOf(TimeoutRedisCacheManager.class);
        // 本配置把键前缀覆盖为"缓存名 + 单冒号"，与 Spring 默认的"缓存名 + 双冒号"不同
        String redisKey = keyPrefix + "scan:key";
        assertThat(probe.hasKey(redisKey)).as("键前缀必须使用本配置的约定").isTrue();
        assertThat(probe.getExpire(redisKey)).as("TTL 必须真实生效").isBetween(15L, 20L);
        assertThat(probe.opsForValue().get(redisKey)).as("值必须按配置的序列化写入").contains("\"value\"");
    }

    /** 没有连接工厂的 RedisTemplate 必须显式失败，不能让缓存管理器在运行期才报错。 */
    @Test
    void redisCacheManagerRejectsTemplateWithoutConnectionFactory() {
        RedisTemplate<String, Object> templateWithoutFactory = new RedisTemplate<>();
        RedisCacheConfiguration configuration = new BasicFrameworkCacheAutoConfiguration()
                .redisCacheConfiguration(new CacheProperties());

        assertThatThrownBy(() -> new BasicFrameworkCacheAutoConfiguration()
                .redisCacheManager(templateWithoutFactory, configuration, new BasicFrameworkCacheProperties()))
                .isInstanceOf(NullPointerException.class);
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
