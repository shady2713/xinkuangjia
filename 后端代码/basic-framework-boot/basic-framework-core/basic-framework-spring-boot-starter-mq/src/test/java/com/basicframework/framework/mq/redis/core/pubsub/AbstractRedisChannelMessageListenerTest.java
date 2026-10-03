package com.basicframework.framework.mq.redis.core.pubsub;

import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.framework.mq.redis.core.RedisMQTemplate;
import com.basicframework.framework.mq.redis.core.message.AbstractRedisMessage;
import com.basicframework.framework.mq.support.MqRedisTestSupport;
import com.basicframework.framework.mq.support.RecordingInterceptor;
import lombok.Getter;
import lombok.Setter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.DefaultMessage;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

/**
 * 验证 Pub/Sub 监听器的三个契约：频道由消息类型推导、拦截器按正序与逆序包住消费、未完成装配时拒绝消费。
 *
 * <p>未注入 {@code RedisMQTemplate} 时的失败分支尤其重要：消息头补全与审计都挂在拦截器上，
 * 如果这里放行，缺租户标识的消息会带着空上下文进入业务逻辑，而且不会有任何报错。</p>
 *
 * @author shady2713
 */
public class AbstractRedisChannelMessageListenerTest extends MqRedisTestSupport {

    /**
     * 验证无参构造按泛型消息类型解析订阅频道。
     *
     * <p>频道由消息类名决定，发布方与订阅方必须落在同一频道；解析失败会让容器订阅到错误频道，
     * 消息永远无人消费。</p>
     */
    @Test
    @DisplayName("无参构造按泛型消息类型解析订阅频道，频道与消息类型同名")
    void shouldResolveChannelFromMessageType() {
        ProbeListener listener = new ProbeListener();

        assertThat(listener.getChannel()).isEqualTo(ListenerProbeMessage.class.getSimpleName());
    }

    /**
     * 验证真实容器投递时，消息被反序列化、拦截器正序与逆序执行、扩展方拿到真实字段。
     *
     * <p>整条链路都用真实 Redis 投递，证明订阅频道、JSON 负载与注入的模板三者能对上。</p>
     */
    @Test
    @DisplayName("真实 Pub/Sub 投递后消息被反序列化，拦截器前置正序、后置逆序执行")
    void shouldConsumeDeliveredMessageWithInterceptorOrder() throws Exception {
        List<String> events = new CopyOnWriteArrayList<>();
        RedisMQTemplate producer = newRedisMQTemplate();
        ProbeListener listener = new ProbeListener();
        listener.setRedisMQTemplate(consumerTemplate(events));
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        container.addMessageListener(listener, new ChannelTopic(listener.getChannel()));
        container.afterPropertiesSet();
        container.start();
        try {
            ListenerProbeMessage message = new ListenerProbeMessage();
            message.setContent("delivered-payload");
            message.addHeader("tenant", "2048");
            await().atMost(20, TimeUnit.SECONDS).pollInterval(200, TimeUnit.MILLISECONDS).until(() -> {
                producer.send(message);
                return !listener.consumed.isEmpty();
            });

        } finally {
            container.stop();
            container.destroy();
        }

        // 订阅线程可能仍在追加事件，先取不可变快照再断言最后一次投递的完整顺序。
        List<String> snapshot = List.copyOf(events);
        assertThat(listener.consumed.get(0).getContent()).isEqualTo("delivered-payload");
        assertThat(listener.consumed.get(0).getHeader("tenant")).isEqualTo("2048");
        assertThat(snapshot.subList(Math.max(0, snapshot.size() - 4), snapshot.size()))
                .containsExactly("first.consumeBefore", "second.consumeBefore",
                        "second.consumeAfter", "first.consumeAfter");
    }

    /**
     * 验证未注入模板时消费抛出 {@link NullPointerException}，消息不会进入业务逻辑。
     *
     * <p>容器注册与模板注入是两步，若顺序颠倒，监听器会在空模板上开始消费。
     * 这里锁定异常类型与提示语，避免后续改成静默跳过。</p>
     */
    @Test
    @DisplayName("未注入 RedisMQTemplate 时消费抛出 NullPointerException，消息不进入扩展方逻辑")
    void shouldRejectConsumeBeforeTemplateInjection() {
        ProbeListener listener = new ProbeListener();
        DefaultMessage message = messageOf(new ListenerProbeMessage());

        assertThatThrownBy(() -> listener.onMessage(message, null))
                .isInstanceOf(NullPointerException.class)
                .hasMessage("RedisMQTemplate 尚未完成初始化");
        assertThat(listener.consumed).isEmpty();
    }

    /**
     * 验证未声明消息泛型时构造立即失败。
     *
     * <p>泛型擦除后无法确定消息类型，继续运行会把任意负载反序列化进错误的类型里，
     * 因此必须在注册监听器之前就失败。</p>
     */
    @Test
    @DisplayName("未声明消息泛型时构造抛出 IllegalStateException，不会注册到错误类型的监听器")
    void shouldFailWhenMessageTypeIsNotDeclared() {
        assertThatThrownBy(RawTypeListener::new)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("需要设置消息类型");
    }

    /**
     * 验证消费时使用模板当前持有的拦截器，运行期新增的拦截器同样生效。
     *
     * <p>拦截器列表是可变集合，若消费侧读取的是快照，多租户等运行期注册的扩展点会静默失效。</p>
     */
    @Test
    @DisplayName("消费使用模板当前的拦截器集合，运行期新增的拦截器立即生效")
    void shouldUseCurrentInterceptorsOfTemplate() {
        List<String> events = new ArrayList<>();
        ProbeListener listener = new ProbeListener();
        RedisMQTemplate template = newRedisMQTemplate();
        listener.setRedisMQTemplate(template);

        listener.onMessage(messageOf(new ListenerProbeMessage()), null);
        template.addInterceptor(new RecordingInterceptor("late", events));
        listener.onMessage(messageOf(new ListenerProbeMessage()), null);

        assertThat(events).as("注册前的消费不触发任何钩子，运行期新增的拦截器立即参与后续消费")
                .containsExactly("late.consumeBefore", "late.consumeAfter");
    }

    /**
     * 构造与生产同构的 Redis 原始消息。
     *
     * @param payload 待反序列化的业务消息
     * @return Redis Pub/Sub 原始消息
     */
    private static DefaultMessage messageOf(AbstractRedisMessage payload) {
        return new DefaultMessage(new byte[0], JsonUtils.toJsonString(payload).getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 创建带两个记录型拦截器的消费模板，用于验证消费前后的执行顺序。
     *
     * @param events 与用例共享的事件列表
     * @return 已注册拦截器的发送模板
     */
    private static RedisMQTemplate consumerTemplate(List<String> events) {
        RedisMQTemplate template = newRedisMQTemplate();
        template.addInterceptor(new RecordingInterceptor("first", events));
        template.addInterceptor(new RecordingInterceptor("second", events));
        return template;
    }

    /**
     * 声明了消息泛型的正常监听器。
     */
    static final class ProbeListener extends AbstractRedisChannelMessageListener<ListenerProbeMessage> {

        /**
         * 实际消费到的消息，用于断言反序列化结果。
         */
        private final List<ListenerProbeMessage> consumed = new CopyOnWriteArrayList<>();

        /**
         * 记录被扩展方真正消费到的消息。
         *
         * @param message 反序列化后的消息
         */
        @Override
        public void onMessage(ListenerProbeMessage message) {
            consumed.add(message);
        }
    }

    /**
     * 刻意擦除泛型的监听器，用于触发消息类型解析失败。
     */
    @SuppressWarnings("rawtypes")
    static final class RawTypeListener extends AbstractRedisChannelMessageListener {

        /**
         * 擦除泛型后只能按基类签名实现。
         *
         * @param message 反序列化后的消息
         */
        @Override
        public void onMessage(AbstractRedisChannelMessage message) {
        }
    }

    /**
     * 用于验证频道推导与反序列化的最小消息。
     * @author shady2713
     */
    @Getter
    @Setter
    public static final class ListenerProbeMessage extends AbstractRedisChannelMessage {

        /**
         * 业务负载。
         */
        private String content;
    }
}
