package com.basicframework.framework.mq.support;

import com.basicframework.framework.mq.redis.core.RedisMQTemplate;
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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 为 mq 模块测试提供共享的真实 Redis 隔离环境。
 *
 * <p>本测试只连接环回地址上的隔离实例，连接参数由环境变量注入，密码不落到源码、日志或报告。
 * 每个测试类在 {@link #startRedis()} 时分配独立随机键前缀，用例结束按前缀与登记键精确删除自己创建的
 * Stream、消费组与锁，禁止使用清空整库的命令影响同一实例上的其它任务。</p>
 *
 * <p>底层客户端与生产一致，使用 {@code redisson-spring-boot-starter} 提供的
 * {@link RedissonConnectionFactory}，避免用内存替身伪造 XPENDING、XTRIM 等真实服务端行为。</p>
 *
 * @author shady2713
 */
public abstract class MqRedisTestSupport {

    /**
     * {@code RedisStreamMessageCleanupJob} 生产使用的固定锁键。
     *
     * <p>要覆盖“未拿到锁就整段跳过”的分支，必须使用与生产完全相同的键名，因此单独登记，
     * 每例结束时确认没有遗留持锁状态。</p>
     */
    protected static final String CLEANUP_LOCK_KEY = "redis:stream:message-cleanup:lock";

    /**
     * {@code RedisPendingMessageResendJob} 生产使用的固定锁键。
     *
     * <p>与 {@link #CLEANUP_LOCK_KEY} 同理，属于被测契约的一部分，不能替换成随机键。</p>
     */
    protected static final String RESEND_LOCK_KEY = "redis:stream:pending-message-resend:lock";

    /** 本测试类独占的键前缀，扫描与删除都以它为边界。 */
    protected static String keyPrefix;

    /** 真实 Redis 连接工厂，底层是生产同款 Redisson 客户端。 */
    protected static RedissonConnectionFactory connectionFactory;

    /** 真实 Redis 字符串模板。 */
    protected static StringRedisTemplate stringRedisTemplate;

    /** 真实 Redisson 客户端，用于分布式锁分支。 */
    protected static RedissonClient redissonClient;

    /** 本测试类创建的全部 Redisson 客户端，包含为抢占锁而新建的第二个客户端。 */
    private static final List<RedissonClient> REDIS_CLIENTS = new ArrayList<>();

    /** 键名由类的 {@code getSimpleName()} 决定、无法带随机前缀的 Stream，需要显式登记后删除。 */
    private static final Set<String> TRACKED_KEYS = new LinkedHashSet<>();

    /** 本测试类实际触碰过的定时任务锁键，只清理这些键，避免影响同实例上的其它任务。 */
    private static final Set<String> TRACKED_LOCK_KEYS = new LinkedHashSet<>();

    /**
     * 建立指向隔离实例的真实连接，并用 PING 证明确实连到了真实 Redis。
     *
     * <p>缺少环境变量或端口不是环回实例时直接失败，不做静默跳过，避免覆盖率靠“未执行”变绿。</p>
     */
    @BeforeAll
    static void startRedis() throws Exception {
        int port = Integer.parseInt(requiredEnvironment("BF_TEST_REDIS_PORT"));
        if (port < 1 || port > 65535) {
            throw new IllegalArgumentException("测试 Redis 端口非法: " + port);
        }
        keyPrefix = "mq-test-" + UUID.randomUUID() + "-";
        redissonClient = newRedissonClient(port);
        connectionFactory = new RedissonConnectionFactory(redissonClient);
        connectionFactory.afterPropertiesSet();
        stringRedisTemplate = new StringRedisTemplate(connectionFactory);
        stringRedisTemplate.afterPropertiesSet();
        String pong = stringRedisTemplate.execute(connection -> connection.ping(), true);
        if (!"PONG".equals(pong)) {
            throw new IllegalStateException("mq 测试必须连接真实 Redis，PING 返回: " + pong);
        }
    }

    /**
     * 每例结束后删除自己创建的键、释放可能残留的锁，避免污染同一隔离实例上的其它任务。
     */
    @AfterEach
    void cleanRedis() {
        if (stringRedisTemplate == null) {
            return;
        }
        releaseLocks();
        Set<String> keys = new LinkedHashSet<>(TRACKED_KEYS);
        keys.addAll(scanKeysWithPrefix());
        if (!keys.isEmpty()) {
            stringRedisTemplate.delete(new ArrayList<>(keys));
        }
    }

    /**
     * 关闭本测试类建立的全部 Redisson 客户端，确认后台线程与连接真实退出。
     */
    @AfterAll
    static void stopRedis() throws Exception {
        if (stringRedisTemplate != null) {
            releaseLocks();
            Set<String> keys = new LinkedHashSet<>(TRACKED_KEYS);
            keys.addAll(scanKeysWithPrefix());
            if (!keys.isEmpty()) {
                stringRedisTemplate.delete(new ArrayList<>(keys));
            }
        }
        TRACKED_KEYS.clear();
        TRACKED_LOCK_KEYS.clear();
        for (RedissonClient client : REDIS_CLIENTS) {
            client.shutdown();
        }
        REDIS_CLIENTS.clear();
        if (connectionFactory != null) {
            connectionFactory.destroy();
        }
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
     * 创建绑定到隔离实例的 Redisson 客户端并登记，便于结束时统一关闭。
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
     * 创建一个不带拦截器的发送模板，避免各用例之间共享可变拦截器列表。
     *
     * @return 指向真实 Redis 的发送模板
     */
    protected static RedisMQTemplate newRedisMQTemplate() {
        return new RedisMQTemplate(stringRedisTemplate);
    }

    /**
     * 登记键名固定的 Stream，供每例结束时精确删除。
     *
     * @param key 由类名决定、无法带随机前缀的键
     */
    protected static void trackKey(String key) {
        TRACKED_KEYS.add(key);
    }

    /**
     * 登记本测试类会触碰的定时任务锁键，使清理只作用于自己实际用过的锁。
     *
     * @param lockKey 生产使用的固定锁键
     */
    protected static void trackLockKey(String lockKey) {
        TRACKED_LOCK_KEYS.add(lockKey);
    }

    /**
     * 释放本测试类登记过的锁键上的残留持锁状态。
     *
     * <p>用例在持锁期间失败会让 Redisson 锁一直存在到看门狗超时，直接影响后续用例的加锁分支，
     * 因此按登记过的确切锁键名强制释放，而不是扫描整库。</p>
     */
    private static void releaseLocks() {
        for (RedissonClient client : REDIS_CLIENTS) {
            for (String lockKey : TRACKED_LOCK_KEYS) {
                if (client.getLock(lockKey).isLocked()) {
                    client.getLock(lockKey).forceUnlock();
                }
            }
        }
    }

    /**
     * 断言拦截器事件严格按“前置正序、后置逆序”成对出现。
     *
     * <p>Pub/Sub 用例为了让订阅真正建立会重复投递，消息条数不确定，因此不能断言整个列表相等；
     * 这里只锁定真正需要保护的契约：每条消息都贡献一对顺序正确的事件。</p>
     *
     * @param events 实际记录的事件列表
     * @param interceptorName 参与断言的拦截器名称
     */
    protected static void assertForwardThenReversePairs(List<String> events, String interceptorName) {
        assertThat(events).as("必须至少消费到一条消息").isNotEmpty();
        assertThat(events.size() % 2).as("事件必须成对出现，实际为 %s", events).isZero();
        for (int index = 0; index < events.size(); index += 2) {
            assertThat(events.get(index)).isEqualTo(interceptorName + ".consumeBefore");
            assertThat(events.get(index + 1)).isEqualTo(interceptorName + ".consumeAfter");
        }
    }

    /**
     * 把字符串编码为 UTF-8 字节数组，用于直接下发 Redis 命令。
     *
     * @param value 文本值
     * @return UTF-8 字节数组
     */
    protected static byte[] utf8(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }

    /**
     * 按本测试类随机前缀精确扫描自己创建的键。
     *
     * @return 命中的键名集合
     */
    private static Set<String> scanKeysWithPrefix() {
        ScanOptions options = ScanOptions.scanOptions().match(keyPrefix + "*").count(500).build();
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
}
