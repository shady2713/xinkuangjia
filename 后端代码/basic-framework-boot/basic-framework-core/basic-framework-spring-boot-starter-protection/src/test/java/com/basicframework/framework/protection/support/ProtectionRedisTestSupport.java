package com.basicframework.framework.protection.support;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.redisson.Redisson;
import org.redisson.api.RedissonClient;
import org.redisson.config.Config;
import org.redisson.spring.data.connection.RedissonConnectionFactory;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 为保护组件（幂等、限流、API 签名）测试提供共享的真实 Redis 隔离环境。
 *
 * <p>幂等占位 Key、限流令牌与验签随机数都是“Key 写进去就代表业务判定发生”的契约，内存替身或
 * mock 无法证明 setIfAbsent 的原子性、TTL 是否真的生效、并发下是否只有一次成功，因此这里统一连接
 * 环回地址上的隔离实例，连接参数由环境变量注入，密码不落到源码、日志或报告。</p>
 *
 * <p>每个测试类在 {@link #startRedis()} 时分配独立随机键前缀（{@code protect-test:<UUID>:}），
 * 清理只按该前缀扫描并按登记的确切键名删除；固定键名（例如 API 签名密钥所在的 HASH）只删除本类
 * 写入的字段。禁止使用清空整库或全库扫描的命令，避免影响同一实例上的其它任务。类结束时断言
 * 残留键数为零，让“测试自己清理干净”成为可验证的硬约束而不是口头约定。</p>
 *
 * @author shady2713
 */
public abstract class ProtectionRedisTestSupport {

    /** 本测试类独占的键前缀，扫描与删除都以它为边界。 */
    protected static String keyPrefix;

    /** 与 {@link #keyPrefix} 等价的通配模式，用于同时命中带业务前缀的 Key（例如 {@code idempotent:protect-test:...}）。 */
    protected static String keyGlob;

    /** 真实 Redisson 客户端，限流组件生产使用的就是它。 */
    protected static RedissonClient redissonClient;

    /** 真实 Redis 连接工厂，底层为生产同款的 {@link RedissonConnectionFactory}。 */
    protected static RedissonConnectionFactory connectionFactory;

    /** 真实字符串模板，幂等与验签 DAO 生产使用的就是它。 */
    protected static StringRedisTemplate stringRedisTemplate;

    /** 本测试类创建的全部 Redisson 客户端，结束时统一关闭。 */
    private static final List<RedissonClient> REDIS_CLIENTS = new ArrayList<>();

    /** 生产代码写入的固定键名，键名无法带随机前缀时登记后精确删除。 */
    private static final Set<String> TRACKED_KEYS = new LinkedHashSet<>();

    /** 生产代码写入的固定 HASH 中的字段，键名固定时只删除本类写入的字段而不动整个 HASH。 */
    private static final Map<String, Set<String>> TRACKED_HASH_FIELDS = new LinkedHashMap<>();

    /**
     * 建立指向隔离实例的真实连接，并用 PING 证明确实连到了真实 Redis。
     *
     * <p>缺少环境变量、端口非法或实例不是环回地址时直接失败，不做静默跳过，避免覆盖率靠“未执行”变绿。
     * @throws Exception 连接工厂初始化失败时抛出，随后该类的用例全部失败而不是退化成内存替身
     */
    @BeforeAll
    static void startRedis() throws Exception {
        int port = Integer.parseInt(requiredEnvironment("BF_TEST_REDIS_PORT"));
        if (port < 1 || port > 65535) {
            throw new IllegalArgumentException("测试 Redis 端口非法: " + port);
        }
        keyPrefix = "protect-test:" + UUID.randomUUID() + ":";
        // 生产代码会再加一层业务前缀（idempotent:、rate_limiter: 等），因此两侧都要通配。
        keyGlob = "*" + keyPrefix + "*";
        redissonClient = newRedissonClient(port);
        connectionFactory = new RedissonConnectionFactory(redissonClient);
        connectionFactory.afterPropertiesSet();
        stringRedisTemplate = new StringRedisTemplate(connectionFactory);
        stringRedisTemplate.afterPropertiesSet();
        String pong = stringRedisTemplate.execute((RedisConnection connection) -> connection.ping(), true);
        if (!"PONG".equals(pong)) {
            throw new IllegalStateException("保护组件测试必须连接真实 Redis，PING 返回: " + pong);
        }
    }

    /**
     * 每例结束后删除本类创建的键与 HASH 字段，避免污染同一隔离实例上的其它任务。
     */
    @AfterEach
    void cleanRedis() {
        deleteOwnedArtifacts();
    }

    /**
     * 关闭本测试类建立的全部客户端，并断言没有留下任何带本类前缀的键。
     *
     * <p>残留键意味着清理逻辑有漏洞，会让同一隔离实例上的其它任务误判，因此这里让失败直接暴露，
     * 而不是等到下一个任务莫名其妙地失败。</p>
     * @throws Exception 连接工厂关闭失败时抛出，避免后台线程与连接被静默泄漏
     */
    @AfterAll
    static void stopRedis() throws Exception {
        deleteOwnedArtifacts();
        Set<String> leftovers = scanOwnedKeys();
        assertThat(leftovers)
                .as("保护组件测试必须清理自己创建的键，残留: %s", leftovers)
                .isEmpty();
        for (RedissonClient client : REDIS_CLIENTS) {
            client.shutdown();
        }
        REDIS_CLIENTS.clear();
        if (connectionFactory != null) {
            connectionFactory.destroy();
        }
    }

    /**
     * 生成带本类随机前缀的业务键，使清理可以只按前缀定位而不误伤同实例上的其它任务。
     *
     * @param name 业务键名
     * @return 带随机前缀的完整业务键
     */
    protected static String nextKey(String name) {
        return keyPrefix + name;
    }

    /**
     * 登记键名固定、无法带随机前缀的键，供每例结束时精确删除。
     *
     * @param key 生产代码使用的固定键名
     */
    protected static void trackKey(String key) {
        TRACKED_KEYS.add(key);
    }

    /**
     * 登记固定 HASH 中由本类写入的字段，使清理只删除自己的字段而不动整个 HASH。
     *
     * <p>API 签名密钥存放在全局固定的 HASH {@code api_signature_app} 中，删除整个 HASH 会让同一实例上
     * 其它任务预加载的密钥一起丢失。</p>
     *
     * @param hashKey HASH 键名
     * @param field   本类写入的字段名
     */
    protected static void trackHashField(String hashKey, String field) {
        TRACKED_HASH_FIELDS.computeIfAbsent(hashKey, key -> new LinkedHashSet<>()).add(field);
    }

    /**
     * 读取必须由外部注入的测试环境变量。
     *
     * <p>刻意不提供默认值：缺少隔离实例时测试必须失败，而不是退化成跳过或内存替身。</p>
     *
     * @param key 环境变量名
     * @return 非空配置值
     */
    protected static String requiredEnvironment(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("缺少测试环境变量 " + key);
        }
        return value;
    }

    /**
     * 创建只连接环回地址的 Redisson 客户端并登记，便于结束时统一关闭。
     *
     * <p>地址固定为 {@code 127.0.0.1}，不接受任何可配置的远程地址，避免测试误连到真实业务实例。</p>
     *
     * @param port 隔离实例端口
     * @return 可用的 Redisson 客户端
     */
    protected static RedissonClient newRedissonClient(int port) {
        Config config = new Config();
        config.useSingleServer()
                .setAddress("redis://127.0.0.1:" + port)
                .setPassword(requiredEnvironment("BF_TEST_REDIS_PASSWORD"))
                .setConnectionMinimumIdleSize(1)
                .setConnectionPoolSize(4);
        RedissonClient client = Redisson.create(config);
        REDIS_CLIENTS.add(client);
        return client;
    }

    /**
     * 按本类随机前缀扫描自己创建的键。
     *
     * @return 命中的键名集合
     */
    protected static Set<String> scanOwnedKeys() {
        if (stringRedisTemplate == null) {
            return new LinkedHashSet<>();
        }
        ScanOptions options = ScanOptions.scanOptions().match(keyGlob).count(500).build();
        Set<String> keys = new LinkedHashSet<>();
        stringRedisTemplate.execute((RedisCallback<Void>) connection -> {
            try (Cursor<byte[]> cursor = connection.scan(options)) {
                while (cursor.hasNext()) {
                    keys.add(new String(cursor.next(), StandardCharsets.UTF_8));
                }
            }
            return null;
        });
        return keys;
    }

    /**
     * 删除本类登记的固定键、固定 HASH 字段与随机前缀命中的全部键。
     */
    private static void deleteOwnedArtifacts() {
        if (stringRedisTemplate == null) {
            return;
        }
        TRACKED_HASH_FIELDS.forEach((hashKey, fields) ->
                stringRedisTemplate.opsForHash().delete(hashKey, fields.toArray()));
        TRACKED_HASH_FIELDS.clear();
        Set<String> keys = new LinkedHashSet<>(TRACKED_KEYS);
        keys.addAll(scanOwnedKeys());
        if (!keys.isEmpty()) {
            stringRedisTemplate.delete(new ArrayList<>(keys));
        }
        TRACKED_KEYS.clear();
    }
}
