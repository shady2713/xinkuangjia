package com.basicframework.framework.ratelimiter.config;

import com.basicframework.framework.protection.support.ProtectionRedisTestSupport;
import com.basicframework.framework.ratelimiter.core.aop.RateLimiterAspect;
import com.basicframework.framework.ratelimiter.core.keyresolver.impl.ClientIpRateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.keyresolver.impl.DefaultRateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.keyresolver.impl.ExpressionRateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.keyresolver.impl.ServerNodeRateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.keyresolver.impl.UserRateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.redis.RateLimiterRedisDAO;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.redisson.api.RedissonClient;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证限流自动配置在最小上下文中装配出切面、Redis 访问对象与五个内置 Key 解析器。
 *
 * <p>限流 DAO 依赖的是 Redisson 客户端而不是字符串模板，注入错客户端时症状非常隐蔽（能创建 Bean、
 * 但令牌算在另一个实例上）。因此这里既确认 Bean 齐备，也确认装配出来的访问对象能在真实 Redisson
 * 上按注解参数发放与拒绝令牌。</p>
 *
 * @author shady2713
 */
class BasicFrameworkRateLimiterConfigurationTest extends ProtectionRedisTestSupport {

    /**
     * 验证限流相关的全部 Bean 都被注册，且类型正确。
     */
    @Test
    @DisplayName("限流自动配置注册切面、Redis 访问对象与五个内置 Key 解析器")
    void shouldRegisterAllRateLimiterBeans() {
        contextRunner().run(context -> {
            assertThat(context).hasSingleBean(RateLimiterAspect.class);
            assertThat(context).hasSingleBean(RateLimiterRedisDAO.class);
            assertThat(context).hasSingleBean(DefaultRateLimiterKeyResolver.class);
            assertThat(context).hasSingleBean(UserRateLimiterKeyResolver.class);
            assertThat(context).hasSingleBean(ClientIpRateLimiterKeyResolver.class);
            assertThat(context).hasSingleBean(ServerNodeRateLimiterKeyResolver.class);
            assertThat(context).hasSingleBean(ExpressionRateLimiterKeyResolver.class);
        });
    }

    /**
     * 验证装配出来的访问对象连到了注入的 Redisson 客户端，令牌按配置发放并在用尽后拒绝。
     */
    @Test
    @DisplayName("装配出来的限流 Redis 访问对象连到了注入的 Redisson 客户端")
    void shouldWireRedisDaoToInjectedRedissonClient() {
        String key = nextKey("config-wiring");
        contextRunner().run(context -> {
            RateLimiterRedisDAO rateLimiterRedisDAO = context.getBean(RateLimiterRedisDAO.class);

            assertThat(rateLimiterRedisDAO.tryAcquire(key, 1, 60, TimeUnit.SECONDS))
                    .as("配额内的第一次请求必须放行")
                    .isTrue();
            assertThat(rateLimiterRedisDAO.tryAcquire(key, 1, 60, TimeUnit.SECONDS))
                    .as("配额用尽后必须拒绝，证明令牌算在注入的那个实例上")
                    .isFalse();
        });
    }

    /**
     * 构造只装配被测自动配置的最小上下文，并把真实的 Redisson 客户端作为依赖注入。
     *
     * @return 最小上下文运行器
     */
    private ApplicationContextRunner contextRunner() {
        return new ApplicationContextRunner()
                .withBean(RedissonClient.class, () -> redissonClient)
                .withConfiguration(AutoConfigurations.of(BasicFrameworkRateLimiterConfiguration.class));
    }
}
