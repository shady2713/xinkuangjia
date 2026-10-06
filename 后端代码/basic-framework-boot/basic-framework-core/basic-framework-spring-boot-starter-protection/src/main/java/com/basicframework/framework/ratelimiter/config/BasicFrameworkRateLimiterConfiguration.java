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
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-framework/yudao-spring-boot-starter-protection/src/main/java/cn/
 * 上游文件续：iocoder/yudao/framework/ratelimiter/config/YudaoRateLimiterConfiguration.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地补充注释 38 行。
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
