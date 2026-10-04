package com.basicframework.framework.redis.config;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.serializer.RedisSerializer;
import org.springframework.data.redis.serializer.SerializationException;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

/**
 * 验证 Redis 自动配置创建的模板与值序列化规则。
 *
 * <p>项目内所有缓存读写都复用该模板，序列化规则一旦漂移就会出现“写入方与读取方解析不同”的
 * 线上问题。用例锁定三条真实契约：键与哈希键使用字符串序列化（保证 Redis 里可读、可运维检索），
 * 值与哈希值使用同一套 JSON 规则；JSON 序列化器必须注册 {@code JavaTimeModule}，
 * 使 {@code LocalDateTime} 等 Java 8 时间类型能真正完成序列化与反序列化往返
 * （未注册时会直接抛无法序列化的异常）。</p>
 *
 * @author shady2713
 */
class BasicFrameworkRedisAutoConfigurationTest {

    /** 键使用字符串序列化，值与哈希值使用可处理时间类型的 JSON 序列化。 */
    @Test
    @SuppressWarnings("unchecked")
    void redisTemplateUsesStringKeysAndJsonValues() {
        RedisConnectionFactory factory = mock(RedisConnectionFactory.class);
        RedisTemplate<String, Object> template = new BasicFrameworkRedisAutoConfiguration().redisTemplate(factory);

        assertThat(template.getConnectionFactory()).as("必须持有传入的连接工厂").isSameAs(factory);
        RedisSerializer<String> keySerializer = (RedisSerializer<String>) template.getKeySerializer();
        RedisSerializer<String> hashKeySerializer = (RedisSerializer<String>) template.getHashKeySerializer();
        assertThat(new String(keySerializer.serialize("cache:user:1"), StandardCharsets.UTF_8))
                .as("键必须按原文本写入，便于在 Redis 中检索").isEqualTo("cache:user:1");
        assertThat(new String(hashKeySerializer.serialize("field"), StandardCharsets.UTF_8)).isEqualTo("field");

        Map<String, Object> value = new LinkedHashMap<>();
        value.put("name", "张三");
        RedisSerializer<Object> valueSerializer = (RedisSerializer<Object>) template.getValueSerializer();
        RedisSerializer<Object> hashValueSerializer = (RedisSerializer<Object>) template.getHashValueSerializer();
        byte[] valueBytes = valueSerializer.serialize(value);
        byte[] hashValueBytes = hashValueSerializer.serialize(value);
        assertThat(new String(valueBytes, StandardCharsets.UTF_8)).as("值必须是 JSON 文本").contains("\"name\"");
        assertThat(hashValueBytes).as("值与哈希值必须使用同一套 JSON 规则").isEqualTo(valueBytes);
    }

    /**
     * 值序列化器必须能写出 Java 8 时间类型，这是注册 JavaTimeModule 的真实目的。
     *
     * <p>未注册该模块时 Jackson 会直接抛“Java 8 date/time type not supported by default”，
     * 缓存写入当场失败。这里同时锁定可观察口径：时间按 Jackson 默认的时间戳数组写入，
     * 而不是 ISO 文本，运维在 Redis 中看到的就是该形态。</p>
     *
     * <p>另需注意真实边界：顶层时间值的字节不带类型信息，直接反序列化会因缺少类型标识
     * 而失败，因此缓存值必须是对象（时间作为字段），不能把裸时间当顶层值存。</p>
     */
    @Test
    @SuppressWarnings("unchecked")
    void valueSerializerWritesJavaTimeTypes() {
        RedisSerializer<Object> serializer = (RedisSerializer<Object>) BasicFrameworkRedisAutoConfiguration
                .buildRedisSerializer();
        LocalDateTime time = LocalDateTime.of(2024, 1, 2, 3, 4, 5);

        byte[] bytes = serializer.serialize(time);

        assertThat(new String(bytes, StandardCharsets.UTF_8)).as("时间按 Jackson 默认的时间戳数组写入")
                .isEqualTo("[2024,1,2,3,4,5]");
        assertThatThrownBy(() -> serializer.deserialize(bytes))
                .as("顶层时间值缺少类型标识，读取必须明确失败而不是返回错误类型")
                .isInstanceOf(SerializationException.class);
    }

    /** 缓存对象内嵌的时间字段同样必须完成往返，避免业务 DTO 缓存后读回时间失真。 */
    @Test
    @SuppressWarnings("unchecked")
    void valueSerializerRoundTripsObjectWithTimeField() {
        RedisSerializer<Object> serializer = (RedisSerializer<Object>) BasicFrameworkRedisAutoConfiguration
                .buildRedisSerializer();
        CachedValue value = new CachedValue();
        value.setCreatedAt(LocalDateTime.of(2024, 5, 6, 7, 8, 9));

        Object restored = serializer.deserialize(serializer.serialize(value));

        assertThat(restored).isInstanceOf(CachedValue.class);
        assertThat(((CachedValue) restored).getCreatedAt())
                .as("对象内的时间字段必须原样还原").isEqualTo(LocalDateTime.of(2024, 5, 6, 7, 8, 9));
    }

    /**
     * 缓存对象夹具，用于验证对象内嵌时间字段的序列化往返。
     *
     * @author shady2713
     */
    public static class CachedValue {

        /** 业务创建时间。 */
        private LocalDateTime createdAt;

        /**
         * 获取创建时间。
         *
         * @return 创建时间
         */
        public LocalDateTime getCreatedAt() {
            return createdAt;
        }

        /**
         * 设置创建时间。
         *
         * @param createdAt 创建时间
         */
        public void setCreatedAt(LocalDateTime createdAt) {
            this.createdAt = createdAt;
        }
    }

}
