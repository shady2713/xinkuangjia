package com.basicframework.framework.ratelimiter.core.redis;

import cn.hutool.core.util.ObjUtil;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.redisson.api.*;

import java.time.Duration;
import java.util.concurrent.TimeUnit;

/**
 * 限流 Redis DAO
 *
 * @author 李杰
 */
@Slf4j
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
     * 限流配置重建锁的 Key 后缀
     *
     * KEY 格式：rate_limiter:%s:rebuild // 参数为 uuid
     * 仅在配置真变化的慢路径上创建，解锁即删除，不常驻 Redis
     */
    private static final String REBUILD_LOCK_SUFFIX = ":rebuild";

    /**
     * 重建锁的最长等待时长（秒）
     *
     * 重建本身只是一次配置读取加一次速率写入，正常在毫秒级完成，因此不需要长时间等待
     */
    private static final long REBUILD_LOCK_WAIT_SECONDS = 3L;

    /**
     * 重建锁的持有时长上限（秒）
     *
     * 使用固定租约而非看门狗续期：持有者崩溃时锁会自动释放，不会让后续改参请求被永久阻塞
     */
    private static final long REBUILD_LOCK_LEASE_SECONDS = 10L;

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
     * <p>动态改参是同一条竞争的另一半：限流器已存在时 {@code trySetRate} 对并发请求全部失败，它们会读到
     * 同一份旧配置、都判定“配置变了”并各自重建，同样清空已用配额。因此重建必须串行化：先原子创建；
     * 创建失败说明配置已存在，与本次声明一致就复用（不清空已用配额）；只有配置确实变化（含历史 Key
     * 缺少完整配置）才在分布式锁内二次比较后重建，使一次改参恰好重建一次。</p>
     *
     * <p>重建语义为“配置真正变化时按新参数重建并重置该 Key 的窗口”，窗口内可用次数恰好等于新
     * {@code count}。该语义不违反 R10（安全策略）：限流参数只来自服务端注解，客户端无法触发改参；
     * 重建由锁保证恰好一次，不会像修复前那样因重复重建把放行次数放大到 {@code count} 以上，调小配额时
     * 反而比保留旧窗口更严格。也不违反 R16（性能与资源约束）：锁只在改参的慢路径获取，持有时间是一次
     * 配置读取加一次速率写入，解锁即删除锁 Key，不新增常驻 Key，常规请求的 Redis 往返次数与修复前相同。</p>
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
        if (matchesDeclaredRate(rateLimiter.getConfig(), count, rateInterval)) {
            return rateLimiter;
        }
        // 3. 配置确实变化（或历史 Key 没有完整配置）：串行化重建，避免并发请求各自重建并互相清空已用配额
        return rebuildRate(rateLimiter, redisKey, count, rateInterval, duration);
    }

    /**
     * 在分布式锁内二次比较配置后重建限流速率，保证一次改参只重建一次。
     *
     * <p>只有配置真变化的请求会走到这里，因此锁不出现在常规请求路径上。锁内必须重新读取配置：先到的
     * 请求可能已经按同一份新参数完成重建，此时直接复用新窗口；若再次重建，Redisson 的 Lua 会删除消费
     * 记录，把新配额重新放大一遍。</p>
     *
     * <p>写入前还必须校验重建锁的租约此刻仍属于当前线程：锁用固定租约且不做看门狗续期，持有者若被长
     * 时间挂起（GC、线程调度、下游阻塞），锁会在租约到期后自动释放并被后继请求取得；旧持有者挂起结束
     * 继续写入时，服务端配置已被后继请求按同一份新参数写过一次，它的 {@code setRate} 会再次删除消费
     * 记录，把后继请求已经消耗掉的额度凭空还回去，{@code count=1} 也会放行两次。因此写入前用服务端持有
     * 关系（{@code HEXISTS 锁 Key 线程标识}，即 Redisson 的 {@code isHeldByCurrentThread}）确认自己仍是
     * 持有者；租约已失效就放弃重建，让新参数由后续请求的慢路径落地。</p>
     *
     * <p>未能取得锁、等待被中断或租约已失效时都不重建，直接沿用服务端已落盘配置：重建是清空已用配额的
     * 破坏性操作，宁可让新参数由后续请求的慢路径落地，也不能重复执行；期间放行次数仍受已落盘配置约束，
     * 不会超过任何一次声明过的配额。副作用是本次调用可能仍按旧配置放行，且不会刷新限流器过期时间。</p>
     *
     * <p>持有关系校验与写入之间仍隔着一次 Redis 往返，属于无法用 Redisson 公开 API 完全消除的窗口；但
     * 租约失效的真实成因是“持有者长时间挂起”，挂起结束后的第一次校验就会失败并放弃写入，因此该窗口
     * 只在客户端与 Redis 恰好于校验后瞬时失联时才可能出现。校验与释放各一次 {@code HEXISTS} 只发生在
     * 配置真变化的慢路径上，常规请求的 Redis 往返次数不变。</p>
     *
     * @param rateLimiter  待重建的限流器
     * @param redisKey     限流器 Redis Key，用于派生重建锁名称
     * @param count        本次声明的限流周期内允许次数
     * @param rateInterval 本次声明的限流周期（秒）
     * @param duration     本次声明的限流周期，用于重建速率与刷新过期时间
     * @return 配置为本次声明速率的限流器；未取得锁、等待被中断或租约已失效时返回沿用旧配置的限流器
     */
    private RRateLimiter rebuildRate(RRateLimiter rateLimiter, String redisKey, long count,
                                     long rateInterval, Duration duration) {
        RLock rebuildLock = redissonClient.getLock(redisKey + REBUILD_LOCK_SUFFIX);
        boolean locked;
        try {
            locked = rebuildLock.tryLock(REBUILD_LOCK_WAIT_SECONDS, REBUILD_LOCK_LEASE_SECONDS, TimeUnit.SECONDS);
        } catch (InterruptedException exception) {
            // 不吞掉中断：恢复中断标记后沿用已落盘配置，避免把线程中断伪装成一次成功改参
            Thread.currentThread().interrupt();
            log.warn("[rebuildRate][限流器({}) 等待重建锁被中断，本次沿用已落盘配置]", redisKey);
            return rateLimiter;
        }
        if (!locked) {
            // 未在等待时间内取得锁：说明其它节点正在重建，或锁尚未因租约到期自动释放，此时绝不重复重建
            log.warn("[rebuildRate][限流器({}) 未在 {} 秒内取得重建锁，本次沿用已落盘配置]",
                    redisKey, REBUILD_LOCK_WAIT_SECONDS);
            return rateLimiter;
        }
        try {
            // 锁内二次比较：先到请求可能已完成同一份新参数的重建，此时复用新窗口而不是再清空一次
            if (matchesDeclaredRate(rateLimiter.getConfig(), count, rateInterval)) {
                return rateLimiter;
            }
            // 写前校验持有者令牌：租约可能已到期并把锁交给后继请求，此时再写会清空后继已消耗的配额
            if (!rebuildLock.isHeldByCurrentThread()) {
                log.warn("[rebuildRate][限流器({}) 重建锁租约已失效，放弃本次重建，沿用已落盘配置]", redisKey);
                return rateLimiter;
            }
            rateLimiter.setRate(RateType.OVERALL, count, duration);
            // 额外设置过期时间，避免限流器 Key 长期残留
            rateLimiter.expire(duration);
            return rateLimiter;
        } finally {
            releaseRebuildLock(rebuildLock, redisKey);
        }
    }

    /**
     * 释放重建锁；锁已因租约到期自动释放时跳过解锁。
     *
     * <p>重建只需毫秒级，正常不会走到租约到期分支；但持有者若被长时间挂起，Redisson 的解锁会因当前
     * 线程不再持有锁而抛出 {@link IllegalMonitorStateException}，掩盖真正的限流结果，因此先确认持有关系。</p>
     *
     * @param rebuildLock 重建锁
     * @param redisKey    限流器 Redis Key，仅用于日志定位
     */
    private static void releaseRebuildLock(RLock rebuildLock, String redisKey) {
        if (rebuildLock.isHeldByCurrentThread()) {
            rebuildLock.unlock();
            return;
        }
        log.warn("[releaseRebuildLock][限流器({}) 重建锁租约已到期，跳过解锁]", redisKey);
    }

    /**
     * 判断服务端已落盘的限流配置是否与本次声明的速率和周期一致。
     *
     * <p>Redisson 对未创建的限流器也返回非空配置（{@code rate} 为 0、{@code type} 为默认值），因此必须
     * 逐项比较类型、速率与间隔，不能只判断配置对象是否为空。</p>
     *
     * @param config       服务端已落盘配置，可能为 null 或字段不完整
     * @param count        本次声明的限流周期内允许次数
     * @param rateInterval 本次声明的限流周期（秒）
     * @return true 表示服务端配置已是本次声明的参数，可复用当前窗口
     */
    private static boolean matchesDeclaredRate(RateLimiterConfig config, long count, long rateInterval) {
        return config != null
                && config.getRateType() == RateType.OVERALL
                && ObjUtil.equal(config.getRate(), count)
                && ObjUtil.equal(config.getRateInterval(), TimeUnit.SECONDS.toMillis(rateInterval));
    }

}
