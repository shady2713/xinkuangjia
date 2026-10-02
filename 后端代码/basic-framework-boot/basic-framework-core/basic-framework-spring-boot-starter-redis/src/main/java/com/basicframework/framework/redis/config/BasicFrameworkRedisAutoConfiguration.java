package com.basicframework.framework.redis.config;

import cn.hutool.core.util.ReflectUtil;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.redisson.spring.starter.RedissonAutoConfigurationV2;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.serializer.RedisSerializer;

/**
 * Redis 自动配置入口。
 *
 * <p>该配置创建项目内统一使用的 {@link RedisTemplate}，并统一采用 JSON 序列化规则，
 * 避免不同模块手工配置导致的序列化格式不一致。</p>
 *
 * @author 李杰
 */
@AutoConfiguration(before = RedissonAutoConfigurationV2.class)
public class BasicFrameworkRedisAutoConfiguration {

    /**
     * 创建 RedisTemplate Bean。
     * 使用 String 序列化 key/hash-key，Value 统一使用 JSON 序列化。
     *
     * @param factory redis 连接工厂
     * @return 已初始化的 RedisTemplate 实例
     */
    @Bean
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory factory) {
        // 创建 RedisTemplate 对象
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        // 设置 RedisConnection 工厂。😈 它就是实现多种 Java Redis 客户端接入的秘密工厂。感兴趣的胖友，可以自己去撸下。
        template.setConnectionFactory(factory);
        // 使用 String 序列化方式，序列化 KEY 。
        template.setKeySerializer(RedisSerializer.string());
        template.setHashKeySerializer(RedisSerializer.string());
        // 使用 JSON 序列化方式（库是 Jackson ），序列化 VALUE 。
        template.setValueSerializer(buildRedisSerializer());
        template.setHashValueSerializer(buildRedisSerializer());
        return template;
    }

    /**
     * 构建用于缓存值的 JSON 序列化器。
     * 通过反射补充 {@link JavaTimeModule} 以正确处理 Java 8 时间类型（如 LocalDateTime）。
     *
     * @return Redis 值序列化器
     */
    public static RedisSerializer<?> buildRedisSerializer() {
        RedisSerializer<Object> json = RedisSerializer.json();
        ObjectMapper objectMapper = (ObjectMapper) ReflectUtil.getFieldValue(json, "mapper");
        objectMapper.registerModules(new JavaTimeModule());
        return json;
    }

}
