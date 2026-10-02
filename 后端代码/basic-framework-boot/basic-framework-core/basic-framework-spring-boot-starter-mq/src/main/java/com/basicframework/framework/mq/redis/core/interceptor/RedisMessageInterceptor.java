package com.basicframework.framework.mq.redis.core.interceptor;

import com.basicframework.framework.mq.redis.core.message.AbstractRedisMessage;

/**
 * {@link AbstractRedisMessage} 消息拦截器
 * 通过拦截器，作为插件机制，实现拓展。
 * 例如说，多租户场景下的 MQ 消息处理
 *
 * @author 李杰
 */
public interface RedisMessageInterceptor {

    /**
     * 在消息发送前执行拦截处理。
     *
     * @param message 消息对象
     */
    default void sendMessageBefore(AbstractRedisMessage message) {
    }

    /**
     * 在消息发送完成后执行拦截处理。
     *
     * @param message 消息对象
     */
    default void sendMessageAfter(AbstractRedisMessage message) {
    }

    /**
     * 在消息消费前执行拦截处理。
     *
     * @param message 消息对象
     */
    default void consumeMessageBefore(AbstractRedisMessage message) {
    }

    /**
     * 在消息消费完成后执行拦截处理。
     *
     * @param message 消息对象
     */
    default void consumeMessageAfter(AbstractRedisMessage message) {
    }

}
