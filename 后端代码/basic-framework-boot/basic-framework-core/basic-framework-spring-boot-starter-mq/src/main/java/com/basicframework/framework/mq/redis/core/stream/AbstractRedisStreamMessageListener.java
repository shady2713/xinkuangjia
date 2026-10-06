package com.basicframework.framework.mq.redis.core.stream;

import cn.hutool.core.util.TypeUtil;
import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.framework.mq.redis.core.RedisMQTemplate;
import com.basicframework.framework.mq.redis.core.interceptor.RedisMessageInterceptor;
import com.basicframework.framework.mq.redis.core.message.AbstractRedisMessage;
import lombok.Getter;
import lombok.Setter;
import lombok.SneakyThrows;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.connection.stream.ObjectRecord;
import org.springframework.data.redis.stream.StreamListener;

import java.lang.reflect.Type;
import java.util.List;
import java.util.Objects;

/**
 * Redis Stream 监听器抽象类，用于实现集群消费
 *
 * @param <T> 消息类型。一定要填写噢，不然会报错
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
public abstract class AbstractRedisStreamMessageListener<T extends AbstractRedisStreamMessage>
        implements StreamListener<String, ObjectRecord<String, String>> {

    /**
     * 消息类型
     */
    private final Class<T> messageType;
    /**
     * Redis Channel
     */
    @Getter
    private final String streamKey;

    /**
     * Redis 消费者分组，默认使用 spring.application.name 名字
     */
    @Value("${spring.application.name}")
    @Getter
    private String group;
    /**
     * RedisMQTemplate
     */
    @Setter
    private RedisMQTemplate redisMQTemplate;

    /**
     * 创建监听器，并根据泛型消息类型解析 Stream Key。
     */
    @SneakyThrows
    protected AbstractRedisStreamMessageListener() {
        this.messageType = getMessageClass();
        this.streamKey = messageType.getDeclaredConstructor().newInstance().getStreamKey();
    }

    /**
     * 创建指定 Stream Key 与消费组的监听器，主要用于框架扩展和测试。
     *
     * @param streamKey Stream Key
     * @param group 消费组
     */
    protected AbstractRedisStreamMessageListener(String streamKey, String group) {
        this.messageType = null;
        this.streamKey = streamKey;
        this.group = group;
    }

    /**
     * 反序列化并消费 Stream 消息，成功后确认消息，最后逆序执行后置拦截器。
     *
     * @param message Redis Stream 原始消息
     */
    @Override
    public void onMessage(ObjectRecord<String, String> message) {
        // 消费消息
        T messageObj = JsonUtils.parseObject(message.getValue(), messageType);
        try {
            consumeMessageBefore(messageObj);
            // 消费消息
            this.onMessage(messageObj);
            // ack 消息消费完成
            redisMQTemplate.getRedisTemplate().opsForStream().acknowledge(group, message);
            // 当前实现仅覆盖成功消费后的确认；异常重试、消费日志、事务协同和幂等治理按统一消息治理策略再扩展。
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
     * 解析并校验监听器声明的泛型消息类型。
     *
     * <p>漏写消息泛型时，Hutool 会从已实现的 {@code StreamListener} 接口解析出非空的 {@code String.class}，
     * 因此仅判空无法识别配置错误，必须确认解析结果是可赋值给 {@link AbstractRedisStreamMessage} 的类。</p>
     *
     * @return 可赋值给 AbstractRedisStreamMessage 的消息类
     * @throws IllegalStateException 未声明有效消息类型时抛出，包含监听器类名及实际解析类型
     */
    @SuppressWarnings("unchecked")
    private Class<T> getMessageClass() {
        Type type = TypeUtil.getTypeArgument(getClass(), 0);
        if (!(type instanceof Class<?>) || !AbstractRedisStreamMessage.class.isAssignableFrom((Class<?>) type)) {
            throw new IllegalStateException(String.format("类型(%s) 需要设置消息类型，实际解析到的类型(%s)",
                    getClass().getName(), type));
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
