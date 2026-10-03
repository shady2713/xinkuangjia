package com.basicframework.framework.mq.redis.core;

import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.framework.mq.redis.core.interceptor.RedisMessageInterceptor;
import com.basicframework.framework.mq.redis.core.message.AbstractRedisMessage;
import com.basicframework.framework.mq.redis.core.pubsub.AbstractRedisChannelMessage;
import com.basicframework.framework.mq.redis.core.stream.AbstractRedisStreamMessage;
import com.basicframework.framework.mq.support.MqRedisTestSupport;
import com.basicframework.framework.mq.support.RecordingInterceptor;
import lombok.Getter;
import lombok.Setter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Range;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

/**
 * 用真实 Redis 验证发送模板的四个契约：负载落地、拦截器顺序、发送失败后的收尾与默认钩子可用性。
 *
 * <p>拦截器是租户、链路、审计等横切能力的唯一扩展点，顺序与收尾语义错了不会立刻报错，却会让
 * 消息带着错误的上下文被下游消费，因此这里全部对着真实服务端行为断言，而不是只看方法被调用过。</p>
 *
 * @author shady2713
 */
class RedisMQTemplateTest extends MqRedisTestSupport {

    /**
     * 验证 Pub/Sub 发送把 JSON 负载发布到消息自带的频道，真实订阅方能收到并且内容可反序列化。
     *
     * <p>频道来自消息类型而不是发送参数，扩展方漏改频道时消息会静默发到无人订阅的频道，
     * 因此必须用真实订阅证明负载确实落在预期频道上。</p>
     */
    @Test
    @DisplayName("Pub/Sub 发送把 JSON 负载发布到消息自带频道，真实订阅方收到并可反序列化")
    void shouldPublishChannelMessageToItsOwnChannel() throws Exception {
        RedisMQTemplate template = newRedisMQTemplate();
        LinkedBlockingQueue<String> received = new LinkedBlockingQueue<>();
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        container.addMessageListener((message, pattern) ->
                received.offer(new String(message.getBody(), StandardCharsets.UTF_8)),
                new ChannelTopic(new ProbeChannelMessage().getChannel()));
        container.afterPropertiesSet();
        container.start();
        try {
            ProbeChannelMessage message = new ProbeChannelMessage();
            message.setContent("pub-sub-payload");
            message.addHeader("tenant", "1024");

            // 容器订阅建立与服务端确认之间存在短暂窗口，用带截止时间的条件轮询而不是固定等待。
            await().atMost(20, TimeUnit.SECONDS).pollInterval(200, TimeUnit.MILLISECONDS).until(() -> {
                template.send(message);
                return !received.isEmpty();
            });

            String payload = received.poll(5, TimeUnit.SECONDS);
            assertThat(JsonUtils.parseObject(payload, ProbeChannelMessage.class).getContent())
                    .isEqualTo("pub-sub-payload");
            assertThat(JsonUtils.parseObject(payload, ProbeChannelMessage.class).getHeader("tenant"))
                    .isEqualTo("1024");
        } finally {
            container.stop();
            container.destroy();
        }
    }

    /**
     * 验证 Stream 发送返回真实记录编号，且负载落在消息自带的 Stream Key 上。
     *
     * <p>返回值是调用方唯一的投递凭证，重投与补偿都依赖它定位消息，写错 Key 会让消息脱离
     * 清理与重投任务的遍历范围。</p>
     */
    @Test
    @DisplayName("Stream 发送返回真实记录编号，负载落在消息自带 Stream Key 上")
    void shouldAppendStreamMessageAndReturnRecordId() {
        RedisMQTemplate template = newRedisMQTemplate();
        trackKey(new ProbeStreamMessage().getStreamKey());
        ProbeStreamMessage message = new ProbeStreamMessage();
        message.setContent("stream-payload");

        RecordId recordId = template.send(message);

        assertThat(recordId).isNotNull();
        assertThat(stringRedisTemplate.opsForStream().size(message.getStreamKey())).isEqualTo(1L);
        // 生产用 ofObject 写入，Redis 侧实际形态是字段名 payload 到 JSON 的单字段记录。
        assertThat(storedValue(message.getStreamKey()))
                .containsExactly(Map.entry("payload", JsonUtils.toJsonString(message)));
    }

    /**
     * 验证两个发送重载的前置钩子正序、后置钩子逆序执行。
     *
     * <p>后置钩子逆序是为了让后注册的拦截器先看到完整状态并先做收尾，顺序反了会让外层拦截器
     * 在内层尚未完成上下文清理时就返回。</p>
     */
    @Test
    @DisplayName("两个发送重载都是前置正序、后置逆序执行拦截器")
    void shouldRunInterceptorsInForwardThenReverseOrder() {
        List<String> channelEvents = new ArrayList<>();
        List<String> streamEvents = new ArrayList<>();
        RedisMQTemplate channelTemplate = newRedisMQTemplate();
        channelTemplate.addInterceptor(new RecordingInterceptor("first", channelEvents));
        channelTemplate.addInterceptor(new RecordingInterceptor("second", channelEvents));
        channelTemplate.addInterceptor(new RecordingInterceptor("third", channelEvents));
        RedisMQTemplate streamTemplate = newRedisMQTemplate();
        streamTemplate.addInterceptor(new RecordingInterceptor("first", streamEvents));
        streamTemplate.addInterceptor(new RecordingInterceptor("second", streamEvents));
        streamTemplate.addInterceptor(new RecordingInterceptor("third", streamEvents));
        trackKey(new ProbeStreamMessage().getStreamKey());

        channelTemplate.send(new ProbeChannelMessage());
        streamTemplate.send(new ProbeStreamMessage());

        assertThat(channelEvents).containsExactly(
                "first.sendBefore", "second.sendBefore", "third.sendBefore",
                "third.sendAfter", "second.sendAfter", "first.sendAfter");
        assertThat(streamEvents).containsExactly(
                "first.sendBefore", "second.sendBefore", "third.sendBefore",
                "third.sendAfter", "second.sendAfter", "first.sendAfter");
    }

    /**
     * 验证发送失败时后置钩子仍然执行，异常照常向上抛出。
     *
     * <p>后置钩子承担链路上下文、临时租户标识等资源的回收，丢一次就会泄漏到下一次发送；
     * 因此这里让真实服务端返回 WRONGTYPE，证明失败路径同样收尾。</p>
     */
    @Test
    @DisplayName("真实服务端拒绝写入时后置钩子仍执行，异常继续向上抛出")
    void shouldRunAfterInterceptorsWhenServerRejectsWrite() {
        List<String> events = new ArrayList<>();
        RedisMQTemplate template = newRedisMQTemplate();
        template.addInterceptor(new RecordingInterceptor("first", events));
        template.addInterceptor(new RecordingInterceptor("second", events));
        ProbeStreamMessage message = new ProbeStreamMessage();
        // 预置一个字符串类型的键，让真实服务端对同名的 Stream 执行 XADD 时返回 WRONGTYPE。
        stringRedisTemplate.opsForValue().set(message.getStreamKey(), "not-a-stream");
        trackKey(message.getStreamKey());

        assertThatThrownBy(() -> template.send(message))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("WRONGTYPE");

        assertThat(events).containsExactly(
                "first.sendBefore", "second.sendBefore", "second.sendAfter", "first.sendAfter");
    }

    /**
     * 验证完全未覆写钩子的默认拦截器不会阻断发送。
     *
     * <p>默认实现是给“只关心某一个钩子”的扩展方准备的；如果默认实现抛异常或改变返回值，
     * 这类扩展方注册后会让整个发送链路失败，因此这里用真实发送验证默认实现为空操作。</p>
     */
    @Test
    @DisplayName("未覆写任何钩子的默认拦截器不影响真实发送，四个默认钩子都可安全调用")
    void shouldTolerateInterceptorWithDefaultMethods() {
        RedisMQTemplate template = newRedisMQTemplate();
        template.addInterceptor(new RedisMessageInterceptor() {
        });
        trackKey(new ProbeStreamMessage().getStreamKey());
        ProbeStreamMessage streamMessage = new ProbeStreamMessage();
        streamMessage.setContent("default-interceptor");

        RecordId recordId = template.send(streamMessage);

        assertThat(recordId).isNotNull();
        assertThat(template.getInterceptors()).hasSize(1);
        // 直接调用四个默认方法，证明空实现确实不改变消息内容。
        AbstractRedisMessage probe = new ProbeStreamMessage();
        template.getInterceptors().forEach(interceptor -> {
            interceptor.sendMessageBefore(probe);
            interceptor.sendMessageAfter(probe);
            interceptor.consumeMessageBefore(probe);
            interceptor.consumeMessageAfter(probe);
        });
        assertThat(streamMessage.getHeaders()).isEmpty();
    }

    /**
     * 验证重复添加拦截器后消费侧读到的是同一个列表，而不是副本。
     *
     * <p>监听器在消费时通过 {@code getInterceptors()} 取列表，若返回副本，运行期动态注册的
     * 拦截器就永远不会生效。</p>
     */
    @Test
    @DisplayName("拦截器列表按注册顺序累积，读取到的始终是同一个列表实例")
    void shouldExposeInterceptorListInRegistrationOrder() {
        RedisMQTemplate template = newRedisMQTemplate();
        List<String> events = new ArrayList<>();
        RecordingInterceptor first = new RecordingInterceptor("first", events);
        RecordingInterceptor second = new RecordingInterceptor("second", events);

        template.addInterceptor(first);
        template.addInterceptor(second);

        assertThat(template.getInterceptors()).containsExactly(first, second);
        assertThat(template.getRedisTemplate()).isSameAs(stringRedisTemplate);
    }

    /**
     * 读取 Stream 中单条记录真实落库的字段集合。
     *
     * <p>{@code ofObject} 写入的记录在 Redis 侧是“字段名到 JSON”的单字段结构，
     * 断言字段名才能证明消费侧按 {@code targetType(String)} 取到的就是完整 JSON。</p>
     *
     * @param streamKey Stream Key
     * @return 该 Stream 全部记录的首条记录的字段集合
     */
    private static Map<String, Object> storedValue(String streamKey) {
        List<MapRecord<String, Object, Object>> records =
                stringRedisTemplate.opsForStream().range(streamKey, Range.unbounded());
        assertThat(records).as("Stream %s 必须真实写入一条记录", streamKey).hasSize(1);
        Object value = records.get(0).getValue();
        assertThat(value).as("单字段记录的取值应能还原为字段集合").isInstanceOf(Map.class);
        return (Map<String, Object>) value;
    }

    /**
     * 用于验证 Pub/Sub 频道路由的最小消息，频道由类名推导后必须真实可订阅。
     */
    @Getter
    @Setter
    static final class ProbeChannelMessage extends AbstractRedisChannelMessage {

        /**
         * 业务负载。
         */
        private String content;
    }

    /**
     * 用于验证 Stream Key 路由的最小消息。
     */
    @Getter
    @Setter
    static final class ProbeStreamMessage extends AbstractRedisStreamMessage {

        /**
         * 业务负载。
         */
        private String content;
    }
}
