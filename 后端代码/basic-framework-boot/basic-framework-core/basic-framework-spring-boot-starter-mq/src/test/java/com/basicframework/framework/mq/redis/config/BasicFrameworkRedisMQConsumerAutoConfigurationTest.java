package com.basicframework.framework.mq.redis.config;

import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 Redis Stream 消费组初始化的异常分类规则。
 *
 * @author 李杰
 */
class BasicFrameworkRedisMQConsumerAutoConfigurationTest {

    /**
     * 验证异常链中的 BUSYGROUP 被识别为消费组已存在。
     */
    @Test
    void shouldRecognizeExistingConsumerGroup() {
        RuntimeException redisCause = new RuntimeException("BUSYGROUP Consumer Group name already exists");
        DataAccessResourceFailureException exception =
                new DataAccessResourceFailureException("Redis command failed", redisCause);

        assertThat(BasicFrameworkRedisMQConsumerAutoConfiguration
                .isConsumerGroupAlreadyExists(exception)).isTrue();
    }

    /**
     * 验证普通连接异常不会被误判为消费组已存在。
     */
    @Test
    void shouldRejectUnrelatedRedisFailure() {
        DataAccessResourceFailureException exception =
                new DataAccessResourceFailureException("Redis connection refused");

        assertThat(BasicFrameworkRedisMQConsumerAutoConfiguration
                .isConsumerGroupAlreadyExists(exception)).isFalse();
    }
}
