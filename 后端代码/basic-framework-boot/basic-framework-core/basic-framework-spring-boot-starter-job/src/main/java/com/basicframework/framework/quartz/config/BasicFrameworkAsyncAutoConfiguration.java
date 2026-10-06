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
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-framework/yudao-spring-boot-starter-job/src/main/java/cn/
 * 上游文件续：iocoder/yudao/framework/quartz/config/YudaoAsyncAutoConfiguration.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 1 行，上游代码 1 行在本地被移除或改写，例如 @EnableAsync；本地补充注释 15 行，上游注释 1 行未保留。
 * 来源验收：尚未验收
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
