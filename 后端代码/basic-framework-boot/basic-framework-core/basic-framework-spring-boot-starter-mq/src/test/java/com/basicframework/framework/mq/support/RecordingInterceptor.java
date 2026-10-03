package com.basicframework.framework.mq.support;

import com.basicframework.framework.mq.redis.core.interceptor.RedisMessageInterceptor;
import com.basicframework.framework.mq.redis.core.message.AbstractRedisMessage;

import java.util.ArrayList;
import java.util.List;

/**
 * 把四个钩子的调用顺序记录下来的拦截器，用于断言发送与消费前后的执行顺序。
 *
 * <p>发送前钩子必须按注册顺序执行、发送后钩子必须按注册逆序执行，这样后注册的拦截器才能看到
 * 前一个拦截器已经补齐的消息头；顺序错了会让链路标识停留在错误的调用栈上。</p>
 *
 * @author shady2713
 */
public class RecordingInterceptor implements RedisMessageInterceptor {

    /**
     * 本拦截器名称，用于在共享事件列表中区分来源。
     */
    private final String name;

    /**
     * 与用例共享的事件列表，按真实发生顺序追加。
     */
    private final List<String> events;

    /**
     * 记录被钩子观察到的消息，用于确认拦截器拿到的是真实消息对象。
     */
    private final List<AbstractRedisMessage> observed = new ArrayList<>();

    /**
     * 创建记录型拦截器。
     *
     * @param name 拦截器名称
     * @param events 与用例共享的事件列表
     */
    public RecordingInterceptor(String name, List<String> events) {
        this.name = name;
        this.events = events;
    }

    /**
     * 记录发送前钩子被调用。
     *
     * @param message 被发送的消息
     */
    @Override
    public void sendMessageBefore(AbstractRedisMessage message) {
        observed.add(message);
        events.add(name + ".sendBefore");
    }

    /**
     * 记录发送后钩子被调用。
     *
     * @param message 被发送的消息
     */
    @Override
    public void sendMessageAfter(AbstractRedisMessage message) {
        observed.add(message);
        events.add(name + ".sendAfter");
    }

    /**
     * 记录消费前钩子被调用。
     *
     * @param message 被消费的消息
     */
    @Override
    public void consumeMessageBefore(AbstractRedisMessage message) {
        observed.add(message);
        events.add(name + ".consumeBefore");
    }

    /**
     * 记录消费后钩子被调用。
     *
     * @param message 被消费的消息
     */
    @Override
    public void consumeMessageAfter(AbstractRedisMessage message) {
        observed.add(message);
        events.add(name + ".consumeAfter");
    }

    /**
     * 读取被钩子观察到的消息。
     *
     * @return 按调用顺序排列的消息列表
     */
    public List<AbstractRedisMessage> observedMessages() {
        return observed;
    }
}
