package com.basicframework.framework.quartz.config;

import com.alibaba.ttl.TtlRunnable;
import org.springframework.beans.BeansException;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.core.task.SimpleAsyncTaskExecutor;

/**
 * 异步任务 Configuration
 * @author 李杰
 */
@AutoConfiguration
@EnableAsync
public class BasicFrameworkAsyncAutoConfiguration {

    /**
     * 创建用于统一线程池配置的 Bean 后置处理器。
     *
     * @return 方法处理结果
     * @throws BeansException 执行失败时抛出
     */
    @Bean
    public BeanPostProcessor threadPoolTaskExecutorBeanPostProcessor() {
        return new BeanPostProcessor() {

            /**
             * 执行后置处理BeforeInitialization。
             *
             * @param bean bean 参数
             * @param beanName beanName 参数
             * @return 方法处理结果
             * @throws BeansException 底层处理失败时抛出
             */
            @Override
            @SuppressWarnings("PatternVariableCanBeUsed")
            public Object postProcessBeforeInitialization(Object bean, String beanName) throws BeansException {
                // 处理 ThreadPoolTaskExecutor
                if (bean instanceof ThreadPoolTaskExecutor) {
                    ThreadPoolTaskExecutor executor = (ThreadPoolTaskExecutor) bean;
                    executor.setTaskDecorator(TtlRunnable::get);
                    return executor;
                }
                // 处理 SimpleAsyncTaskExecutor
                // 补充处理 SimpleAsyncTaskExecutor
                if (bean instanceof SimpleAsyncTaskExecutor) {
                    SimpleAsyncTaskExecutor executor = (SimpleAsyncTaskExecutor) bean;
                    executor.setTaskDecorator(TtlRunnable::get);
                    return executor;
                }
                return bean;
            }

        };
    }

}
