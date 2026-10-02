package com.basicframework.framework.common.util.cache;

import com.google.common.cache.CacheLoader;
import com.google.common.cache.LoadingCache;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.time.Duration;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link CacheUtils} 异步刷新资源边界测试。
 *
 * @author 李杰
 */
class CacheUtilsTest {

    /**
     * 验证重复创建缓存时始终复用同一个有界执行器。
     */
    @Test
    void shouldReuseBoundedExecutorForAllAsyncCaches() {
        LoadingCache<String, String> first = CacheUtils.buildAsyncReloadingCache(
                Duration.ofMinutes(1), CacheLoader.from(value -> value));
        LoadingCache<String, String> second = CacheUtils.buildAsyncReloadingCache(
                Duration.ofMinutes(1), CacheLoader.from(value -> value));

        ThreadPoolExecutor executor = assertInstanceOf(ThreadPoolExecutor.class,
                CacheUtils.getAsyncReloadExecutor());

        assertSame(CacheUtils.getAsyncReloadExecutor(), executor);
        assertNotSame(first, second);
        assertEquals(executor.getCorePoolSize(), executor.getMaximumPoolSize());
        assertInstanceOf(ArrayBlockingQueue.class, executor.getQueue());
        assertTrue(executor.getQueue().remainingCapacity() >= 1);
        assertInstanceOf(ThreadPoolExecutor.CallerRunsPolicy.class, executor.getRejectedExecutionHandler());
    }

    /**
     * 验证刷新线程名称可识别，且守护线程不会阻止 JVM 关闭。
     */
    @Test
    void shouldCreateNamedDaemonThread() throws InterruptedException {
        CountDownLatch completed = new CountDownLatch(1);
        AtomicReference<String> threadName = new AtomicReference<>();
        AtomicBoolean daemon = new AtomicBoolean(false);

        CacheUtils.getAsyncReloadExecutor().execute(() -> {
            threadName.set(Thread.currentThread().getName());
            daemon.set(Thread.currentThread().isDaemon());
            completed.countDown();
        });

        assertTrue(completed.await(3, TimeUnit.SECONDS));
        assertTrue(threadName.get().startsWith("cache-async-reload-"));
        assertTrue(daemon.get());
    }

    /**
     * 验证队列饱和时使用调用方线程执行，而不是继续扩张线程或丢弃刷新任务。
     */
    @Test
    void shouldRunTaskInCallerWhenExecutorIsSaturated() throws InterruptedException {
        ThreadPoolExecutor executor = CacheUtils.createAsyncReloadExecutor(1, 1);
        CountDownLatch workerStarted = new CountDownLatch(1);
        CountDownLatch releaseWorker = new CountDownLatch(1);
        AtomicReference<String> fallbackThreadName = new AtomicReference<>();
        String callerThreadName = Thread.currentThread().getName();
        try {
            executor.execute(() -> {
                workerStarted.countDown();
                awaitUninterruptibly(releaseWorker);
            });
            assertTrue(workerStarted.await(3, TimeUnit.SECONDS));
            executor.execute(() -> awaitUninterruptibly(releaseWorker));

            executor.execute(() -> fallbackThreadName.set(Thread.currentThread().getName()));

            assertEquals(callerThreadName, fallbackThreadName.get());
            assertEquals(1, executor.getPoolSize());
        } finally {
            releaseWorker.countDown();
            executor.shutdownNow();
            assertTrue(executor.awaitTermination(3, TimeUnit.SECONDS));
        }
    }

    /**
     * 验证过期数据会在共享执行器中完成异步刷新。
     */
    @Test
    void shouldRefreshExpiredValueAsynchronously() throws InterruptedException {
        AtomicInteger loadCount = new AtomicInteger();
        CountDownLatch refreshed = new CountDownLatch(1);
        LoadingCache<String, Integer> cache = CacheUtils.buildAsyncReloadingCache(
                Duration.ofNanos(1), new CacheLoader<>() {
                    /**
                     * 记录实际加载次数，刷新完成后通知等待用例。
                     *
                     * @param key 缓存键
                     * @return 本次加载序号
                     */
                    @Override
                    public Integer load(String key) {
                        int value = loadCount.incrementAndGet();
                        if (value > 1) {
                            refreshed.countDown();
                        }
                        return value;
                    }
                });

        assertEquals(1, cache.getUnchecked("key"));
        cache.getUnchecked("key");

        assertTrue(refreshed.await(3, TimeUnit.SECONDS));
        assertTrue(loadCount.get() >= 2);
    }

    /**
     * 验证同步缓存保持按需加载和结果复用语义。
     */
    @Test
    void shouldBuildSynchronousCache() {
        AtomicInteger loadCount = new AtomicInteger();
        LoadingCache<String, Integer> cache = CacheUtils.buildCache(
                Duration.ofMinutes(1), CacheLoader.from(key -> loadCount.incrementAndGet()));

        assertEquals(1, cache.getUnchecked("key"));
        assertEquals(1, cache.getUnchecked("key"));
        assertEquals(1, loadCount.get());
    }

    /**
     * 验证工具类不能通过反射误创建实例。
     */
    @Test
    void shouldRejectUtilityClassInstantiation() throws NoSuchMethodException {
        Constructor<CacheUtils> constructor = CacheUtils.class.getDeclaredConstructor();
        constructor.setAccessible(true);

        InvocationTargetException exception = assertThrows(InvocationTargetException.class, constructor::newInstance);

        assertInstanceOf(UnsupportedOperationException.class, exception.getCause());
    }

    /**
     * 在测试执行器中等待释放信号，保持饱和场景可重复。
     *
     * @param latch 释放信号
     */
    private static void awaitUninterruptibly(CountDownLatch latch) {
        boolean interrupted = false;
        while (true) {
            try {
                latch.await();
                break;
            } catch (InterruptedException ignored) {
                interrupted = true;
            }
        }
        if (interrupted) {
            Thread.currentThread().interrupt();
        }
    }

}
