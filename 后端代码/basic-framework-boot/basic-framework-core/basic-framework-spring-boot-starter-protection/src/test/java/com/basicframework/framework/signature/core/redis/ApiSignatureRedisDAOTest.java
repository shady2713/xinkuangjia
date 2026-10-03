package com.basicframework.framework.signature.core.redis;

import com.basicframework.framework.protection.support.ProtectionRedisTestSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 API 签名密钥与验签随机数在真实 Redis 上的读取与占用行为。
 *
 * <p>验签的两个 Redis 契约决定签名能否防重放：{@code getNonce} 必须能识别“已经用过的随机数”，
 * {@code setNonce} 必须原子地只写入一次。两者只要有一个退化成非原子的读改写，并发重放就能穿过校验，
 * 因此这里打真实实例验证，并顺带锁定随机数 Key 的命名格式与 TTL。</p>
 *
 * @author shady2713
 */
class ApiSignatureRedisDAOTest extends ProtectionRedisTestSupport {

    /** 生产代码使用的固定 HASH 键名，存放 appId 与 appSecret 的映射。 */
    private static final String SIGNATURE_APPID_KEY = "api_signature_app";

    /** 验签随机数至少 10 位，这里用足长度以免与切面的非空校验混淆。 */
    private static final String NONCE = "nonce-1234567890";

    /** 被测 DAO，全部方法都走真实 Redis。 */
    private ApiSignatureRedisDAO apiSignatureRedisDAO;

    /** 本用例使用的应用 ID，带随机前缀以免与同一实例上的其它任务冲突。 */
    private String appId;

    /**
     * 为每个用例创建独立的被测 DAO，并把应用密钥预加载到固定的 HASH 中。
     */
    @BeforeEach
    void setUp() {
        apiSignatureRedisDAO = new ApiSignatureRedisDAO(stringRedisTemplate);
        appId = nextKey("app");
        stringRedisTemplate.opsForHash().put(SIGNATURE_APPID_KEY, appId, "secret-for-" + appId);
        // 密钥 HASH 的键名固定，只登记本类写入的字段，清理时不会删掉别人的密钥。
        trackHashField(SIGNATURE_APPID_KEY, appId);
    }

    /**
     * 验证已预加载的应用能取回自己的密钥，且不同应用的密钥互不串号。
     *
     * <p>取错密钥会让所有请求都验签失败；串号则意味着一个应用可以冒用另一个应用的密钥签名。</p>
     */
    @Test
    @DisplayName("已预加载的应用取回自己的密钥，不同应用的密钥互不串号")
    void shouldReturnOwnAppSecretPerAppId() {
        String otherAppId = nextKey("other-app");
        stringRedisTemplate.opsForHash().put(SIGNATURE_APPID_KEY, otherAppId, "secret-for-other");
        trackHashField(SIGNATURE_APPID_KEY, otherAppId);

        assertThat(apiSignatureRedisDAO.getAppSecret(appId)).isEqualTo("secret-for-" + appId);
        assertThat(apiSignatureRedisDAO.getAppSecret(otherAppId)).isEqualTo("secret-for-other");
    }

    /**
     * 验证未预加载的应用取不到密钥，切面据此拒绝未授权的 appId。
     */
    @Test
    @DisplayName("未预加载的应用取不到密钥")
    void shouldReturnNullForUnknownAppId() {
        assertThat(apiSignatureRedisDAO.getAppSecret(nextKey("never-registered"))).isNull();
    }

    /**
     * 验证未被使用过的随机数读出来是空，随机数因此可以被当作“一次性凭据”。
     */
    @Test
    @DisplayName("未被使用过的随机数读出来为空")
    void shouldReturnNullForUnusedNonce() {
        assertThat(apiSignatureRedisDAO.getNonce(appId, NONCE)).isNull();
    }

    /**
     * 验证随机数首次占用成功，并落到 {@code api_signature_nonce:<appId>:<nonce>} 上。
     *
     * <p>Key 格式带 appId，使不同应用的相同随机数不会互相顶掉；这里直接断言真实 Key 名。</p>
     */
    @Test
    @DisplayName("随机数首次占用成功，并落到带 appId 与随机数的 Key 上")
    void shouldOccupyNonceOnFirstAttempt() {
        assertThat(apiSignatureRedisDAO.setNonce(appId, NONCE, 120, TimeUnit.SECONDS)).isTrue();

        assertThat(stringRedisTemplate.hasKey(
                String.format("api_signature_nonce:%s:%s", appId, NONCE))).isTrue();
        assertThat(apiSignatureRedisDAO.getNonce(appId, NONCE))
                .as("写入后必须能读出非空值，切面据此判定随机数已使用")
                .isNotNull();
    }

    /**
     * 验证同一个随机数第二次占用失败，重放因此在 Redis 层就被挡住。
     */
    @Test
    @DisplayName("同一个随机数重复占用失败，重放被 Redis 层挡下")
    void shouldRejectSecondOccupationOfSameNonce() {
        assertThat(apiSignatureRedisDAO.setNonce(appId, NONCE, 120, TimeUnit.SECONDS)).isTrue();

        assertThat(apiSignatureRedisDAO.setNonce(appId, NONCE, 120, TimeUnit.SECONDS))
                .as("随机数在有效期内只能被使用一次")
                .isFalse();
    }

    /**
     * 验证不同应用的相同随机数互不影响。
     *
     * <p>随机数只在应用内唯一时，两个应用各用各的随机数空间才是预期行为；否则一个应用的高频请求
     * 会把另一个应用的验签全部打掉。</p>
     */
    @Test
    @DisplayName("不同应用的相同随机数互不影响")
    void shouldIsolateNonceAcrossAppIds() {
        String otherAppId = nextKey("other-app");
        stringRedisTemplate.opsForHash().put(SIGNATURE_APPID_KEY, otherAppId, "secret-for-other");
        trackHashField(SIGNATURE_APPID_KEY, otherAppId);

        assertThat(apiSignatureRedisDAO.setNonce(appId, NONCE, 120, TimeUnit.SECONDS)).isTrue();
        assertThat(apiSignatureRedisDAO.setNonce(otherAppId, NONCE, 120, TimeUnit.SECONDS))
                .as("另一个应用使用相同随机数不应被占用冲突拦下")
                .isTrue();
    }

    /**
     * 验证随机数的过期时间真实下发给 Redis，避免随机数集合无限增长。
     *
     * <p>切面按“时间戳允许偏差的两倍”设置该 TTL，所以占用时间必须显著长于签名有效期，
     * 否则跨窗口的重放会因为记录先过期而漏过。这里用 120 秒对应 60 秒的签名窗口。</p>
     */
    @Test
    @DisplayName("随机数的过期时间真实下发给 Redis")
    void shouldApplyConfiguredTtlToNonceKey() {
        apiSignatureRedisDAO.setNonce(appId, NONCE, 120, TimeUnit.SECONDS);

        assertThat(stringRedisTemplate.getExpire(
                String.format("api_signature_nonce:%s:%s", appId, NONCE), TimeUnit.SECONDS))
                .isBetween(60L, 120L);
    }
}
