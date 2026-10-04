package com.basicframework.framework.common.biz.logger;

import com.basicframework.framework.common.biz.infra.logger.ApiAccessLogCommonApi;
import com.basicframework.framework.common.biz.infra.logger.ApiErrorLogCommonApi;
import com.basicframework.framework.common.biz.infra.logger.dto.ApiAccessLogCreateReqDTO;
import com.basicframework.framework.common.biz.infra.logger.dto.ApiErrorLogCreateReqDTO;
import com.basicframework.framework.common.biz.system.logger.OperateLogCommonApi;
import com.basicframework.framework.common.biz.system.logger.dto.OperateLogCreateReqDTO;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证三个日志 CommonApi 的「异步默认方法」契约：经真实 Spring 异步代理调用时，
 * 默认方法体交给异步执行器，并把原始 DTO 原样委派给同步方法。
 *
 * <p>三个接口的 {@code createXxxLogAsync} 都声明为 {@code @Async} 默认方法，
 * 调用方（访问日志、错误日志、操作日志切面）只依赖该入口，不自行提交线程池。若默认方法
 * 改回同步调用，日志写入会阻塞业务请求；若委派时复制或改写 DTO，日志内容会与真实请求不一致。
 * 因此这里用 {@code @EnableAsync} 的真实代理观察执行线程与收到的对象，而不是只断言注解存在。</p>
 *
 * @author shady2713
 */
class LoggerCommonApiAsyncContractTest {

    /** 等待异步委派完成的最长时间，超时按未异步或未委派处理。 */
    private static final long ASYNC_TIMEOUT_SECONDS = 5L;

    /** 访问日志：默认方法必须在异步线程执行，并把同一 DTO 实例交给同步方法。 */
    @Test
    @DisplayName("访问日志异步入口在异步线程委派同一 DTO")
    void apiAccessLogAsyncDelegatesOnAsyncThread() throws InterruptedException {
        CountDownLatch delegated = new CountDownLatch(1);
        AtomicReference<Thread> worker = new AtomicReference<>();
        AtomicReference<ApiAccessLogCreateReqDTO> received = new AtomicReference<>();
        ApiAccessLogCreateReqDTO createDTO = new ApiAccessLogCreateReqDTO();
        createDTO.setTraceId("trace-access-async");

        try (AnnotationConfigApplicationContext context = asyncContext(ApiAccessLogCommonApi.class,
                () -> (ApiAccessLogCommonApi) dto -> {
                    received.set(dto);
                    worker.set(Thread.currentThread());
                    delegated.countDown();
                })) {
            context.getBean(ApiAccessLogCommonApi.class).createApiAccessLogAsync(createDTO);

            assertThat(delegated.await(ASYNC_TIMEOUT_SECONDS, TimeUnit.SECONDS))
                    .as("异步默认方法必须在超时前完成委派").isTrue();
            assertThat(worker.get()).as("@Async 必须让默认方法体在异步执行器线程运行")
                    .isNotSameAs(Thread.currentThread());
            assertThat(received.get()).as("委派必须传递调用方传入的同一个 DTO 实例").isSameAs(createDTO);
        }
    }

    /** 错误日志：默认方法必须在异步线程执行，并把同一 DTO 实例交给同步方法。 */
    @Test
    @DisplayName("错误日志异步入口在异步线程委派同一 DTO")
    void apiErrorLogAsyncDelegatesOnAsyncThread() throws InterruptedException {
        CountDownLatch delegated = new CountDownLatch(1);
        AtomicReference<Thread> worker = new AtomicReference<>();
        AtomicReference<ApiErrorLogCreateReqDTO> received = new AtomicReference<>();
        ApiErrorLogCreateReqDTO createDTO = new ApiErrorLogCreateReqDTO();
        createDTO.setTraceId("trace-error-async");

        try (AnnotationConfigApplicationContext context = asyncContext(ApiErrorLogCommonApi.class,
                () -> (ApiErrorLogCommonApi) dto -> {
                    received.set(dto);
                    worker.set(Thread.currentThread());
                    delegated.countDown();
                })) {
            context.getBean(ApiErrorLogCommonApi.class).createApiErrorLogAsync(createDTO);

            assertThat(delegated.await(ASYNC_TIMEOUT_SECONDS, TimeUnit.SECONDS))
                    .as("异步默认方法必须在超时前完成委派").isTrue();
            assertThat(worker.get()).as("@Async 必须让默认方法体在异步执行器线程运行")
                    .isNotSameAs(Thread.currentThread());
            assertThat(received.get()).as("委派必须传递调用方传入的同一个 DTO 实例").isSameAs(createDTO);
        }
    }

    /** 操作日志：默认方法必须在异步线程执行，并把同一 DTO 实例交给同步方法。 */
    @Test
    @DisplayName("操作日志异步入口在异步线程委派同一 DTO")
    void operateLogAsyncDelegatesOnAsyncThread() throws InterruptedException {
        CountDownLatch delegated = new CountDownLatch(1);
        AtomicReference<Thread> worker = new AtomicReference<>();
        AtomicReference<OperateLogCreateReqDTO> received = new AtomicReference<>();
        OperateLogCreateReqDTO createDTO = new OperateLogCreateReqDTO();
        createDTO.setTraceId("trace-operate-async");

        try (AnnotationConfigApplicationContext context = asyncContext(OperateLogCommonApi.class,
                () -> (OperateLogCommonApi) dto -> {
                    received.set(dto);
                    worker.set(Thread.currentThread());
                    delegated.countDown();
                })) {
            context.getBean(OperateLogCommonApi.class).createOperateLogAsync(createDTO);

            assertThat(delegated.await(ASYNC_TIMEOUT_SECONDS, TimeUnit.SECONDS))
                    .as("异步默认方法必须在超时前完成委派").isTrue();
            assertThat(worker.get()).as("@Async 必须让默认方法体在异步执行器线程运行")
                    .isNotSameAs(Thread.currentThread());
            assertThat(received.get()).as("委派必须传递调用方传入的同一个 DTO 实例").isSameAs(createDTO);
        }
    }

    /**
     * 构造只开启异步能力的真实上下文，并把被测接口的替身注册为 Bean，以获得异步代理。
     *
     * @param apiType  被测 CommonApi 接口类型，代理必须按该接口暴露
     * @param delegate 同步方法的替身工厂，每次上下文刷新只创建一次实例
     * @param <T>      接口类型
     * @return 已刷新且持有 {@code apiType} 代理的上下文，由调用方负责关闭
     */
    private <T> AnnotationConfigApplicationContext asyncContext(Class<T> apiType, Supplier<T> delegate) {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.register(AsyncConfiguration.class);
        context.registerBean(apiType, delegate);
        context.refresh();
        return context;
    }

    /** 只提供真实 {@code @Async} 代理能力，不引入业务配置与其他外部依赖。 */
    @Configuration(proxyBeanMethods = false)
    @EnableAsync
    static class AsyncConfiguration {
    }

}
