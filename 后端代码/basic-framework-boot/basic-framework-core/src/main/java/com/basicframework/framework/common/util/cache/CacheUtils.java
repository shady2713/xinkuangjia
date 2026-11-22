package com.basicframework.framework.common.util.cache;

import com.google.common.cache.CacheBuilder;
import com.google.common.cache.CacheLoader;
import com.google.common.cache.LoadingCache;
import com.google.common.util.concurrent.ThreadFactoryBuilder;

import java.time.Duration;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * Cache 工具类
 *
 * @author 李杰
 */
public final class CacheUtils {

    /**
     * 异步刷新的 LoadingCache 最大缓存数量
     *
     * @see <a href="">本地缓存 CacheUtils 工具类建议</a>
     */
    private static final int CACHE_MAX_SIZE = 10000;

    /** 缓存刷新线程数 JVM 参数名。 */
    private static final String ASYNC_RELOAD_POOL_SIZE_PROPERTY = "basic.cache.async-reload.pool-size";

    /** 缓存刷新排队容量 JVM 参数名。 */
    private static final String ASYNC_RELOAD_QUEUE_CAPACITY_PROPERTY = "basic.cache.async-reload.queue-capacity";

    /** 缓存刷新线程数上限，可通过 JVM 参数调整，且至少保留一个工作线程。 */
    private static final int ASYNC_RELOAD_POOL_SIZE = Math.max(1, Integer.getInteger(
            ASYNC_RELOAD_POOL_SIZE_PROPERTY,
            Math.max(2, Math.min(4, Runtime.getRuntime().availableProcessors()))));

    /** 缓存刷新排队上限，可通过 JVM 参数调整，且不允许改成无界队列。 */
    private static final int ASYNC_RELOAD_QUEUE_CAPACITY = Math.max(1,
            Integer.getInteger(ASYNC_RELOAD_QUEUE_CAPACITY_PROPERTY, 256));

    /**
     * 所有异步缓存共享的有界执行器。
     *
     * <p>队列饱和时由提交线程执行刷新任务，以限制峰值资源使用并保留刷新语义。守护线程不会阻止 JVM 正常退出。</p>
     */
    private static final ThreadPoolExecutor ASYNC_RELOAD_EXECUTOR = createAsyncReloadExecutor(
            ASYNC_RELOAD_POOL_SIZE, ASYNC_RELOAD_QUEUE_CAPACITY);

    /**
     * 禁止外部实例化 CacheUtils。
     */
    private CacheUtils() {
        throw new UnsupportedOperationException("工具类不允许实例化");
    }

    /**
     * 构建异步刷新的 LoadingCache 对象
     *
     * 注意：如果你的缓存和 ThreadLocal 有关系，要么自己处理 ThreadLocal 的传递，要么使用 {@link #buildCache(Duration, CacheLoader)} 方法
     *
     * 或者简单理解：
     * 1、和“人”相关的，使用 {@link #buildCache(Duration, CacheLoader)} 方法
     * 2、和“全局”、“系统”相关的，使用当前缓存方法
     *
     * @param duration 过期时间
     * @param loader  CacheLoader 对象
     * @return LoadingCache 对象
     */
    public static <K, V> LoadingCache<K, V> buildAsyncReloadingCache(Duration duration, CacheLoader<K, V> loader) {
        return CacheBuilder.newBuilder()
                .maximumSize(CACHE_MAX_SIZE)
                // 只阻塞当前数据加载线程，其他线程返回旧值
                .refreshAfterWrite(duration)
                // 共享有界执行器，防止每个缓存创建独立的无界线程池。
                .build(CacheLoader.asyncReloading(loader, ASYNC_RELOAD_EXECUTOR));
    }

    /**
     * 构建同步刷新的 LoadingCache 对象
     *
     * @param duration 过期时间
     * @param loader  CacheLoader 对象
     * @return LoadingCache 对象
     */
    public static <K, V> LoadingCache<K, V> buildCache(Duration duration, CacheLoader<K, V> loader) {
        return CacheBuilder.newBuilder()
                .maximumSize(CACHE_MAX_SIZE)
                // 只阻塞当前数据加载线程，其他线程返回旧值
                .refreshAfterWrite(duration)
                .build(loader);
    }

    /**
     * 返回异步刷新执行器，仅供同包单元测试验证资源边界。
     *
     * @return 共享执行器
     */
    static Executor getAsyncReloadExecutor() {
        return ASYNC_RELOAD_EXECUTOR;
    }

    /**
     * 创建有界缓存刷新执行器，方便用独立实例验证饱和回退行为。
     *
     * @param poolSize 固定线程数
     * @param queueCapacity 排队容量
     * @return 有界缓存刷新执行器
     */
    static ThreadPoolExecutor createAsyncReloadExecutor(int poolSize, int queueCapacity) {
        return new ThreadPoolExecutor(
                poolSize,
                poolSize,
                0L,
                TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(queueCapacity),
                new ThreadFactoryBuilder().setNameFormat("cache-async-reload-%d").setDaemon(true).build(),
                new ThreadPoolExecutor.CallerRunsPolicy());
    }

}
