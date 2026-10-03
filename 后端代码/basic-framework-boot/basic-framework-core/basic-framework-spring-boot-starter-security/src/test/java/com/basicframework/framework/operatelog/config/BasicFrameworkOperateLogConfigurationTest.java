package com.basicframework.framework.operatelog.config;

import com.basicframework.framework.common.biz.system.logger.OperateLogCommonApi;
import com.basicframework.framework.common.biz.system.logger.dto.OperateLogCreateReqDTO;
import com.mzt.logapi.service.ILogRecordService;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证操作日志自动配置在真实容器中的装配结果。
 *
 * <p>第三方日志组件自身也会注册一个 {@link ILogRecordService} 实现，
 * 因此框架必须把自己的实现标记为首选，否则按类型注入会解析到第三方实现，
 * 操作日志将不再写入业务库。此处断言的就是这条实际生效的优先级边界。</p>
 *
 * @author shady2713
 */
class BasicFrameworkOperateLogConfigurationTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(BasicFrameworkOperateLogConfiguration.class))
            // 框架日志服务通过 @Resource 依赖操作日志 API，缺失时容器无法启动。
            .withBean(OperateLogCommonApi.class, () -> (OperateLogCreateReqDTO createReqDTO) -> {
            });

    /** 框架实现必须注册到容器，否则操作日志切面拿不到写入能力。 */
    @Test
    void frameworkLogRecordServiceIsRegistered() {
        contextRunner.run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context.getBeanNamesForType(ILogRecordService.class))
                    .as("容器内存在第三方与框架两个实现，框架实现必须存在")
                    .contains("iLogRecordServiceImpl");
        });
    }

    /** 按类型解析必须命中框架实现，否则日志会写到错误的实现里。 */
    @Test
    void frameworkImplementationWinsByTypeResolution() {
        contextRunner.run(context -> {
            ILogRecordService service = context.getBean(ILogRecordService.class);
            assertThat(service)
                    .as("按类型注入必须解析到框架实现")
                    .isInstanceOf(com.basicframework.framework.operatelog.core.service.LogRecordServiceImpl.class);
        });
    }

    /** 框架实现必须标记为首选，容器内存在多个候选时才能稳定命中。 */
    @Test
    void frameworkBeanIsPrimary() {
        contextRunner.run(context -> {
            String[] names = context.getBeanNamesForType(ILogRecordService.class);
            boolean frameworkIsPrimary = java.util.Arrays.stream(names)
                    .anyMatch(name -> "iLogRecordServiceImpl".equals(name)
                            && context.getBeanFactory().getBeanDefinition(name).isPrimary());
            assertThat(frameworkIsPrimary)
                    .as("框架实现必须标记为首选，否则按类型注入会解析到第三方实现")
                    .isTrue();
        });
    }

    /** 第三方实现必须同时存在，确认首选标记而非替换才是框架的设计意图。 */
    @Test
    void thirdPartyImplementationIsAlsoPresent() {
        contextRunner.run(context -> {
            assertThat(context.getBeanNamesForType(ILogRecordService.class))
                    .as("第三方日志组件自带实现，应与框架实现共存并由首选标记区分")
                    .hasSizeGreaterThanOrEqualTo(2);
        });
    }

    /** 重复获取必须返回同一实例，避免每次调用重新创建日志服务。 */
    @Test
    void repeatedResolutionReturnsSameInstance() {
        contextRunner.run(context -> {
            ILogRecordService first = context.getBean(ILogRecordService.class);
            assertThat(context.getBean(ILogRecordService.class)).isSameAs(first);
        });
    }

    /** 按类型注入的消费者必须拿到框架实现，验证首选标记在真实注入路径生效。 */
    @Test
    void injectedConsumerReceivesFrameworkService() {
        contextRunner.withUserConfiguration(ConsumerConfiguration.class)
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context.getBean(Consumer.class).logRecordService())
                            .isInstanceOf(
                                    com.basicframework.framework.operatelog.core.service.LogRecordServiceImpl.class);
                });
    }

    /** 消费者配置，验证按类型注入解析到框架实现。 */
    @Configuration(proxyBeanMethods = false)
    static class ConsumerConfiguration {

        /** 按类型注入日志服务。 */
        @Bean
        Consumer consumer(ILogRecordService logRecordService) {
            return new Consumer(logRecordService);
        }
    }

    /** 按类型注入的消费者。 */
    record Consumer(ILogRecordService logRecordService) {
    }
}
