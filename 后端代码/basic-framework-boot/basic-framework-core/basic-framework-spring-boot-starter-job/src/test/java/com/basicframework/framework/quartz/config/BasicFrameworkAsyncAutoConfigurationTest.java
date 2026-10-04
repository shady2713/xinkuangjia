package com.basicframework.framework.quartz.config;

import com.alibaba.ttl.TtlRunnable;
import com.alibaba.ttl.TransmittableThreadLocal;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.core.task.SimpleAsyncTaskExecutor;
import org.springframework.core.task.TaskDecorator;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证异步线程池 Bean 后置处理器对任务装饰器的装配行为。
 *
 * <p>框架要求异步任务继承调用线程的上下文（尤其是安全上下文与链路标识），
 * 因此该后置处理器必须在 Bean 初始化前给线程池设置 TTL 任务装饰器。用例锁定四条约定：
 * {@link ThreadPoolTaskExecutor} 与 {@link SimpleAsyncTaskExecutor} 都被处理并返回同一实例
 * （替换实例会让容器持有旧引用）；装饰后的任务确实被包装成 TTL 可运行对象且执行时仍运行原任务；
 * 装饰器真正接到线程池的提交路径上——已存在的池线程能读到提交线程的 TTL 变量；
 * 其它类型的 Bean 原样返回，不能因为不匹配而丢失 Bean。</p>
 *
 * @author shady2713
 */
class BasicFrameworkAsyncAutoConfigurationTest {

    /** 两类线程池都必须装上 TTL 任务装饰器，并返回同一个 Bean 实例。 */
    @Test
    void postProcessorDecoratesBothExecutorTypesInPlace() throws Exception {
        BeanPostProcessor processor = new BasicFrameworkAsyncAutoConfiguration()
                .threadPoolTaskExecutorBeanPostProcessor();
        ThreadPoolTaskExecutor threadPool = new ThreadPoolTaskExecutor();
        SimpleAsyncTaskExecutor simpleExecutor = new SimpleAsyncTaskExecutor();

        Object processedThreadPool = processor.postProcessBeforeInitialization(threadPool, "taskExecutor");
        Object processedSimpleExecutor = processor.postProcessBeforeInitialization(simpleExecutor, "simpleExecutor");

        assertThat(processedThreadPool).as("必须返回原 Bean，替换实例会让容器持有旧引用").isSameAs(threadPool);
        assertThat(processedSimpleExecutor).isSameAs(simpleExecutor);
        assertThat(taskDecoratorOf(threadPool)).as("线程池必须装配任务装饰器").isNotNull();
        assertThat(taskDecoratorOf(simpleExecutor)).isNotNull();
    }

    /** 装饰器必须把任务包装成 TTL 可运行对象，并在执行时运行原任务。 */
    @Test
    void taskDecoratorWrapsTaskAndStillRunsIt() throws Exception {
        BeanPostProcessor processor = new BasicFrameworkAsyncAutoConfiguration()
                .threadPoolTaskExecutorBeanPostProcessor();
        ThreadPoolTaskExecutor threadPool = new ThreadPoolTaskExecutor();
        processor.postProcessBeforeInitialization(threadPool, "taskExecutor");
        AtomicBoolean executed = new AtomicBoolean();

        Runnable decorated = taskDecoratorOf(threadPool).decorate(() -> executed.set(true));

        assertThat(decorated).as("任务必须被包装为 TTL 可运行对象，否则异步线程读不到调用线程上下文")
                .isInstanceOf(TtlRunnable.class);
        decorated.run();
        assertThat(executed).as("包装后仍必须真正执行原任务").isTrue();
    }

    /**
     * 装饰器必须真正接到线程池提交路径上：已存在的池线程能读到提交线程的 TTL 变量。
     *
     * <p>先提交一次预热任务让池线程提前创建，避免子线程通过 {@code InheritableThreadLocal}
     * 天然继承变量而掩盖装饰器缺失；随后设置变量并再次提交，只有装饰器生效才能读到该值。</p>
     */
    @Test
    void taskDecoratorPropagatesThreadLocalToExistingPoolThread() throws Exception {
        BeanPostProcessor processor = new BasicFrameworkAsyncAutoConfiguration()
                .threadPoolTaskExecutorBeanPostProcessor();
        ThreadPoolTaskExecutor threadPool = new ThreadPoolTaskExecutor();
        threadPool.setCorePoolSize(1);
        threadPool.initialize();
        processor.postProcessBeforeInitialization(threadPool, "taskExecutor");
        TransmittableThreadLocal<String> traceHolder = new TransmittableThreadLocal<>();
        try {
            Future<String> warmUp = threadPool.submit(traceHolder::get);
            assertThat(warmUp.get(5, TimeUnit.SECONDS)).as("预热时尚未设置变量").isNull();

            traceHolder.set("trace-1");
            Future<String> propagated = threadPool.submit(traceHolder::get);
            assertThat(propagated.get(5, TimeUnit.SECONDS)).as("池线程必须读到提交线程的 TTL 变量")
                    .isEqualTo("trace-1");
        } finally {
            traceHolder.remove();
            threadPool.shutdown();
        }
    }

    /** 非线程池 Bean 原样返回，不因类型不匹配而丢失。 */
    @Test
    void postProcessorLeavesOtherBeansUntouched() throws Exception {
        BeanPostProcessor processor = new BasicFrameworkAsyncAutoConfiguration()
                .threadPoolTaskExecutorBeanPostProcessor();
        Object plainBean = new Object();

        assertThat(processor.postProcessBeforeInitialization(plainBean, "plainBean")).isSameAs(plainBean);
    }

    /**
     * 读取执行器已装配的任务装饰器。
     *
     * <p>两类执行器只提供 {@code setTaskDecorator}，没有公开读取入口，因此按真实字段名读取，
     * 以便断言装饰器确实被设置而不是仅调用了设置方法。</p>
     */
    private static TaskDecorator taskDecoratorOf(Object executor) {
        return (TaskDecorator) ReflectionTestUtils.getField(executor, "taskDecorator");
    }

}
