package com.basicframework.module.system.dal.redis.sms;

import cn.hutool.crypto.digest.DigestUtil;
import com.basicframework.module.system.framework.sms.config.SmsCodeProperties;
import jakarta.annotation.Resource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Repository;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.ZonedDateTime;
import java.util.List;

/**
 * 原子预约短信发送额度，避免并发穿透手机间隔、手机日额度与可信 IP 请求窗口。
 *
 * @author shady2713
 */
@Repository
public class SmsSendRedisDAO {

    /** 三个维度位于同一 Redis 集群槽，手机号与 IP 均只保留哈希。 */
    private static final String KEY_PREFIX = "sms_send:{budget}:";

    /** 请求预算先计数，只有全部通过才预约手机额度；失败与回滚不退还预约。 */
    private static final DefaultRedisScript<Long> RESERVE_SCRIPT = new DefaultRedisScript<>("""
            local ip = redis.call('INCR', KEYS[3])
            if ip == 1 then redis.call('PEXPIRE', KEYS[3], ARGV[1]) end
            if ip > tonumber(ARGV[2]) then return -3 end
            if redis.call('EXISTS', KEYS[1]) == 1 or tonumber(ARGV[3]) > 0 then return -1 end
            local daily = math.max(tonumber(redis.call('GET', KEYS[2]) or '0'), tonumber(ARGV[4]))
            if daily >= tonumber(ARGV[5]) then return -2 end
            daily = daily + 1
            redis.call('SET', KEYS[1], '1', 'PX', ARGV[6])
            redis.call('SET', KEYS[2], tostring(daily), 'PX', ARGV[7])
            return daily
            """, Long.class);

    @Resource
    private StringRedisTemplate stringRedisTemplate;

    /**
     * 原子占用发送额度；成功结果直接作为验证码的今日发送序号。
     *
     * <p>数据库历史为 Redis 冷启动提供已持久化的下限。供应商错误、数据库回滚和网络超时
     * 均不释放预约，防止不确定发送结果被重试放大。日期沿用应用所在时区。</p>
     *
     * @param mobile 目标手机号
     * @param clientIp 可信容器确定的客户端地址
     * @param properties 已验证的发送限制
     * @param lastSentAt 最近持久化的发送时间；无历史时为 null
     * @param lastDailyIndex 最近持久化记录的日内序号；无历史时为 0
     * @return 正数表示本次日内序号，-1 表示间隔不足，-2 表示日额度耗尽，-3 表示 IP 限流或空响应
     */
    public long reserve(String mobile, String clientIp, SmsCodeProperties properties,
                        LocalDateTime lastSentAt, int lastDailyIndex) {
        ZonedDateTime now = ZonedDateTime.now();
        String mobileHash = DigestUtil.sha256Hex(mobile);
        int persistedCount = lastSentAt != null && lastSentAt.toLocalDate().equals(now.toLocalDate())
                ? lastDailyIndex : 0;
        long persistedCooldown = lastSentAt == null ? 0 : Math.max(0,
                Duration.between(now.toLocalDateTime(), lastSentAt.plus(properties.getSendFrequency())).toMillis());
        long dayTtlMillis = Math.max(1, Duration.between(now,
                now.toLocalDate().plusDays(1).atStartOfDay(now.getZone())).toMillis());
        Long result = stringRedisTemplate.execute(RESERVE_SCRIPT,
                List.of(KEY_PREFIX + "interval:" + mobileHash,
                        KEY_PREFIX + "daily:" + mobileHash + ":" + now.toLocalDate(),
                        KEY_PREFIX + "ip:" + DigestUtil.sha256Hex(clientIp)),
                Long.toString(properties.getSendIpWindow().toMillis()),
                Integer.toString(properties.getSendMaximumPerIp()), Long.toString(persistedCooldown),
                Integer.toString(persistedCount), Integer.toString(properties.getSendMaximumQuantityPerDay()),
                Long.toString(properties.getSendFrequency().toMillis()), Long.toString(dayTtlMillis));
        return result == null ? -3 : result;
    }
}
