package com.basicframework.framework.mq.redis.core.pubsub;

import cn.hutool.core.util.TypeUtil;
import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.framework.mq.redis.core.RedisMQTemplate;
import com.basicframework.framework.mq.redis.core.interceptor.RedisMessageInterceptor;
import com.basicframework.framework.mq.redis.core.message.AbstractRedisMessage;
import lombok.Setter;
import lombok.SneakyThrows;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;

import java.lang.reflect.Type;
import java.util.List;
import java.util.Objects;

/**
 * Redis Pub/Sub 监听器抽象类，用于实现广播消费
 *
 * @param <T> 消息类型。一定要填写噢，不然会报错
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
public abstract class AbstractRedisChannelMessageListener<T extends AbstractRedisChannelMessage> implements MessageListener {

    /**
     * 消息类型
     */
    private final Class<T> messageType;
    /**
     * Redis Channel
     */
    private final String channel;
    /**
     * RedisMQTemplate
     */
    @Setter
    private RedisMQTemplate redisMQTemplate;

    /**
     * 创建监听器，并根据泛型消息类型解析订阅频道。
     */
    @SneakyThrows
    protected AbstractRedisChannelMessageListener() {
        this.messageType = getMessageClass();
        this.channel = messageType.getDeclaredConstructor().newInstance().getChannel();
    }

    /**
     * 获得 Sub 订阅的 Redis Channel 通道
     *
     * @return channel
     */
    public final String getChannel() {
        return channel;
    }

    /**
     * 反序列化并消费 Pub/Sub 消息，最后逆序执行后置拦截器。
     *
     * @param message Redis 原始消息
     * @param bytes 频道模式信息
     */
    @Override
    public final void onMessage(Message message, byte[] bytes) {
        T messageObj = JsonUtils.parseObject(message.getBody(), messageType);
        try {
            consumeMessageBefore(messageObj);
            // 消费消息
            this.onMessage(messageObj);
        } finally {
            consumeMessageAfter(messageObj);
        }
    }

    /**
     * 处理消息
     *
     * @param message 消息
     */
    public abstract void onMessage(T message);

    /**
     * 通过解析类上的泛型，获得消息类型
     *
     * @return 消息类型
     */
    @SuppressWarnings("unchecked")
    private Class<T> getMessageClass() {
        Type type = TypeUtil.getTypeArgument(getClass(), 0);
        if (type == null) {
            throw new IllegalStateException(String.format("类型(%s) 需要设置消息类型", getClass().getName()));
        }
        return (Class<T>) type;
    }

    /**
     * 正序执行消费前拦截器。
     *
     * @param message Redis 消息
     * @throws NullPointerException 监听器尚未注入 RedisMQTemplate 时抛出
     */
    private void consumeMessageBefore(AbstractRedisMessage message) {
        RedisMQTemplate requiredTemplate = Objects.requireNonNull(
                redisMQTemplate, "RedisMQTemplate 尚未完成初始化");
        List<RedisMessageInterceptor> interceptors = requiredTemplate.getInterceptors();
        // 正序
        interceptors.forEach(interceptor -> interceptor.consumeMessageBefore(message));
    }

    /**
     * 逆序执行消费后拦截器。
     *
     * @param message Redis 消息
     * @throws NullPointerException 监听器尚未注入 RedisMQTemplate 时抛出
     */
    private void consumeMessageAfter(AbstractRedisMessage message) {
        RedisMQTemplate requiredTemplate = Objects.requireNonNull(
                redisMQTemplate, "RedisMQTemplate 尚未完成初始化");
        List<RedisMessageInterceptor> interceptors = requiredTemplate.getInterceptors();
        // 倒序
        for (int i = interceptors.size() - 1; i >= 0; i--) {
            interceptors.get(i).consumeMessageAfter(message);
        }
    }

}
