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
        // 发送前默认不做处理；需要改写消息头或记录发送上下文的实现自行覆写。
    }

    /**
     * 在消息发送完成后执行拦截处理。
     *
     * @param message 消息对象
     */
    default void sendMessageAfter(AbstractRedisMessage message) {
        // 发送后默认不做处理；需要落发送结果或清理上下文的实现自行覆写。
    }

    /**
     * 在消息消费前执行拦截处理。
     *
     * @param message 消息对象
     */
    default void consumeMessageBefore(AbstractRedisMessage message) {
        // 消费前默认不做处理；需要幂等校验或消费上下文预热的实现自行覆写。
    }

    /**
     * 在消息消费完成后执行拦截处理。
     *
     * @param message 消息对象
     */
    default void consumeMessageAfter(AbstractRedisMessage message) {
        // 消费后默认不做处理；需要清理消费上下文或记录结果的实现自行覆写。
    }

}
