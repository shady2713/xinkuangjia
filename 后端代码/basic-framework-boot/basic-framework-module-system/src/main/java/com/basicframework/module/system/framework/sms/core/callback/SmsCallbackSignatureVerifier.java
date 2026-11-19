package com.basicframework.module.system.framework.sms.core.callback;

import cn.hutool.core.util.StrUtil;
import cn.hutool.crypto.digest.DigestUtil;
import cn.hutool.crypto.digest.HmacAlgorithm;
import com.basicframework.module.system.framework.sms.config.SmsCallbackProperties;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 短信回调签名校验器。
 *
 * <p>校验规则：调用方以渠道编码、秒级时间戳和原始请求体按
 * {@code channelCode + "\n" + timestamp + "\n" + body} 计算 HMAC-SHA256，将小写十六进制
 * 签名放入 {@link #HEADER_SIGNATURE}，将同一时间戳字符串放入 {@link #HEADER_TIMESTAMP}。
 * 签名或时间戳缺失、时间戳超出允许偏差、签名不匹配时均返回 {@link SmsCallbackVerificationResult#INVALID}；
 * 渠道未配置密钥时返回 {@link SmsCallbackVerificationResult#NOT_CONFIGURED}，两种结果都不得继续写入回执状态。</p>
 *
 * <p>时间戳窗口用于限制重放，不额外存储一次性随机数：短信回执按日志编号幂等更新，
 * 窗口内重复提交只会写入相同状态；若后续要求严格防重放，需要接入共享存储登记 nonce。</p>
 *
 * @author shady2713
 */
public final class SmsCallbackSignatureVerifier {

    /**
     * 回调时间戳请求头，值为 Unix 秒级时间戳。
     */
    public static final String HEADER_TIMESTAMP = "X-Sms-Callback-Timestamp";

    /**
     * 回调签名请求头，值为 HMAC-SHA256 的小写十六进制字符串。
     */
    public static final String HEADER_SIGNATURE = "X-Sms-Callback-Signature";

    /**
     * 配置缺失时使用的时间戳容差，避免退化为不限时间窗口。
     */
    private static final Duration DEFAULT_TIMESTAMP_TOLERANCE = Duration.ofMinutes(5);

    /** 回调签名重放去重 Redis 键前缀。 */
    private static final String REPLAY_KEY_PREFIX = "sms:callback:replay:";

    /** 无 Redis 降级场景下内存去重表最大容量上限，避免内存无界增长。 */
    private static final int MAX_LOCAL_REPLAY_ENTRIES = 10_000;

    /**
     * 渠道编码到签名密钥的只读快照，key 统一转为大写。
     */
    private final Map<String, String> secrets;

    /**
     * 允许的请求时间戳偏差。
     */
    private final Duration timestampTolerance;

    /**
     * 分布式重放去重用的 Redis 模板；测试环境未装配时回退到进程内有界去重表。
     */
    private final StringRedisTemplate stringRedisTemplate;

    /** 进程内重放去重缓存（键 -> 过期时间毫秒），仅在无 Redis 时启用。 */
    private final ConcurrentHashMap<String, Long> localReplayCache = new ConcurrentHashMap<>();

    /**
     * 使用配置创建校验器（默认使用进程内重放去重）。
     *
     * @param properties 短信回调配置；密钥为空时所有渠道按未配置处理
     */
    public SmsCallbackSignatureVerifier(SmsCallbackProperties properties) {
        this(properties, null);
    }

    /**
     * 使用配置与可选 Redis 客户端创建校验器。
     *
     * @param properties          短信回调配置；密钥为空时所有渠道按未配置处理
     * @param stringRedisTemplate 可选 Redis 客户端，用于多实例共享签名重放窗口去重
     */
    public SmsCallbackSignatureVerifier(SmsCallbackProperties properties, StringRedisTemplate stringRedisTemplate) {
        Map<String, String> configuredSecrets = properties.getSecrets() == null
                ? Collections.emptyMap() : properties.getSecrets();
        Map<String, String> normalizedSecrets = new HashMap<>(configuredSecrets.size());
        // 配置 key 统一大写，避免 YAML 或环境变量的大小写差异导致渠道被误判为未配置。
        configuredSecrets.forEach((channelCode, secret) -> {
            if (StrUtil.isNotBlank(channelCode)) {
                normalizedSecrets.put(channelCode.trim().toUpperCase(Locale.ROOT), secret);
            }
        });
        this.secrets = Collections.unmodifiableMap(normalizedSecrets);
        Duration tolerance = properties.getTimestampTolerance();
        this.timestampTolerance = tolerance == null || tolerance.isNegative()
                ? DEFAULT_TIMESTAMP_TOLERANCE : tolerance;
        this.stringRedisTemplate = stringRedisTemplate;
    }

    /**
     * 校验指定渠道的回调请求签名。
     *
     * <p>只读取请求头，不消费请求体；请求体必须与签名时使用的字节内容一致，调用方应先读取
     * 原始报文再传入本方法，之后复用同一字符串解析，避免二次读取或字符集差异。</p>
     *
     * @param channelCode 渠道编码，与签名时使用的编码必须一致
     * @param request     回调请求，提供时间戳与签名请求头
     * @param body        原始请求体，null 按空串处理
     * @return 校验结果；只有 {@link SmsCallbackVerificationResult#PASS} 允许继续写入回执状态
     */
    public SmsCallbackVerificationResult verify(String channelCode, HttpServletRequest request, String body) {
        String secret = secrets.get(StrUtil.isBlank(channelCode) ? null : channelCode.toUpperCase(Locale.ROOT));
        if (StrUtil.isBlank(secret)) {
            return SmsCallbackVerificationResult.NOT_CONFIGURED;
        }
        String timestamp = request.getHeader(HEADER_TIMESTAMP);
        String signature = request.getHeader(HEADER_SIGNATURE);
        if (StrUtil.isBlank(timestamp) || StrUtil.isBlank(signature)) {
            return SmsCallbackVerificationResult.INVALID;
        }
        long timestampMillis;
        try {
            // 先做乘法溢出保护，避免极大时间戳绕过窗口比较。
            timestampMillis = Math.multiplyExact(Long.parseLong(timestamp), 1000L);
        } catch (NumberFormatException | ArithmeticException ex) {
            return SmsCallbackVerificationResult.INVALID;
        }
        long now = System.currentTimeMillis();
        long toleranceMillis = timestampTolerance.toMillis();
        if (timestampMillis < now - toleranceMillis || timestampMillis > now + toleranceMillis) {
            return SmsCallbackVerificationResult.INVALID;
        }
        String expectedSignature = hmacSha256Hex(secret,
                channelCode + "\n" + timestamp + "\n" + StrUtil.nullToEmpty(body));
        byte[] expectedBytes = expectedSignature.getBytes(StandardCharsets.US_ASCII);
        byte[] actualBytes = signature.trim().toLowerCase(Locale.ROOT).getBytes(StandardCharsets.US_ASCII);
        if (!MessageDigest.isEqual(expectedBytes, actualBytes)) {
            return SmsCallbackVerificationResult.INVALID;
        }
        // 在时间戳容差窗口内登记签名指纹，阻断窗口内重复重放同一回调请求。
        if (!registerReplayFingerprint(channelCode, timestamp, expectedSignature, now)) {
            return SmsCallbackVerificationResult.INVALID;
        }
        return SmsCallbackVerificationResult.PASS;
    }

    /**
     * 登记回调签名指纹，若在去重窗口内已处理过相同请求则返回 {@code false}。
     *
     * @param channelCode       渠道编码
     * @param timestamp         回调时间戳字符串
     * @param expectedSignature 已验证通过的签名摘要
     * @param nowMillis         当前毫秒时间戳
     * @return 首次出现返回 true，重放返回 false
     */
    private boolean registerReplayFingerprint(String channelCode, String timestamp,
                                              String expectedSignature, long nowMillis) {
        Duration ttl = timestampTolerance.multipliedBy(2);
        if (ttl.isZero() || ttl.isNegative()) {
            ttl = DEFAULT_TIMESTAMP_TOLERANCE.multipliedBy(2);
        }
        String fingerprint = DigestUtil.sha256Hex(channelCode.toUpperCase(Locale.ROOT) + ":" + timestamp + ":" + expectedSignature);
        if (stringRedisTemplate != null) {
            Boolean acquired = stringRedisTemplate.opsForValue().setIfAbsent(REPLAY_KEY_PREFIX + fingerprint, "1", ttl);
            return Boolean.TRUE.equals(acquired);
        }
        // 清理过期项并限制容量，防止降级模式内存增长。
        if (localReplayCache.size() >= MAX_LOCAL_REPLAY_ENTRIES) {
            localReplayCache.entrySet().removeIf(entry -> entry.getValue() <= nowMillis);
        }
        long expiresAt = nowMillis + ttl.toMillis();
        Long existing = localReplayCache.putIfAbsent(fingerprint, expiresAt);
        if (existing == null) {
            return true;
        }
        if (existing <= nowMillis) {
            return localReplayCache.replace(fingerprint, existing, expiresAt);
        }
        return false;
    }

    /**
     * 计算 HMAC-SHA256 的十六进制签名。
     *
     * @param secret  签名密钥
     * @param content 待签名内容
     * @return 小写十六进制签名
     */
    private static String hmacSha256Hex(String secret, String content) {
        return DigestUtil.hmac(HmacAlgorithm.HmacSHA256, secret.getBytes(StandardCharsets.UTF_8))
                .digestHex(content);
    }

}
