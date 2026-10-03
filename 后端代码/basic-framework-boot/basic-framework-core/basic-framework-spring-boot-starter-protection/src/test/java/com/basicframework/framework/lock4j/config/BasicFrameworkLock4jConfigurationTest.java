package com.basicframework.framework.lock4j.config;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants;
import com.basicframework.framework.lock4j.core.DefaultLockFailureStrategy;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证 lock4j 自动配置在最小上下文中装配出可用的获取锁失败策略。
 *
 * <p>该策略必须在 lock4j 自己的自动配置之前生效，否则框架的锁定异常会被 lock4j 的默认行为覆盖，
 * 接口就会返回 500 而不是可识别的业务错误码。这里用最小上下文确认 Bean 存在且行为正确。</p>
 *
 * @author shady2713
 */
class BasicFrameworkLock4jConfigurationTest {

    /** 只装配被测自动配置的最小上下文运行器。 */
    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(BasicFrameworkLock4jConfiguration.class));

    /**
     * 验证自动配置注册了唯一的获取锁失败策略 Bean。
     */
    @Test
    @DisplayName("自动配置注册唯一的获取锁失败策略 Bean")
    void shouldRegisterSingleLockFailureStrategyBean() {
        contextRunner.run(context -> assertThat(context).hasSingleBean(DefaultLockFailureStrategy.class));
    }

    /**
     * 验证装配出来的策略真正按框架约定抛出锁定异常。
     *
     * <p>只断言 Bean 存在无法排除“注册了一个空实现”的情况，因此直接验证对外行为。</p>
     */
    @Test
    @DisplayName("装配出来的获取锁失败策略按框架约定抛出锁定异常")
    void shouldProvideStrategyWithFrameworkLockError() {
        contextRunner.run(context -> {
            DefaultLockFailureStrategy strategy = context.getBean(DefaultLockFailureStrategy.class);

            assertThatThrownBy(() -> strategy.onLockFailure("lock-key", null, null))
                    .isInstanceOf(ServiceException.class)
                    .satisfies(exception -> assertThat(((ServiceException) exception).getCode())
                            .isEqualTo(GlobalErrorCodeConstants.LOCKED.getCode()));
        });
    }
}
