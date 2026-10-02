package com.basicframework.framework.idempotent.config;

import com.basicframework.framework.idempotent.core.aop.IdempotentAspect;
import com.basicframework.framework.idempotent.core.keyresolver.IdempotentKeyResolver;
import com.basicframework.framework.idempotent.core.keyresolver.impl.DefaultIdempotentKeyResolver;
import com.basicframework.framework.idempotent.core.keyresolver.impl.ExpressionIdempotentKeyResolver;
import com.basicframework.framework.idempotent.core.keyresolver.impl.UserIdempotentKeyResolver;
import com.basicframework.framework.idempotent.core.redis.IdempotentRedisDAO;
import com.basicframework.framework.redis.config.BasicFrameworkRedisAutoConfiguration;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.List;

/**
 * 幂等组件自动配置类，注册幂等切面、Redis 访问对象和内置 Key 解析器。
 *
 * @author 李杰
 */
@AutoConfiguration(after = BasicFrameworkRedisAutoConfiguration.class)
public class BasicFrameworkIdempotentConfiguration {

    /**
     * 创建幂等切面，负责拦截 {@link com.basicframework.framework.idempotent.core.annotation.Idempotent} 注解方法。
     *
     * @param keyResolvers       幂等 Key 解析器集合
     * @param idempotentRedisDAO 幂等 Redis 访问对象
     * @return 幂等切面
     */
    @Bean
    public IdempotentAspect idempotentAspect(List<IdempotentKeyResolver> keyResolvers, IdempotentRedisDAO idempotentRedisDAO) {
        return new IdempotentAspect(keyResolvers, idempotentRedisDAO);
    }

    /**
     * 创建幂等 Redis 访问对象。
     *
     * @param stringRedisTemplate 字符串 Redis 模板
     * @return 幂等 Redis 访问对象
     */
    @Bean
    public IdempotentRedisDAO idempotentRedisDAO(StringRedisTemplate stringRedisTemplate) {
        return new IdempotentRedisDAO(stringRedisTemplate);
    }

    // ========== 各种 IdempotentKeyResolver Bean ==========

    /**
     * 创建默认的全局级幂等 Key 解析器。
     *
     * @return 默认幂等 Key 解析器
     */
    @Bean
    public DefaultIdempotentKeyResolver defaultIdempotentKeyResolver() {
        return new DefaultIdempotentKeyResolver();
    }

    /**
     * 创建用户级幂等 Key 解析器。
     *
     * @return 用户级幂等 Key 解析器
     */
    @Bean
    public UserIdempotentKeyResolver userIdempotentKeyResolver() {
        return new UserIdempotentKeyResolver();
    }

    /**
     * 创建基于 Spring EL 表达式的幂等 Key 解析器。
     *
     * @return 表达式幂等 Key 解析器
     */
    @Bean
    public ExpressionIdempotentKeyResolver expressionIdempotentKeyResolver() {
        return new ExpressionIdempotentKeyResolver();
    }

}
