package com.basicframework.module.system.framework.captcha.core;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证验证码缓存实现向 Redis 发出的真实命令与过期口径。
 *
 * <p>该实现是行为验证码的存储后端，缓存类型标识决定框架是否按 Redis 语义调用。
 * 写入必须带上以**秒**为单位的过期时间：单位写错会让验证码提前失效或长期留存；
 * 读取、存在性判断与删除必须命中同一个键；自增必须使用 Redis 原子自增并把增量透传，
 * 否则并发校验会重复计数。这些契约只体现在发出的 Redis 命令上，因此用模板替身逐条核对。</p>
 *
 * @author shady2713
 */
class RedisCaptchaServiceImplTest {

    /** 被测实现。 */
    private final RedisCaptchaServiceImpl captchaService = new RedisCaptchaServiceImpl();

    /** Redis 模板替身。 */
    private final StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);

    /** 值操作替身，用于核对读写命令参数。 */
    @SuppressWarnings("unchecked")
    private final ValueOperations<String, String> valueOperations = mock(ValueOperations.class);

    /** 缓存类型必须报告为 redis，框架据此选择 Redis 语义。 */
    @Test
    void typeIsRedis() {
        assertThat(captchaService.type()).isEqualTo("redis");
    }

    /** 写入必须带秒级过期时间，读取与存在性判断命中同一个键。 */
    @Test
    void setWritesWithSecondGranularityAndGetReadsSameKey() {
        injectTemplate();
        when(valueOperations.get("captcha:key")).thenReturn("DUMMY-CODE-VALUE");

        captchaService.set("captcha:key", "DUMMY-CODE-VALUE", 120L);

        verify(valueOperations).set("captcha:key", "DUMMY-CODE-VALUE", 120L, TimeUnit.SECONDS);
        assertThat(captchaService.get("captcha:key")).isEqualTo("DUMMY-CODE-VALUE");
    }

    /** 存在性判断与删除必须直接落到 Redis 键上。 */
    @Test
    void existsAndDeleteOperateOnSameKey() {
        injectTemplate();
        when(redisTemplate.hasKey("captcha:key")).thenReturn(true);

        assertThat(captchaService.exists("captcha:key")).isTrue();
        captchaService.delete("captcha:key");

        verify(redisTemplate).hasKey("captcha:key");
        verify(redisTemplate).delete("captcha:key");
    }

    /** 自增必须使用 Redis 原子自增并透传增量与返回值。 */
    @Test
    void incrementUsesAtomicRedisIncrement() {
        injectTemplate();
        when(valueOperations.increment("captcha:count", 2L)).thenReturn(3L);

        assertThat(captchaService.increment("captcha:count", 2L)).isEqualTo(3L);
        verify(valueOperations).increment("captcha:count", 2L);
    }

    /** 注入 Redis 模板替身并装配值操作替身。 */
    private void injectTemplate() {
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        captchaService.setStringRedisTemplate(redisTemplate);
    }

}
