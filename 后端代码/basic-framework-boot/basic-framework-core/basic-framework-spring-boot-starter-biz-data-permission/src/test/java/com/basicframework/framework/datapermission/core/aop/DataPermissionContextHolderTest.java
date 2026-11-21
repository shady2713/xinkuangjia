package com.basicframework.framework.datapermission.core.aop;

import com.alibaba.ttl.TtlRunnable;
import com.basicframework.framework.datapermission.core.annotation.DataPermission;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证 {@link DataPermissionContextHolder} 在 TTL 异步传递与并发复用场景下的独立快照隔离。
 *
 * @author shady2713
 */
class DataPermissionContextHolderTest {

    /** 清理当前线程上下文，防止用例间污染。 */
    @AfterEach
    void tearDown() {
        DataPermissionContextHolder.clear();
    }

    /** 验证异步任务捕获提交时刻的独立快照，父子线程后续压栈或出栈互不影响。 */
    @Test
    void ttlRunnableShouldCaptureIndependentSnapshot() throws Exception {
        DataPermission disabled = annotation("disabled");
        DataPermission enabled = annotation("enabled");
        DataPermissionContextHolder.add(disabled);

        CountDownLatch workerStarted = new CountDownLatch(1);
        CountDownLatch allowWorkerFinish = new CountDownLatch(1);
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Runnable wrapped = TtlRunnable.get(() -> {
                try {
                    assertThat(DataPermissionContextHolder.get()).isSameAs(disabled);
                    DataPermissionContextHolder.add(enabled);
                    assertThat(DataPermissionContextHolder.get()).isSameAs(enabled);
                    workerStarted.countDown();
                    assertThat(allowWorkerFinish.await(5, TimeUnit.SECONDS)).isTrue();
                    assertThat(DataPermissionContextHolder.getAll()).containsExactly(disabled, enabled);
                } catch (InterruptedException ex) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(ex);
                }
            });

            // 任务包装完成后父线程立即修改自身栈，不应影响已捕获的异步快照。
            DataPermissionContextHolder.remove();
            DataPermissionContextHolder.add(enabled);

            Future<?> future = executor.submit(wrapped);
            assertThat(workerStarted.await(5, TimeUnit.SECONDS)).isTrue();
            assertThat(DataPermissionContextHolder.getAll()).containsExactly(enabled);
            allowWorkerFinish.countDown();
            future.get(5, TimeUnit.SECONDS);
            assertThat(DataPermissionContextHolder.getAll()).containsExactly(enabled);
        } finally {
            executor.shutdownNow();
        }
    }

    /** 验证同一线程池复用于不同权限上下文任务时，不会串用或残留上次任务的禁用权限状态。 */
    @Test
    void reusedWorkerThreadShouldNotLeakPreviousContext() throws Exception {
        DataPermission disabled = annotation("disabled");
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            DataPermissionContextHolder.add(disabled);
            Future<Boolean> first = executor.submit(TtlRunnable.get(() -> {
                DataPermission current = DataPermissionContextHolder.get();
                DataPermissionContextHolder.add(annotation("enabled"));
                assertThat(current).isSameAs(disabled);
            }), Boolean.TRUE);
            assertThat(first.get(5, TimeUnit.SECONDS)).isTrue();

            DataPermissionContextHolder.clear();
            for (int i = 0; i < 6; i++) {
                Future<DataPermission> next = executor.submit(() -> DataPermissionContextHolder.get());
                assertThat(next.get(5, TimeUnit.SECONDS)).isNull();
            }
        } finally {
            executor.shutdownNow();
        }
    }

    /** 验证 {@link DataPermissionContextHolder#getAll()} 返回不可变副本且空栈移除安全。 */
    @Test
    void getAllShouldReturnImmutableSnapshotAndEmptyRemoveIsSafe() {
        DataPermission disabled = annotation("disabled");
        DataPermissionContextHolder.add(disabled);
        List<DataPermission> snapshot = DataPermissionContextHolder.getAll();
        assertThatThrownBy(() -> snapshot.add(annotation("enabled")))
                .isInstanceOf(UnsupportedOperationException.class);
        assertThat(DataPermissionContextHolder.remove()).isSameAs(disabled);
        assertThat(DataPermissionContextHolder.remove()).isNull();
    }

    /** 读取测试方法上声明的 {@link DataPermission} 注解实例。 */
    private static DataPermission annotation(String methodName) {
        try {
            return SampleAnnotatedMethods.class.getDeclaredMethod(methodName).getAnnotation(DataPermission.class);
        } catch (NoSuchMethodException ex) {
            throw new IllegalStateException(ex);
        }
    }

    /** 提供禁用与启用数据权限注解实例的测试声明类。 */
    private static final class SampleAnnotatedMethods {

        /** 声明关闭数据权限的样例方法。 */
        @DataPermission(enable = false)
        void disabled() {
        }

        /** 声明开启数据权限的样例方法。 */
        @DataPermission(enable = true)
        void enabled() {
        }
    }
}
