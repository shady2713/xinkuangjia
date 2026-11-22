package com.basicframework.framework.redis.config;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.serializer.RedisSerializer;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * 验证 {@link BasicFrameworkRedisAutoConfiguration} 的 JSON 序列化与 {@link RedisTemplate} 装配行为。
 *
 * @author shady2713
 */
class BasicFrameworkRedisAutoConfigurationTest {

    /**
     * 验证值序列化器支持包含 {@link LocalDateTime} 字段的对象往返序列化。
     */
    @Test
    @SuppressWarnings("unchecked")
    void serializerRoundTripsJavaTimeValue() {
        RedisSerializer<Object> serializer =
                (RedisSerializer<Object>) BasicFrameworkRedisAutoConfiguration.buildRedisSerializer();
        SampleCachePayload payload = new SampleCachePayload("token-1", LocalDateTime.of(2026, 11, 18, 21, 30, 0));

        byte[] serialized = serializer.serialize(payload);
        Object deserialized = serializer.deserialize(serialized);

        assertThat(deserialized).isInstanceOfSatisfying(SampleCachePayload.class, actual -> {
            assertThat(actual.getKey()).isEqualTo("token-1");
            assertThat(actual.getExpiresAt()).isEqualTo(payload.getExpiresAt());
        });
    }

    /**
     * 验证自动配置创建的 {@link RedisTemplate} 统一绑定字符串键序列化器与 JSON 值序列化器。
     */
    @Test
    void redisTemplateUsesStringKeysAndJsonValues() {
        BasicFrameworkRedisAutoConfiguration configuration = new BasicFrameworkRedisAutoConfiguration();
        RedisConnectionFactory connectionFactory = mock(RedisConnectionFactory.class);

        RedisTemplate<String, Object> template = configuration.redisTemplate(connectionFactory);

        assertThat(template.getConnectionFactory()).isSameAs(connectionFactory);
        assertThat(template.getKeySerializer()).isEqualTo(RedisSerializer.string());
        assertThat(template.getHashKeySerializer()).isEqualTo(RedisSerializer.string());
        assertThat(template.getValueSerializer()).isNotNull();
        assertThat(template.getHashValueSerializer()).isNotNull();
    }

    /**
     * 用于验证缓存 JSON 往返序列化的示例载荷。
     *
     * @author shady2713
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SampleCachePayload {

        private String key;
        private LocalDateTime expiresAt;

    }

}
