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
     * <p>初始化必须使用原子创建 {@code trySetRate}：Redisson 3.52.0 对尚未创建的限流器同样返回非空配置
     * （{@code rate} 为 0），不能靠 {@code getConfig() == null} 判断首次使用。同一冷 Key 的两个并发请求
     * 若都走 {@code setRate} 重建分支，重建的 Lua 会删除消费记录（{@code del valueName permitsName}），
     * 后一次初始化将清空前一次已经用掉的配额，{@code count=1} 也会放行多次。</p>
     *
     * <p>因此这里先原子创建；创建失败说明配置已存在，此时才读取真实落盘配置并比较：一致就复用，
     * 避免清空已用配额；只有配置确实变化（含历史 Key 缺少配置）才重建并刷新过期时间。</p>
     *
     * @param key      限流业务 Key
     * @param count    限流周期内允许的请求次数
     * @param time     限流周期
     * @param timeUnit 限流周期单位
     * @return Redisson 限流器，其服务端配置为本方法声明的速率与周期
     */
    private RRateLimiter getRRateLimiter(String key, long count, int time, TimeUnit timeUnit) {
        String redisKey = formatKey(key);
        RRateLimiter rateLimiter = redissonClient.getRateLimiter(redisKey);
        long rateInterval = timeUnit.toSeconds(time);
        Duration duration = Duration.ofSeconds(rateInterval);
        // 1. 原子创建：只有真正写入配置的请求才算初始化成功，并发下不会重复初始化或清空已用配额
        if (rateLimiter.trySetRate(RateType.OVERALL, count, duration)) {
            // 额外设置过期时间，避免限流器 Key 长期残留
            rateLimiter.expire(duration);
            return rateLimiter;
        }
        // 2. 配置已存在，读取真实落盘值；与本次声明一致时直接复用已消耗的配额
        RateLimiterConfig config = rateLimiter.getConfig();
        if (config != null && config.getRateType() == RateType.OVERALL
                && ObjUtil.equal(config.getRate(), count)
                && ObjUtil.equal(config.getRateInterval(), TimeUnit.SECONDS.toMillis(rateInterval))) {
            return rateLimiter;
        }
        // 3. 配置确实变化（或历史 Key 没有完整配置），按新参数重建并刷新过期时间
        rateLimiter.setRate(RateType.OVERALL, count, duration);
        // 额外设置过期时间，避免限流器 Key 长期残留
        rateLimiter.expire(duration);
        return rateLimiter;
    }

}
