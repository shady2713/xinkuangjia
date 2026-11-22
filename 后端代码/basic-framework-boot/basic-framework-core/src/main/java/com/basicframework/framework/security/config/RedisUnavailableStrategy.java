package com.basicframework.framework.security.config;

/**
 * Redis 不可用时认证安全能力采用的降级策略。
 *
 * <p>登录失败锁定、短信登录限流和访问令牌空闲校验都依赖 Redis。策略只决定
 * Redis 读写异常时的行为，不改变正常情况下基于 Redis 的共享状态。</p>
 *
 * @author shady2713
 */
public enum RedisUnavailableStrategy {

    /**
     * 失败关闭：Redis 不可用时按“已锁定/校验不通过”处理，宁可拒绝登录也不静默放行。
     */
    FAIL_CLOSED,

    /**
     * 本地内存计数兜底：Redis 不可用时由单实例内存继续计数和锁定。
     *
     * <p>该策略保证 Redis 故障期间仍能约束当前实例的暴力尝试，但无法跨实例共享计数；
     * 令牌空闲校验无法用单实例内存可靠还原其他实例的活动时间，仍按失败关闭处理。</p>
     */
    LOCAL_FALLBACK
}
