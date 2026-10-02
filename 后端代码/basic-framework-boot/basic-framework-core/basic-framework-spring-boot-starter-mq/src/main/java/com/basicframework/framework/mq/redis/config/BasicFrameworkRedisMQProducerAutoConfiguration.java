package com.basicframework.framework.mq.redis.config;

import com.basicframework.framework.mq.redis.core.RedisMQTemplate;
import com.basicframework.framework.mq.redis.core.interceptor.RedisMessageInterceptor;
import com.basicframework.framework.redis.config.BasicFrameworkRedisAutoConfiguration;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.List;

/**
 * Redis 消息队列 Producer 配置类
 *
 * @author 李杰
 */
@Slf4j
@AutoConfiguration(after = BasicFrameworkRedisAutoConfiguration.class)
public class BasicFrameworkRedisMQProducerAutoConfiguration {

    /**
     * 创建 Redis 消息发送模板并装配拦截器。
     *
     * @param redisTemplate redis模板参数
     * @param interceptors interceptors参数
     * @return 方法处理结果
     */
    @Bean
    public RedisMQTemplate redisMQTemplate(StringRedisTemplate redisTemplate,
                                           List<RedisMessageInterceptor> interceptors) {
        RedisMQTemplate redisMQTemplate = new RedisMQTemplate(redisTemplate);
        // 添加拦截器
        interceptors.forEach(redisMQTemplate::addInterceptor);
        return redisMQTemplate;
    }

}
