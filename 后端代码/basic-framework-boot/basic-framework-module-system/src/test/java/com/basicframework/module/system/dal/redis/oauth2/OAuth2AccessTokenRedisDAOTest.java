package com.basicframework.module.system.dal.redis.oauth2;

import cn.hutool.crypto.digest.DigestUtil;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证访问令牌缓存的键构造、序列化口径与过期处理。
 *
 * <p>缓存键是登出与撤销授权的唯一依据：键拼错时删除操作作用在另一个键上，被撤销的凭据会继续在缓存
 * 中存活到过期时间。序列化必须剔除审计字段，否则令牌每次写缓存都会改动 create_time，运维看到的
 * "创建时间"会随缓存刷新不断前移。</p>
 *
 * <p>过期时间由令牌自身的有效期换算。已经过期的令牌不得再写入缓存：写进去的令牌会立刻过期，
 * 却在失效前占用一个键位；同时"过期令牌仍被缓存"会让运维误判凭据仍然有效。</p>
 *
 * @author shady2713
 */
class OAuth2AccessTokenRedisDAOTest {

    /** 被测 DAO 的缓存键格式，与 RedisKeyConstants 的登记一致。 */
    private static final String KEY_FORMAT = "oauth2_access_token:%s";
    /** 缓存键的固定前缀，等于 KEY_FORMAT 中占位符之前的部分。 */
    private static final String KEY_PREFIX = "oauth2_access_token:";

    /** 缓存模板替身。 */
    private StringRedisTemplate stringRedisTemplate;
    /** 缓存值操作替身。 */
    private ValueOperations<String, String> valueOperations;
    /** 写入缓存时实际使用的键、值与过期秒数。 */
    private String writtenKey;
    private String writtenValue;
    private long writtenTtlSeconds;
    /** 缓存模板当前持有的值，供读取用例回放。 */
    private String storedValue;
    /** 批量删除时实际提交的键集合。 */
    private java.util.Collection<String> deletedKeys;
    /** 被测 DAO。 */
    private OAuth2AccessTokenRedisDAO redisDAO;

    /** 装配被测 DAO 并记录写入缓存的真实参数。 */
    @BeforeEach
    void setUp() {
        writtenKey = null;
        writtenValue = null;
        writtenTtlSeconds = 0L;
        storedValue = null;
        deletedKeys = null;
        stringRedisTemplate = mock(StringRedisTemplate.class);
        valueOperations = mock(ValueOperations.class);
        when(stringRedisTemplate.opsForValue()).thenReturn(valueOperations);
        org.mockito.Mockito.doAnswer(invocation -> {
            writtenKey = invocation.getArgument(0);
            writtenValue = invocation.getArgument(1);
            writtenTtlSeconds = invocation.getArgument(2);
            return null;
        }).when(valueOperations).set(anyString(), anyString(), anyLong(), any(java.util.concurrent.TimeUnit.class));
        when(valueOperations.get(anyString())).thenAnswer(invocation -> storedValue);
        org.mockito.Mockito.doAnswer(invocation -> {
            deletedKeys = invocation.getArgument(0);
            return null;
        }).when(stringRedisTemplate).delete(any(java.util.Collection.class));
        redisDAO = new OAuth2AccessTokenRedisDAO();
        ReflectionTestUtils.setField(redisDAO, "stringRedisTemplate", stringRedisTemplate);
    }

    /** 缓存键必须由令牌串按固定前缀拼出，删除与读取共用同一构造。 */
    @Test
    void setUsesTheDocumentedKeyFormat() {
        redisDAO.set(accessToken("access-1", LocalDateTime.now().plusHours(2)));

        assertThat(writtenKey).isEqualTo(String.format(KEY_FORMAT, "access-1"));
        assertThat(KEY_FORMAT).as("键格式与字面前缀必须保持一致").isEqualTo(KEY_PREFIX + "%s");
        assertThat(writtenKey).isEqualTo(KEY_PREFIX + "access-1");
        assertThat(writtenKey).as("键不得散列令牌明文").doesNotContain(DigestUtil.sha256Hex("access-1"));
    }

    /** 写入前必须清空审计字段，否则缓存每次刷新都会把创建时间改写一次。 */
    @Test
    void setStripsAuditFieldsFromTheCachedPayload() {
        OAuth2AccessTokenDO token = accessToken("access-1", LocalDateTime.now().plusHours(2));
        token.setUpdater("admin");
        token.setUpdateTime(LocalDateTime.now());
        token.setCreateTime(LocalDateTime.now());
        token.setCreator("admin");
        token.setDeleted(true);

        redisDAO.set(token);

        assertThat(writtenValue).doesNotContain("updater").doesNotContain("creator")
                .doesNotContain("createTime").doesNotContain("updateTime").doesNotContain("deleted");
        assertThat(writtenValue).contains("\"accessToken\":\"access-1\"").contains("\"userId\":100");
        assertThat(token.getUpdater()).as("审计字段必须在写入前被清空").isNull();
        assertThat(token.getDeleted()).isNull();
    }

    /** 过期时间必须按令牌剩余有效期换算成秒，而不是永不过期。 */
    @Test
    void setUsesTheRemainingLifetimeAsTtl() {
        redisDAO.set(accessToken("access-1", LocalDateTime.now().plusMinutes(10)));

        assertThat(writtenTtlSeconds).as("过期时间必须落在令牌剩余有效期内")
                .isPositive().isLessThanOrEqualTo(600L).isGreaterThan(540L);
        verify(valueOperations).set(anyString(), anyString(), anyLong(), any(java.util.concurrent.TimeUnit.class));
    }

    /** 已经过期的令牌不得写入缓存，避免留下立即过期的键位并让运维误判凭据仍有效。 */
    @Test
    void setSkipsAlreadyExpiredTokens() {
        redisDAO.set(accessToken("access-1", LocalDateTime.now().minusMinutes(1)));

        assertThat(writtenKey).isNull();
        assertThat(writtenValue).isNull();
        verify(valueOperations, never()).set(anyString(), anyString(), anyLong(),
                any(java.util.concurrent.TimeUnit.class));
    }

    /** 读取必须按同一键构造取回并反序列化成令牌对象。 */
    @Test
    void getReadsAndParsesTheCachedToken() {
        storedValue = "{\"accessToken\":\"access-1\",\"userId\":100,\"userType\":2,\"scopes\":[\"user.read\"]}";

        OAuth2AccessTokenDO token = redisDAO.get("access-1");

        assertThat(token).isNotNull();
        assertThat(token.getAccessToken()).isEqualTo("access-1");
        assertThat(token.getUserId()).isEqualTo(100L);
        verify(stringRedisTemplate).opsForValue();
    }

    /** 缓存中没有该令牌时返回 null，鉴权链路据此按未登录处理而不是收到空对象。 */
    @Test
    void getReturnsNullWhenTheKeyIsAbsent() {
        storedValue = null;

        assertThat(redisDAO.get("access-absent")).isNull();
    }

    /** 删除必须按同一键构造删除，撤销后的凭据不得继续命中缓存。 */
    @Test
    void deleteRemovesExactlyTheTokenKey() {
        redisDAO.delete("access-1");

        verify(stringRedisTemplate).delete(KEY_PREFIX + "access-1");
    }

    /** 批量删除必须把每个令牌都按同一前缀拼成键，一次请求删除全部待撤销会话。 */
    @Test
    void deleteListFormatsEveryTokenKey() {
        redisDAO.deleteList(List.of("access-1", "access-2"));

        assertThat(deletedKeys)
                .containsExactly(KEY_PREFIX + "access-1", KEY_PREFIX + "access-2");
        assertThat(deletedKeys).hasSize(2);
    }

    /** 空集合批量删除不得退化成逐个键删除，空请求本身保持为空即可。 */
    @Test
    void deleteListWithEmptyCollectionSendsNoPerKeyDelete() {
        redisDAO.deleteList(new ArrayList<>());

        assertThat(deletedKeys).isEmpty();
        verify(stringRedisTemplate, never()).delete(anyString());
    }

    /**
     * 构造一个带完整身份信息的访问令牌。
     *
     * @param accessToken 令牌串
     * @param expiresTime 过期时间
     * @return 访问令牌实体
     */
    private OAuth2AccessTokenDO accessToken(String accessToken, LocalDateTime expiresTime) {
        OAuth2AccessTokenDO token = new OAuth2AccessTokenDO();
        token.setAccessToken(accessToken);
        token.setUserId(100L);
        token.setUserType(2);
        token.setScopes(List.of("user.read"));
        token.setExpiresTime(expiresTime);
        return token;
    }

}