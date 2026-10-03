package com.basicframework.framework.mq.redis.core.stream;

import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.framework.mq.redis.core.RedisMQTemplate;
import com.basicframework.framework.mq.redis.core.message.AbstractRedisMessage;
import com.basicframework.framework.mq.support.MqRedisTestSupport;
import com.basicframework.framework.mq.support.RecordingInterceptor;
import lombok.Getter;
import lombok.Setter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.ObjectRecord;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.stream.StreamMessageListenerContainer;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

/**
 * 验证 Stream 监听器的四个契约：Stream Key 推导、显式路由构造、消费后确认与未装配时的失败分支。
 *
 * <p>确认动作是 Stream 消费组与 Pub/Sub 的根本差别：漏掉确认会让消息长期停留在待确认列表并被重投任务
 * 反复投递，因此这里用真实 {@code XPENDING} 结果而不是日志来判定确认是否真的发生。</p>
 *
 * @author shady2713
 */
public class AbstractRedisStreamMessageListenerTest extends MqRedisTestSupport {

    /**
     * 验证无参构造按泛型消息类型解析 Stream Key。
     *
     * <p>Stream Key 同时是清理任务与重投任务的遍历范围，推导错误会让消息脱离治理范围。</p>
     */
    @Test
    @DisplayName("无参构造按泛型消息类型解析 Stream Key，Key 与消息类型同名")
    void shouldResolveStreamKeyFromMessageType() {
        trackKey(new StreamProbeMessage().getStreamKey());

        assertThat(new TypedProbeListener().getStreamKey())
                .isEqualTo(StreamProbeMessage.class.getSimpleName());
    }

    /**
     * 验证显式构造按参数保留 Stream Key 与消费组。
     *
     * <p>该构造是框架扩展与自定义路由的入口，消费组名决定不同业务之间是否会互相抢消息，
     * 一旦被默认值覆盖就会串消费组。</p>
     */
    @Test
    @DisplayName("显式构造原样保留指定的 Stream Key 与消费组")
    void shouldKeepExplicitStreamKeyAndGroup() {
        FixedKeyListener listener = new FixedKeyListener(keyPrefix + "explicit", "explicit-group");

        assertThat(listener.getStreamKey()).isEqualTo(keyPrefix + "explicit");
        assertThat(listener.getGroup()).isEqualTo("explicit-group");
    }

    /**
     * 验证真实 Stream 容器消费后消息被确认，不再停留在待确认列表。
     *
     * <p>整条链路使用真实消费组、真实投递与真实 {@code XACK}；待确认数量归零才说明确认动作生效。</p>
     */
    @Test
    @DisplayName("真实 Stream 容器消费后消息进入已确认状态，待确认列表归零")
    void shouldAcknowledgeConsumedStreamMessage() throws Exception {
        String streamKey = new StreamProbeMessage().getStreamKey();
        String group = keyPrefix + "group";
        trackKey(streamKey);
        newRedisMQTemplate().send(new StreamProbeMessage());
        TypedProbeListener listener = newTypedListener(group);
        List<String> events = new CopyOnWriteArrayList<>();
        RedisMQTemplate consumerTemplate = newRedisMQTemplate();
        consumerTemplate.addInterceptor(new RecordingInterceptor("first", events));
        consumerTemplate.addInterceptor(new RecordingInterceptor("second", events));
        listener.setRedisMQTemplate(consumerTemplate);
        stringRedisTemplate.opsForStream().createGroup(streamKey, group);
        StreamMessageListenerContainer<String, ObjectRecord<String, String>> container =
                StreamMessageListenerContainer.create(connectionFactory,
                        StreamMessageListenerContainer.StreamMessageListenerContainerOptions
                                .<String, ObjectRecord<String, String>>builder()
                                .batchSize(10)
                                .targetType(String.class)
                                .build());
        container.register(StreamMessageListenerContainer.StreamReadRequest
                .builder(StreamOffset.create(streamKey, ReadOffset.lastConsumed()))
                .consumer(Consumer.from(group, "probe-consumer"))
                .autoAcknowledge(false)
                .cancelOnError(throwable -> false)
                .build(), listener);
        container.start();
        try {
            StreamProbeMessage message = new StreamProbeMessage();
            message.setContent("stream-consumed");
            // 发送走独立模板，避免发送钩子混入消费钩子的顺序断言。
            newRedisMQTemplate().send(message);

            await().atMost(20, TimeUnit.SECONDS).pollInterval(200, TimeUnit.MILLISECONDS)
                    .until(() -> stringRedisTemplate.opsForStream().pending(streamKey, group)
                            .getTotalPendingMessages() == 0L
                            && !listener.consumed.isEmpty());
        } finally {
            container.stop();
        }

        assertThat(listener.consumed.get(0)).isEqualTo("stream-consumed");
        assertThat(events).containsExactly(
                "first.consumeBefore", "second.consumeBefore",
                "second.consumeAfter", "first.consumeAfter");
    }

    /**
     * 验证未注入模板时消费抛出 {@link NullPointerException}，消息不会被确认。
     *
     * <p>确认依赖模板持有的 Redis 连接，模板缺失时必须失败而不是继续，
     * 否则消息会被业务方看到却永远留在待确认列表里被反复重投。</p>
     */
    @Test
    @DisplayName("未注入 RedisMQTemplate 时消费抛出 NullPointerException，消息不会被确认")
    void shouldRejectConsumeBeforeTemplateInjection() {
        TypedProbeListener listener = new TypedProbeListener();
        ObjectRecord<String, String> record = recordOf(new StreamProbeMessage());

        assertThatThrownBy(() -> listener.onMessage(record))
                .isInstanceOf(NullPointerException.class)
                .hasMessage("RedisMQTemplate 尚未完成初始化");
        assertThat(listener.consumedCount.get()).isZero();
    }

    /**
     * 验证漏写消息泛型时构造抛出可定位的配置异常。
     *
     * <p>抽象类实现了 {@code StreamListener<String, ObjectRecord<String, String>>}，泛型解析会先命中这个接口，
     * 将消息类型解析成非空的 {@code String.class}。该类型必须被守卫拒绝，异常应指出遗漏泛型的子类及实际解析类型，
     * 避免在后续消息实例化时才抛出误导排查方向的类型转换异常。</p>
     */
    @Test
    @DisplayName("漏写消息泛型时构造抛出 IllegalStateException，提示子类名及实际解析类型")
    void shouldFailWhenMessageTypeIsNotDeclared() {
        assertThatThrownBy(RawTypeStreamListener::new)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("类型(" + RawTypeStreamListener.class.getName() + ") 需要设置消息类型")
                .hasMessageContaining(String.class.getName());
    }

    /**
     * 验证消费使用模板当前的拦截器集合，运行期新增的拦截器同样生效。
     *
     * <p>多租户等扩展点在运行期注册拦截器，若消费侧读的是快照，扩展会静默失效。</p>
     */
    @Test
    @DisplayName("消费使用模板当前的拦截器集合，运行期新增的拦截器立即生效")
    void shouldUseCurrentInterceptorsOfTemplate() {
        String group = keyPrefix + "runtime-group";
        ensureStreamGroup(group);
        List<String> events = new ArrayList<>();
        TypedProbeListener listener = newTypedListener(group);
        RedisMQTemplate template = newRedisMQTemplate();
        listener.setRedisMQTemplate(template);

        listener.onMessage(recordOf(new StreamProbeMessage()));
        template.addInterceptor(new RecordingInterceptor("late", events));
        listener.onMessage(recordOf(new StreamProbeMessage()));

        assertThat(events).as("注册前的消费不触发任何钩子，运行期新增的拦截器立即参与后续消费")
                .containsExactly("late.consumeBefore", "late.consumeAfter");
    }

    /**
     * 为监听器创建指定消费组的正常实例。
     *
     * <p>生产环境消费组由 {@code @Value} 注入，测试没有 Spring 容器，需要显式写入字段。</p>
     *
     * @param group 消费组名
     * @return 已指定消费组的监听器
     */
    private static TypedProbeListener newTypedListener(String group) {
        TypedProbeListener listener = new TypedProbeListener();
        ReflectionTestUtils.setField(listener, "group", group);
        return listener;
    }

    /**
     * 预先建立 Stream 与消费组，让确认动作作用在真实存在的组上。
     *
     * <p>{@code XACK} 遇到不存在的消费组会直接报错，因此确认相关用例必须先建组。</p>
     *
     * @param group 消费组名
     */
    private static void ensureStreamGroup(String group) {
        StreamProbeMessage seed = new StreamProbeMessage();
        seed.setContent("seed");
        trackKey(seed.getStreamKey());
        newRedisMQTemplate().send(seed);
        stringRedisTemplate.opsForStream().createGroup(seed.getStreamKey(), group);
    }

    /**
     * 构造与生产同构的 Stream 记录。
     *
     * @param payload 待反序列化的业务消息
     * @return 指向固定记录编号的 Stream 记录
     */
    private static ObjectRecord<String, String> recordOf(AbstractRedisMessage payload) {
        return ObjectRecord.<String, String>create("probe-stream", JsonUtils.toJsonString(payload))
                .withId(RecordId.of("1-0"));
    }

    /**
     * 声明了消息泛型的正常监听器，消费组由测试显式指定。
     */
    static final class TypedProbeListener extends AbstractRedisStreamMessageListener<StreamProbeMessage> {

        /**
         * 实际消费到的消息内容。
         */
        private final List<String> consumed = new CopyOnWriteArrayList<>();

        /**
         * 消费次数，用于在失败分支上证明业务逻辑没有被执行。
         */
        private final AtomicInteger consumedCount = new AtomicInteger();

        /**
         * 记录被扩展方真正消费到的消息。
         *
         * @param message 反序列化后的消息
         */
        @Override
        public void onMessage(StreamProbeMessage message) {
            consumed.add(message.getContent());
            consumedCount.incrementAndGet();
        }
    }

    /**
     * 使用显式 Stream Key 与消费组的监听器。
     */
    static final class FixedKeyListener extends AbstractRedisStreamMessageListener<StreamProbeMessage> {

        /**
         * 指定 Stream Key 与消费组后构造。
         *
         * @param streamKey Stream Key
         * @param group 消费组
         */
        FixedKeyListener(String streamKey, String group) {
            super(streamKey, group);
        }

        /**
         * 显式路由下没有消息类型可供反序列化，这里不消费任何消息。
         *
         * @param message 反序列化后的消息
         */
        @Override
        public void onMessage(StreamProbeMessage message) {
        }
    }

    /**
     * 刻意擦除泛型的监听器，用于触发消息类型解析失败。
     */
    @SuppressWarnings("rawtypes")
    static final class RawTypeStreamListener extends AbstractRedisStreamMessageListener {

        /**
         * 擦除泛型后只能按基类签名实现。
         *
         * @param message 反序列化后的消息
         */
        @Override
        public void onMessage(AbstractRedisStreamMessage message) {
        }
    }

    /**
     * 用于验证 Stream Key 推导与反序列化的最小消息。
     * @author shady2713
     */
    @Getter
    @Setter
    public static final class StreamProbeMessage extends AbstractRedisStreamMessage {

        /**
         * 业务负载。
         */
        private String content;
    }
}
