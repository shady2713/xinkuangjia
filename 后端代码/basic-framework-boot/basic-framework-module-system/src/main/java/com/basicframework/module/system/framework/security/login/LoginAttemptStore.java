package com.basicframework.module.system.framework.security.login;

import com.basicframework.framework.security.config.RedisUnavailableStrategy;
import com.basicframework.framework.security.config.SecurityProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * 登录尝试计数存储，统一封装 Redis 计数与 Redis 不可用时的降级行为。
 *
 * <p>正常路径把失败次数和锁定标记写入 Redis，保证多实例共享。Redis 读写异常时按
 * {@link SecurityProperties#getRedisUnavailableStrategy()} 处理：本地内存兜底保留当前实例的
 * 计数与锁定，失败关闭则把锁定检查视为已锁定。本地计数使用有界 LRU 并带过期时间，
 * 避免攻击者用大量不同账号撑大内存。</p>
 *
 * @author shady2713
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class LoginAttemptStore {

    /** 本地兜底最多保留的计数条目，超出后淘汰最久未使用的条目。 */
    private static final int MAX_LOCAL_ENTRIES = 10_000;

    private final SecurityProperties securityProperties;

    private final StringRedisTemplate stringRedisTemplate;

    /**
     * 本地兜底计数，按访问顺序淘汰；所有读写都在同步块内完成。
     */
    private final Map<String, LocalEntry> localEntries = new LinkedHashMap<>(16, 0.75f, true) {

        /**
         * 条目数超过上限时淘汰最久未使用的计数，控制内存占用。
         *
         * @param eldest 最久未使用的条目
         * @return 需要淘汰时返回 true
         */
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, LocalEntry> eldest) {
            return size() > MAX_LOCAL_ENTRIES;
        }
    };

    /**
     * 自增一次失败计数；首次自增时设置过期时间，与 Redis 计数语义保持一致。
     *
     * @param key 失败计数键
     * @param window 计数保留时长
     * @return 自增后的失败次数；计数不可用时返回 -1，调用方不得据此判定锁定
     */
    public long incrementFailure(String key, Duration window) {
        try {
            Long count = stringRedisTemplate.opsForValue().increment(key);
            if (count == null) {
                return -1;
            }
            if (count == 1L) {
                stringRedisTemplate.expire(key, window.toMillis(), TimeUnit.MILLISECONDS);
            }
            return count;
        } catch (RuntimeException ex) {
            log.warn("[login-attempt][Redis 失败计数不可用: {}]", ex.getClass().getSimpleName());
            return isLocalFallback() ? incrementLocal(key, window.toMillis()) : -1;
        }
    }

    /**
     * 判断锁定标记是否存在。
     *
     * <p>Redis 不可用且策略为失败关闭时返回 true，让调用方按已锁定处理，
     * 避免降级期间绕过暴力尝试保护。</p>
     *
     * @param key 锁定标记键
     * @return 已锁定返回 true
     */
    public boolean isLocked(String key) {
        try {
            return Boolean.TRUE.equals(stringRedisTemplate.hasKey(key));
        } catch (RuntimeException ex) {
            if (isLocalFallback()) {
                log.warn("[login-attempt][Redis 锁定状态不可读，使用本地兜底: {}]",
                        ex.getClass().getSimpleName());
                return existsLocal(key);
            }
            log.error("[login-attempt][Redis 锁定状态不可读，按失败关闭处理: {}]",
                    ex.getClass().getSimpleName());
            return true;
        }
    }

    /**
     * 写入锁定标记并设置过期时间。
     *
     * @param key 锁定标记键
     * @param duration 锁定时长
     */
    public void lock(String key, Duration duration) {
        try {
            stringRedisTemplate.opsForValue().set(key, "1", duration.toMillis(), TimeUnit.MILLISECONDS);
        } catch (RuntimeException ex) {
            if (isLocalFallback()) {
                log.warn("[login-attempt][Redis 锁定写入失败，使用本地兜底: {}]",
                        ex.getClass().getSimpleName());
                setLocal(key, duration.toMillis());
                return;
            }
            log.error("[login-attempt][Redis 锁定写入失败，等待恢复后重新判定: {}]",
                    ex.getClass().getSimpleName());
        }
    }

    /**
     * 查询锁定标记的剩余有效秒数。
     *
     * @param key 锁定标记键
     * @param fallbackDuration 无法读取剩余时间时使用的默认锁定时长
     * @return 剩余秒数，至少为 0
     */
    public long remainingSeconds(String key, Duration fallbackDuration) {
        try {
            Long seconds = stringRedisTemplate.getExpire(key, TimeUnit.SECONDS);
            if (seconds != null && seconds > 0) {
                return seconds;
            }
            return fallbackDuration.toSeconds();
        } catch (RuntimeException ex) {
            if (isLocalFallback()) {
                long localSeconds = remainingLocalSeconds(key);
                return localSeconds > 0 ? localSeconds : fallbackDuration.toSeconds();
            }
            return fallbackDuration.toSeconds();
        }
    }

    /**
     * 删除失败计数或锁定标记；Redis 异常时只记录日志，不阻断登录成功后的清理流程。
     *
     * @param key 计数或锁定键
     */
    public void delete(String key) {
        try {
            stringRedisTemplate.delete(key);
        } catch (RuntimeException ex) {
            log.warn("[login-attempt][Redis 计数清理失败: {}]", ex.getClass().getSimpleName());
        }
        deleteLocal(key);
    }

    /**
     * 判断是否启用本地内存兜底。
     *
     * @return 启用返回 true
     */
    private boolean isLocalFallback() {
        return securityProperties.getRedisUnavailableStrategy() == RedisUnavailableStrategy.LOCAL_FALLBACK;
    }

    /**
     * 在本地缓存中自增失败计数。
     *
     * @param key 失败计数键
     * @param windowMillis 计数保留毫秒数
     * @return 自增后的次数
     */
    private long incrementLocal(String key, long windowMillis) {
        long now = System.currentTimeMillis();
        synchronized (localEntries) {
            LocalEntry entry = localEntries.get(key);
            if (entry == null || entry.expireAt <= now) {
                entry = new LocalEntry(0L, now + windowMillis);
            }
            entry.count++;
            localEntries.put(key, entry);
            return entry.count;
        }
    }

    /**
     * 判断本地锁定标记是否存在且未过期。
     *
     * @param key 锁定标记键
     * @return 存在返回 true
     */
    private boolean existsLocal(String key) {
        synchronized (localEntries) {
            LocalEntry entry = localEntries.get(key);
            return entry != null && entry.expireAt > System.currentTimeMillis();
        }
    }

    /**
     * 写入本地锁定标记。
     *
     * @param key 锁定标记键
     * @param durationMillis 锁定时长毫秒数
     */
    private void setLocal(String key, long durationMillis) {
        synchronized (localEntries) {
            localEntries.put(key, new LocalEntry(1L, System.currentTimeMillis() + durationMillis));
        }
    }

    /**
     * 计算本地锁定标记的剩余秒数。
     *
     * @param key 锁定标记键
     * @return 剩余秒数；不存在或已过期返回 0
     */
    private long remainingLocalSeconds(String key) {
        synchronized (localEntries) {
            LocalEntry entry = localEntries.get(key);
            if (entry == null) {
                return 0L;
            }
            long remainingMillis = entry.expireAt - System.currentTimeMillis();
            return remainingMillis > 0 ? (remainingMillis + 999L) / 1000L : 0L;
        }
    }

    /**
     * 删除本地计数条目。
     *
     * @param key 计数或锁定键
     */
    private void deleteLocal(String key) {
        synchronized (localEntries) {
            localEntries.remove(key);
        }
    }

    /**
     * 本地兜底计数条目，记录次数和绝对过期时间。
     */
    private static class LocalEntry {

        /** 当前计数。 */
        private long count;

        /** 过期时间戳，单位毫秒。 */
        private long expireAt;

        /**
         * 构造计数条目。
         *
         * @param count 初始计数
         * @param expireAt 过期时间戳
         */
        private LocalEntry(long count, long expireAt) {
            this.count = count;
            this.expireAt = expireAt;
        }
    }
}
