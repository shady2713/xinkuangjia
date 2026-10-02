package com.basicframework.framework.ratelimiter.core.redis;

import cn.hutool.core.util.ObjUtil;
import lombok.AllArgsConstructor;
import org.redisson.api.*;

import java.time.Duration;
import java.util.concurrent.TimeUnit;

/**
 * 限流 Redis DAO
 *
 * @author 李杰
 */
@AllArgsConstructor
public class RateLimiterRedisDAO {

    /**
     * 限流操作
     *
     * KEY 格式：rate_limiter:%s // 参数为 uuid
     * VALUE 格式：String
     * 过期时间：不固定
     */
    private static final String RATE_LIMITER = "rate_limiter:%s";

    /**
     * Redisson 客户端
     */
    private final RedissonClient redissonClient;

    /**
     * 尝试获取一个限流令牌。
     *
     * @param key      限流业务 Key
     * @param count    限流周期内允许的请求次数
     * @param time     限流周期
     * @param timeUnit 限流周期单位
     * @return true 表示获取成功，false 表示已达到限流阈值
     */
    public Boolean tryAcquire(String key, int count, int time, TimeUnit timeUnit) {
        // 1. 获得 RRateLimiter，并设置 rate 速率
        RRateLimiter rateLimiter = getRRateLimiter(key, count, time, timeUnit);
        // 2. 尝试获取 1 个
        return rateLimiter.tryAcquire();
    }

    /**
     * 格式化限流 Redis Key。
     *
     * @param key 限流业务 Key
     * @return Redis Key
     */
    private static String formatKey(String key) {
        return String.format(RATE_LIMITER, key);
    }

    /**
     * 获取并初始化 Redisson 限流器，配置变化时同步刷新限流速率。
     *
     * @param key      限流业务 Key
     * @param count    限流周期内允许的请求次数
     * @param time     限流周期
     * @param timeUnit 限流周期单位
     * @return Redisson 限流器
     */
    private RRateLimiter getRRateLimiter(String key, long count, int time, TimeUnit timeUnit) {
        String redisKey = formatKey(key);
        RRateLimiter rateLimiter = redissonClient.getRateLimiter(redisKey);
        long rateInterval = timeUnit.toSeconds(time);
        Duration duration = Duration.ofSeconds(rateInterval);
        // 1. 如果不存在，设置 rate 速率
        RateLimiterConfig config = rateLimiter.getConfig();
        if (config == null) {
            rateLimiter.trySetRate(RateType.OVERALL, count, duration);
            // 额外设置过期时间，避免限流器 Key 长期残留
            rateLimiter.expire(duration);
            return rateLimiter;
        }
        // 2. 如果存在，并且配置相同，则直接返回
        if (config.getRateType() == RateType.OVERALL
                && ObjUtil.equal(config.getRate(), count)
                && ObjUtil.equal(config.getRateInterval(), TimeUnit.SECONDS.toMillis(rateInterval))) {
            return rateLimiter;
        }
        // 3. 如果存在，并且配置不同，则进行新建
        rateLimiter.setRate(RateType.OVERALL, count, duration);
        // 额外设置过期时间，避免限流器 Key 长期残留
        rateLimiter.expire(duration);
        return rateLimiter;
    }

}
