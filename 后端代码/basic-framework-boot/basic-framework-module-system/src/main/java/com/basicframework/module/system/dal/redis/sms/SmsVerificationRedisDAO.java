package com.basicframework.module.system.dal.redis.sms;

import cn.hutool.crypto.digest.DigestUtil;
import com.basicframework.module.system.framework.sms.config.SmsCodeProperties;
import jakarta.annotation.Resource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * 短信验证的原子请求预算与错误预算，独立于业务数据库事务并在 Redis 故障时拒绝继续。
 *
 * @author shady2713
 */
@Repository
public class SmsVerificationRedisDAO {

    /** 同一散列槽允许集群环境对手机和 IP 两个预算原子计数。 */
    private static final String KEY_PREFIX = "sms_verify:{budget}:";

    /** 首次请求设置固定窗口，持续攻击不能延长窗口或重置已经发生的计数。 */
    private static final DefaultRedisScript<Long> REQUEST_SCRIPT = new DefaultRedisScript<>("""
            local mobile = redis.call('INCR', KEYS[1])
            if mobile == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
            local ip = redis.call('INCR', KEYS[2])
            if ip == 1 then redis.call('PEXPIRE', KEYS[2], ARGV[1]) end
            if mobile > tonumber(ARGV[2]) or ip > tonumber(ARGV[3]) then return 0 end
            return 1
            """, Long.class);

    /** 比较结果只传布尔值，Redis 不接收验证码；限额检查与错误增加在同一原子操作完成。 */
    private static final DefaultRedisScript<Long> FAILURE_SCRIPT = new DefaultRedisScript<>("""
            local failures = tonumber(redis.call('GET', KEYS[1]) or '0')
            if failures >= tonumber(ARGV[1]) then return 2 end
            if ARGV[2] == 'true' then return 1 end
            failures = redis.call('INCR', KEYS[1])
            if failures == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
            if failures >= tonumber(ARGV[1]) then return 2 end
            return 0
            """, Long.class);

    @Resource
    private StringRedisTemplate stringRedisTemplate;

    /**
     * 为本次验证同时计入手机和 IP 预算，成功、失败、过期和重放均使用此入口。
     *
     * @param mobile 目标手机号
     * @param clientIp 由可信服务端确定的客户端地址
     * @param properties 已校验的计数窗口及阈值
     * @return 是否仍在两个维度的请求预算内；Redis 失败直接传播
     */
    public boolean allowRequest(String mobile, String clientIp, SmsCodeProperties properties) {
        Long result = stringRedisTemplate.execute(REQUEST_SCRIPT,
                List.of(KEY_PREFIX + "mobile:" + DigestUtil.sha256Hex(mobile),
                        KEY_PREFIX + "ip:" + DigestUtil.sha256Hex(clientIp)),
                Long.toString(properties.getVerificationWindow().toMillis()),
                Integer.toString(properties.getVerificationMaximumPerMobile()),
                Integer.toString(properties.getVerificationMaximumPerIp()));
        return Long.valueOf(1).equals(result);
    }

    /**
     * 原子检查最新验证码的错误预算，并在本次不匹配时记入错误。
     *
     * @param mobile 目标手机号，与验证码编号共同限定当前挑战
     * @param codeId 当前验证码记录编号
     * @param matched 服务端恒定时间比较结果
     * @param lifetimeMillis 验证码配置有效期，错误记录从首次错误起保留至少该时长
     * @param maximumFailures 最大错误次数
     * @return 1 表示允许正确匹配，0 表示不匹配，2 表示预算耗尽；空结果失败关闭
     */
    public long checkFailureBudget(String mobile, Long codeId, boolean matched, long lifetimeMillis,
                                  int maximumFailures) {
        String key = KEY_PREFIX + "failure:" + DigestUtil.sha256Hex(mobile) + ":" + codeId;
        Long result = stringRedisTemplate.execute(FAILURE_SCRIPT, List.of(key),
                Integer.toString(maximumFailures), Boolean.toString(matched), Long.toString(lifetimeMillis));
        return result == null ? 2 : result;
    }
}
