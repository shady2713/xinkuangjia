package com.basicframework.framework.signature.core.redis;

import lombok.AllArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.concurrent.TimeUnit;

/**
 * HTTP API 签名 Redis DAO
 *
 * @author Zhougang
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@AllArgsConstructor
public class ApiSignatureRedisDAO {

    /**
     * 字符串 Redis 模板
     */
    private final StringRedisTemplate stringRedisTemplate;

    /**
     * 验签随机数
     * <p>
     * KEY 格式：signature_nonce:%s // 参数为 随机数
     * VALUE 格式：String
     * 过期时间：不固定
     */
    private static final String SIGNATURE_NONCE = "api_signature_nonce:%s:%s";

    /**
     * 签名密钥
     * <p>
     * HASH 结构
     * KEY 格式：%s // 参数为 appid
     * VALUE 格式：String
     * 过期时间：永不过期（预加载到 Redis）
     */
    private static final String SIGNATURE_APPID = "api_signature_app";

    // ========== 验签随机数 ==========

    /**
     * 获取已使用过的验签随机数。
     *
     * @param appId 应用 ID
     * @param nonce 随机数
     * @return 随机数缓存值，不存在时返回 null
     */
    public String getNonce(String appId, String nonce) {
        return stringRedisTemplate.opsForValue().get(formatNonceKey(appId, nonce));
    }

    /**
     * 记录验签随机数，防止同一随机数在有效期内重复使用。
     *
     * @param appId    应用 ID
     * @param nonce    随机数
     * @param time     过期时间
     * @param timeUnit 过期时间单位
     * @return true 表示写入成功，false 表示随机数已存在
     */
    public Boolean setNonce(String appId, String nonce, int time, TimeUnit timeUnit) {
        return stringRedisTemplate.opsForValue().setIfAbsent(formatNonceKey(appId, nonce), "", time, timeUnit);
    }

    /**
     * 格式化验签随机数 Redis Key。
     *
     * @param appId 应用 ID
     * @param nonce 随机数
     * @return Redis Key
     */
    private static String formatNonceKey(String appId, String nonce) {
        return String.format(SIGNATURE_NONCE, appId, nonce);
    }

    // ========== 签名密钥 ==========

    /**
     * 获取应用签名密钥。
     *
     * @param appId 应用 ID
     * @return 应用签名密钥，不存在时返回 null
     */
    public String getAppSecret(String appId) {
        return (String) stringRedisTemplate.opsForHash().get(SIGNATURE_APPID, appId);
    }

}
