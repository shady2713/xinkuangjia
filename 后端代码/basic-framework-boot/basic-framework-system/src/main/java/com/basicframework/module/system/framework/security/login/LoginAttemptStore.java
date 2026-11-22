package com.basicframework.module.system.framework.security.login;

import com.basicframework.framework.security.config.RedisUnavailableStrategy;
import com.basicframework.framework.security.config.SecurityProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * 登录尝试计数存储，统一封装 Redis 原子计数与 Redis 不可用时的隔离本地降级行为。
 *
 * <p>Redis 可用时通过单次 Lua 脚本完成 {@code INCR + PEXPIRE} 原子计数；本地内存兜底将
 * 失败计数池与已触发锁定池物理隔离，防止攻击者在 Redis 故障期间用海量随机不存在账号冲刷淘汰已锁定的高价值账号记录。</p>
 *
 * @author shady2713
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class LoginAttemptStore {

    /** 本地兜底单池最大条目数。 */
    static final int MAX_LOCAL_ENTRIES = 10_000;

    /** 原子自增并在首次创建时写入毫秒 TTL 的 Lua 脚本。 */
    private static final DefaultRedisScript<Long> ATOMIC_INCR_WITH_TTL_SCRIPT = new DefaultRedisScript<>(
            "local c = redis.call('INCR', KEYS[1]); "
                    + "if c == 1 or redis.call('PTTL', KEYS[1]) < 0 then "
                    + "redis.call('PEXPIRE', KEYS[1], ARGV[1]); "
                    + "end; "
                    + "return c;",
            Long.class);

    private final SecurityProperties securityProperties;

    private final StringRedisTemplate stringRedisTemplate;

    /** 本地兜底失败计数池（按访问顺序 LRU 淘汰）。 */
    private final Map<String, LocalEntry> localFailureEntries = createBoundedMap();

    /** 本地兜底已锁定标记独立池，与失败计数池隔离，防止随机账号刷计数挤出锁定记录。 */
    private final Map<String, LocalEntry> localLockEntries = createBoundedMap();

    /**
     * 创建带容量上限的 LRU 映射。
     *
     * @return 有界映射实例
     */
    private static Map<String, LocalEntry> createBoundedMap() {
        return new LinkedHashMap<>(16, 0.75f, true) {
            /** 超出单池上限时淘汰最久未使用的条目。 */
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, LocalEntry> eldest) {
                return size() > MAX_LOCAL_ENTRIES;
            }
        };
    }

    /**
     * 原子自增失败计数并确保窗口过期时间生效。
     *
     * @param key 失败计数键
     * @param window 计数保留时长
     * @return 自增后的失败次数；不可用且未启用本地兜底时返回 -1
     */
    public long incrementFailure(String key, Duration window) {
        try {
            Long count = stringRedisTemplate.execute(
                    ATOMIC_INCR_WITH_TTL_SCRIPT,
                    Collections.singletonList(key),
                    String.valueOf(window.toMillis()));
            return count != null ? count : -1L;
        } catch (RuntimeException ex) {
            log.warn("[login-attempt][Redis 失败计数不可用: {}]", ex.getClass().getSimpleName());
            return isLocalFallback() ? incrementLocal(key, window.toMillis()) : -1L;
        }
    }

    /**
     * 判断锁定标记是否存在。
     *
     * @param key 锁定标记键
     * @return 已锁定返回 true；失败关闭策略下 Redis 异常也返回 true
     */
    public boolean isLocked(String key) {
        try {
            return Boolean.TRUE.equals(stringRedisTemplate.hasKey(key));
        } catch (RuntimeException ex) {
            if (isLocalFallback()) {
                log.warn("[login-attempt][Redis 锁定状态不可读，使用本地兜底: {}]",
                        ex.getClass().getSimpleName());
                return existsLocalLock(key);
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
                setLocalLock(key, duration.toMillis());
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
     * @return 剩余秒数
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
                long localSeconds = remainingLocalLockSeconds(key);
                return localSeconds > 0 ? localSeconds : fallbackDuration.toSeconds();
            }
            return fallbackDuration.toSeconds();
        }
    }

    /**
     * 删除失败计数或锁定标记。
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
     */
    private boolean isLocalFallback() {
        return securityProperties.getRedisUnavailableStrategy() == RedisUnavailableStrategy.LOCAL_FALLBACK;
    }

    /**
     * 在本地失败计数池中自增计数。
     */
    private long incrementLocal(String key, long windowMillis) {
        long now = System.currentTimeMillis();
        synchronized (localFailureEntries) {
            LocalEntry entry = localFailureEntries.get(key);
            if (entry == null || entry.expireAt <= now) {
                entry = new LocalEntry(0L, now + windowMillis);
            }
            entry.count++;
            localFailureEntries.put(key, entry);
            return entry.count;
        }
    }

    /**
     * 判断本地独立锁定池中锁定标记是否有效。
     */
    private boolean existsLocalLock(String key) {
        long now = System.currentTimeMillis();
        synchronized (localLockEntries) {
            LocalEntry entry = localLockEntries.get(key);
            if (entry == null) {
                return false;
            }
            if (entry.expireAt <= now) {
                localLockEntries.remove(key);
                return false;
            }
            return true;
        }
    }

    /**
     * 写入本地独立锁定池；容量满前优先清理已过期锁定项。
     */
    private void setLocalLock(String key, long durationMillis) {
        long now = System.currentTimeMillis();
        synchronized (localLockEntries) {
            if (localLockEntries.size() >= MAX_LOCAL_ENTRIES) {
                Iterator<Map.Entry<String, LocalEntry>> it = localLockEntries.entrySet().iterator();
                while (it.hasNext()) {
                    if (it.next().getValue().expireAt <= now) {
                        it.remove();
                    }
                }
            }
            localLockEntries.put(key, new LocalEntry(1L, now + durationMillis));
        }
    }

    /**
     * 计算本地独立锁定池中锁定标记的剩余秒数。
     */
    private long remainingLocalLockSeconds(String key) {
        synchronized (localLockEntries) {
            LocalEntry entry = localLockEntries.get(key);
            if (entry == null) {
                return 0L;
            }
            long remainingMillis = entry.expireAt - System.currentTimeMillis();
            return remainingMillis > 0 ? (remainingMillis + 999L) / 1000L : 0L;
        }
    }

    /**
     * 同时从本地失败计数池和本地锁定池移除指定键。
     */
    private void deleteLocal(String key) {
        synchronized (localFailureEntries) {
            localFailureEntries.remove(key);
        }
        synchronized (localLockEntries) {
            localLockEntries.remove(key);
        }
    }

    /**
     * 本地兜底条目。
     */
    private static final class LocalEntry {

        private long count;
        private final long expireAt;

        /**
         * 创建本地计数或锁定记录。
         *
         * @param count 计数值
         * @param expireAt 过期毫秒时间戳
         */
        private LocalEntry(long count, long expireAt) {
            this.count = count;
            this.expireAt = expireAt;
        }
    }

}
