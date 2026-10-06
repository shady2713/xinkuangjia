package com.basicframework.framework.idempotent.core.redis;

import lombok.AllArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.concurrent.TimeUnit;

/**
 * 幂等 Redis DAO
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@AllArgsConstructor
public class IdempotentRedisDAO {

    /**
     * 幂等操作
     *
     * KEY 格式：idempotent:%s // 参数为 uuid
     * VALUE 格式：String
     * 过期时间：不固定
     */
    private static final String IDEMPOTENT = "idempotent:%s";

    /**
     * 字符串 Redis 模板
     */
    private final StringRedisTemplate redisTemplate;

    /**
     * 写入幂等 Key，仅当 Key 不存在时写入成功。
     *
     * @param key      幂等业务 Key
     * @param timeout  过期时间
     * @param timeUnit 过期时间单位
     * @return true 表示写入成功，false 表示 Key 已存在
     */
    public Boolean setIfAbsent(String key, long timeout, TimeUnit timeUnit) {
        String redisKey = formatKey(key);
        return redisTemplate.opsForValue().setIfAbsent(redisKey, "", timeout, timeUnit);
    }

    /**
     * 删除幂等 Key，主要用于业务异常后释放本次幂等占位。
     *
     * @param key 幂等业务 Key
     */
    public void delete(String key) {
        String redisKey = formatKey(key);
        redisTemplate.delete(redisKey);
    }

    /**
     * 格式化幂等 Redis Key。
     *
     * @param key 幂等业务 Key
     * @return Redis Key
     */
    private static String formatKey(String key) {
        return String.format(IDEMPOTENT, key);
    }

}
