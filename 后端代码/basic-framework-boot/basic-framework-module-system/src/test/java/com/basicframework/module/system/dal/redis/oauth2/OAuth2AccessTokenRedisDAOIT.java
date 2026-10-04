package com.basicframework.module.system.dal.redis.oauth2;

import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.dal.redis.RedisKeyConstants;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.redisson.Redisson;
import org.redisson.api.RedissonClient;
import org.redisson.config.Config;
import org.redisson.spring.data.connection.RedissonConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 用真实 Redis 验证访问令牌缓存的写入与删除契约。
 *
 * <p>退出登录与撤销授权依赖 {@code delete} 真实移除缓存键：如果删除的是拼接错误的键，
 * 令牌会继续在缓存中存活到过期时间，被撤销的凭据仍能通过校验。该结论只能由真实 Redis
 * 的键状态证明，不能用模板替身代替。</p>
 *
 * <p>显式执行此集成入口必须提供环回 Redis 环境，缺失环境直接失败；用例使用随机令牌名，
 * 结束后只清理自己写入的键。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class OAuth2AccessTokenRedisDAOIT {

    /** 真实 Redis 客户端。 */
    private RedissonClient redissonClient;
    /** 被测 DAO 使用的字符串模板。 */
    private StringRedisTemplate stringRedisTemplate;
    /** 被测 DAO。 */
    private OAuth2AccessTokenRedisDAO accessTokenRedisDAO;
    /** 记录用例写入的令牌名，供逐例清理使用。 */
    private final List<String> writtenTokens = new ArrayList<>();

    /** 建立真实 Redis 连接并注入被测 DAO。 */
    @BeforeAll
    void startEnvironment() throws Exception {
        Config redis = new Config();
        redis.useSingleServer().setAddress("redis://127.0.0.1:"
                        + Integer.parseInt(requiredEnvironment("BF_TEST_REDIS_PORT")))
                .setPassword(requiredEnvironment("BF_TEST_REDIS_PASSWORD"))
                .setConnectionMinimumIdleSize(1).setConnectionPoolSize(4);
        redissonClient = Redisson.create(redis);
        RedissonConnectionFactory redisConnection = new RedissonConnectionFactory(redissonClient);
        redisConnection.afterPropertiesSet();
        stringRedisTemplate = new StringRedisTemplate(redisConnection);
        stringRedisTemplate.afterPropertiesSet();
        assertThat(stringRedisTemplate.execute(
                (org.springframework.data.redis.core.RedisCallback<String>) connection -> connection.ping()))
                .as("真实 Redis 必须可达").isEqualTo("PONG");
        accessTokenRedisDAO = new OAuth2AccessTokenRedisDAO();
        ReflectionTestUtils.setField(accessTokenRedisDAO, "stringRedisTemplate", stringRedisTemplate);
    }

    /** 每例清理本用例写入的随机键，避免污染共享实例。 */
    @AfterEach
    void clearFixture() {
        for (String cacheKey : writtenTokens) {
            stringRedisTemplate.delete(redisKey(cacheKey));
        }
    }

    /** 写入后的令牌必须能被真实读回，字段不得丢失。 */
    @Test
    void setAndGetRoundTripThroughRedis() {
        String token = token();
        OAuth2AccessTokenDO accessToken = accessToken(token, LocalDateTime.now().plusHours(2));

        accessTokenRedisDAO.set(accessToken);

        OAuth2AccessTokenDO cached = accessTokenRedisDAO.get(token);
        assertThat(cached).as("写入后必须能读回").isNotNull();
        assertThat(cached.getAccessToken()).isEqualTo(token);
        assertThat(cached.getUserId()).isEqualTo(100L);
        assertThat(cached.getScopes()).containsExactly("user.read");
        assertThat(stringRedisTemplate.getExpire(redisKey(token)))
                .as("过期时间必须按令牌剩余有效期设置，而不是永不过期").isPositive();
    }

    /**
     * 删除必须真实移除缓存键，撤销后的令牌不得继续命中缓存。
     *
     * <p>删除错误的键时读回仍会成功，被撤销的凭据继续有效。</p>
     */
    @Test
    void deleteRemovesCachedToken() {
        String token = token();
        accessTokenRedisDAO.set(accessToken(token, LocalDateTime.now().plusHours(2)));
        assertThat(stringRedisTemplate.hasKey(redisKey(token))).isTrue();

        accessTokenRedisDAO.delete(token);

        assertThat(stringRedisTemplate.hasKey(redisKey(token)))
                .as("撤销必须真实删除缓存键").isFalse();
        assertThat(accessTokenRedisDAO.get(token)).isNull();
    }

    /** 删除未知令牌不得影响其它缓存键。 */
    @Test
    void deleteUnknownTokenKeepsOtherKeys() {
        String token = token();
        accessTokenRedisDAO.set(accessToken(token, LocalDateTime.now().plusHours(2)));

        accessTokenRedisDAO.delete(token() + "-absent");

        assertThat(stringRedisTemplate.hasKey(redisKey(token))).isTrue();
    }

    /** 已过期的令牌不得写入缓存，避免缓存中留下无效凭据。 */
    @Test
    void expiredTokenIsNotCached() {
        String token = token();

        accessTokenRedisDAO.set(accessToken(token, LocalDateTime.now().minusMinutes(1)));

        assertThat(stringRedisTemplate.hasKey(redisKey(token))).isFalse();
    }

    /** 关闭 Redis 连接。 */
    @AfterAll
    void closeEnvironment() {
        if (redissonClient != null) {
            redissonClient.shutdown();
        }
    }

    /**
     * 生成随机令牌名，避免与真实数据冲突。
     *
     * @return 令牌名
     */
    private String token() {
        String token = "it-" + UUID.randomUUID().toString().replace("-", "");
        writtenTokens.add(token);
        return token;
    }

    /**
     * 构造访问令牌对象。
     *
     * @param token 令牌名
     * @param expiresTime 过期时间
     * @return 访问令牌
     */
    private OAuth2AccessTokenDO accessToken(String token, LocalDateTime expiresTime) {
        OAuth2AccessTokenDO accessToken = new OAuth2AccessTokenDO();
        accessToken.setAccessToken(token);
        accessToken.setRefreshToken("refresh-" + token);
        accessToken.setUserId(100L);
        accessToken.setUserType(2);
        accessToken.setClientId("default");
        accessToken.setScopes(List.of("user.read"));
        accessToken.setExpiresTime(expiresTime);
        return accessToken;
    }

    /**
     * 计算真实缓存键。
     *
     * @param token 令牌名
     * @return Redis 键
     */
    private String redisKey(String token) {
        return String.format(RedisKeyConstants.OAUTH2_ACCESS_TOKEN, token);
    }

    /** 缺失隔离环境时直接失败，避免退化成跳过真实 Redis 证据。 */
    private String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("缺少隔离测试环境变量 " + name);
        }
        return value;
    }

}
