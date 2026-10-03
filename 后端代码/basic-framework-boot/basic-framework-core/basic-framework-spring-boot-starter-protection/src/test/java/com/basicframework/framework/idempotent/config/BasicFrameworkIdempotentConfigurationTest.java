package com.basicframework.framework.idempotent.config;

import com.basicframework.framework.idempotent.core.aop.IdempotentAspect;
import com.basicframework.framework.idempotent.core.keyresolver.impl.DefaultIdempotentKeyResolver;
import com.basicframework.framework.idempotent.core.keyresolver.impl.ExpressionIdempotentKeyResolver;
import com.basicframework.framework.idempotent.core.keyresolver.impl.UserIdempotentKeyResolver;
import com.basicframework.framework.idempotent.core.redis.IdempotentRedisDAO;
import com.basicframework.framework.protection.support.ProtectionRedisTestSupport;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证幂等自动配置在最小上下文中装配出切面、Redis 访问对象与三个内置 Key 解析器。
 *
 * <p>自动配置的价值在于“接入即生效”，但漏注册一个解析器只会在业务注解引用它时才暴露成运行期异常。
 * 因此这里既确认 Bean 齐备，也确认装配出来的访问对象真的连到了注入的字符串模板，而不是空壳。</p>
 *
 * @author shady2713
 */
class BasicFrameworkIdempotentConfigurationTest extends ProtectionRedisTestSupport {

    /**
     * 验证幂等相关的全部 Bean 都被注册，且类型正确。
     */
    @Test
    @DisplayName("幂等自动配置注册切面、Redis 访问对象与三个内置 Key 解析器")
    void shouldRegisterAllIdempotentBeans() {
        contextRunner().run(context -> {
            assertThat(context).hasSingleBean(IdempotentAspect.class);
            assertThat(context).hasSingleBean(IdempotentRedisDAO.class);
            assertThat(context).hasSingleBean(DefaultIdempotentKeyResolver.class);
            assertThat(context).hasSingleBean(UserIdempotentKeyResolver.class);
            assertThat(context).hasSingleBean(ExpressionIdempotentKeyResolver.class);
        });
    }

    /**
     * 验证装配出来的 Redis 访问对象连到了注入的字符串模板，能在真实 Redis 上占位与释放。
     *
     * <p>只断言 Bean 存在无法排除“注入了另一个模板”的情况，因此直接观察真实 Key。</p>
     */
    @Test
    @DisplayName("装配出来的幂等 Redis 访问对象连到了注入的字符串模板")
    void shouldWireRedisDaoToInjectedTemplate() {
        String key = nextKey("config-wiring");
        contextRunner().run(context -> {
            IdempotentRedisDAO idempotentRedisDAO = context.getBean(IdempotentRedisDAO.class);

            assertThat(idempotentRedisDAO.setIfAbsent(key, 30, TimeUnit.SECONDS)).isTrue();
            assertThat(stringRedisTemplate.hasKey("idempotent:" + key))
                    .as("访问对象必须写入注入的那个模板所连接的实例")
                    .isTrue();
            idempotentRedisDAO.delete(key);
        });
    }

    /**
     * 构造只装配被测自动配置的最小上下文，并把真实的字符串模板作为依赖注入。
     *
     * @return 最小上下文运行器
     */
    private ApplicationContextRunner contextRunner() {
        return new ApplicationContextRunner()
                .withBean(StringRedisTemplate.class, () -> stringRedisTemplate)
                .withConfiguration(AutoConfigurations.of(BasicFrameworkIdempotentConfiguration.class));
    }
}
