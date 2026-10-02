package com.basicframework.framework.ratelimiter.config;

import com.basicframework.framework.ratelimiter.core.aop.RateLimiterAspect;
import com.basicframework.framework.ratelimiter.core.keyresolver.RateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.keyresolver.impl.ClientIpRateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.keyresolver.impl.DefaultRateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.keyresolver.impl.ExpressionRateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.keyresolver.impl.ServerNodeRateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.keyresolver.impl.UserRateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.redis.RateLimiterRedisDAO;
import com.basicframework.framework.redis.config.BasicFrameworkRedisAutoConfiguration;
import org.redisson.api.RedissonClient;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Bean;

import java.util.List;

/**
 * 限流组件自动配置类，注册限流切面、Redis 访问对象和内置 Key 解析器。
 *
 * @author 李杰
 */
@AutoConfiguration(after = BasicFrameworkRedisAutoConfiguration.class)
public class BasicFrameworkRateLimiterConfiguration {

    /**
     * 创建限流切面，负责拦截 {@link com.basicframework.framework.ratelimiter.core.annotation.RateLimiter} 注解方法。
     *
     * @param keyResolvers        限流 Key 解析器集合
     * @param rateLimiterRedisDAO 限流 Redis 访问对象
     * @return 限流切面
     */
    @Bean
    public RateLimiterAspect rateLimiterAspect(List<RateLimiterKeyResolver> keyResolvers, RateLimiterRedisDAO rateLimiterRedisDAO) {
        return new RateLimiterAspect(keyResolvers, rateLimiterRedisDAO);
    }

    /**
     * 创建限流 Redis 访问对象。
     *
     * @param redissonClient Redisson 客户端
     * @return 限流 Redis 访问对象
     */
    @Bean
    @SuppressWarnings("SpringJavaInjectionPointsAutowiringInspection")
    public RateLimiterRedisDAO rateLimiterRedisDAO(RedissonClient redissonClient) {
        return new RateLimiterRedisDAO(redissonClient);
    }

    // ========== 各种 RateLimiterRedisDAO Bean ==========

    /**
     * 创建默认的全局级限流 Key 解析器。
     *
     * @return 默认限流 Key 解析器
     */
    @Bean
    public DefaultRateLimiterKeyResolver defaultRateLimiterKeyResolver() {
        return new DefaultRateLimiterKeyResolver();
    }

    /**
     * 创建用户级限流 Key 解析器。
     *
     * @return 用户级限流 Key 解析器
     */
    @Bean
    public UserRateLimiterKeyResolver userRateLimiterKeyResolver() {
        return new UserRateLimiterKeyResolver();
    }

    /**
     * 创建客户端 IP 级限流 Key 解析器。
     *
     * @return 客户端 IP 级限流 Key 解析器
     */
    @Bean
    public ClientIpRateLimiterKeyResolver clientIpRateLimiterKeyResolver() {
        return new ClientIpRateLimiterKeyResolver();
    }

    /**
     * 创建服务节点级限流 Key 解析器。
     *
     * @return 服务节点级限流 Key 解析器
     */
    @Bean
    public ServerNodeRateLimiterKeyResolver serverNodeRateLimiterKeyResolver() {
        return new ServerNodeRateLimiterKeyResolver();
    }

    /**
     * 创建基于 Spring EL 表达式的限流 Key 解析器。
     *
     * @return 表达式限流 Key 解析器
     */
    @Bean
    public ExpressionRateLimiterKeyResolver expressionRateLimiterKeyResolver() {
        return new ExpressionRateLimiterKeyResolver();
    }

}
