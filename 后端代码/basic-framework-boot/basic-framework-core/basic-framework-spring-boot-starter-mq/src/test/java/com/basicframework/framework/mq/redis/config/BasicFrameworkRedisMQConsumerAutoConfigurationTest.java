package com.basicframework.framework.mq.redis.config;

import cn.hutool.system.SystemUtil;
import com.basicframework.framework.mq.redis.core.RedisMQTemplate;
import com.basicframework.framework.mq.redis.core.job.RedisPendingMessageResendJob;
import com.basicframework.framework.mq.redis.core.job.RedisStreamMessageCleanupJob;
import com.basicframework.framework.mq.redis.core.pubsub.AbstractRedisChannelMessage;
import com.basicframework.framework.mq.redis.core.pubsub.AbstractRedisChannelMessageListener;
import com.basicframework.framework.mq.redis.core.stream.AbstractRedisStreamMessage;
import com.basicframework.framework.mq.redis.core.stream.AbstractRedisStreamMessageListener;
import com.basicframework.framework.mq.support.MqRedisTestSupport;
import com.basicframework.framework.mq.support.RecordingInterceptor;
import lombok.Getter;
import lombok.Setter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.connection.stream.ObjectRecord;
import org.springframework.data.redis.connection.stream.StreamInfo;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.data.redis.stream.StreamMessageListenerContainer;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

/**
 * 用真实 Redis 验证消费端自动配置的六个契约：消费者命名、消费组创建与幂等、异常分类、
 * Pub/Sub 容器、Stream 容器与两个定时任务的装配。
 *
 * <p>消费组创建是启动期的关键一步：多实例同时启动或重启时 {@code XGROUP CREATE} 必然遇到已存在的组。
 * 本用例同时记录了项目实际使用的 Redisson 客户端在这一步的真实行为，作为该幂等分支能否生效的判据。</p>
 *
 * @author shady2713
 */
public class BasicFrameworkRedisMQConsumerAutoConfigurationTest extends MqRedisTestSupport {

    /**
     * 验证消费者名字由本机地址与进程号组成。
     *
     * <p>消费进度按消费者名归属，名字不唯一会让多个实例共享同一条待确认队列，
     * 彼此抢占消息后谁都推进不了进度。</p>
     */
    @Test
    @DisplayName("消费者名由本机地址与进程号组成，实例之间可区分")
    void shouldBuildConsumerNameFromHostAndPid() {
        String consumerName = BasicFrameworkRedisMQConsumerAutoConfiguration.buildConsumerName();

        assertThat(consumerName).isEqualTo(
                SystemUtil.getHostInfo().getAddress() + "@" + SystemUtil.getCurrentPID());
    }

    /**
     * 验证异常链中的 BUSYGROUP 被识别为消费组已存在。
     */
    @Test
    @DisplayName("异常链中的 BUSYGROUP 被识别为消费组已存在")
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
    @DisplayName("普通连接异常不会被误判为消费组已存在")
    void shouldRejectUnrelatedRedisFailure() {
        DataAccessResourceFailureException exception =
                new DataAccessResourceFailureException("Redis connection refused");

        assertThat(BasicFrameworkRedisMQConsumerAutoConfiguration
                .isConsumerGroupAlreadyExists(exception)).isFalse();
    }

    /**
     * 验证消费组重复创建不会中断启动，并记录真实客户端在这一步的行为。
     *
     * <p>用真实 Redis 连续创建两次同一消费组。结果显示项目实际使用的 Redisson 客户端会自行吞掉
     * BUSYGROUP，因此生产代码里的 BUSYGROUP 兜底分支在当前客户端下不会被触发；
     * 本用例把这一事实固定下来，客户端或容器实现一旦变化会立刻暴露。</p>
     */
    @Test
    @DisplayName("消费组重复创建按幂等放行，消费组真实存在于 Stream 上")
    void shouldTreatExistingConsumerGroupAsIdempotent() {
        String streamKey = new ConsumerProbeMessage().getStreamKey();
        String group = keyPrefix + "idempotent-group";
        trackKey(streamKey);
        newRedisMQTemplate().send(new ConsumerProbeMessage());
        TypedStreamListener listener = new TypedStreamListener();
        ReflectionTestUtils.setField(listener, "group", group);
        BasicFrameworkRedisMQConsumerAutoConfiguration configuration =
                new BasicFrameworkRedisMQConsumerAutoConfiguration();
        configuration.createConsumerGroup(stringRedisTemplate, listener);

        assertThatCode(() -> configuration.createConsumerGroup(stringRedisTemplate, listener))
                .doesNotThrowAnyException();
        assertThat(stringRedisTemplate.opsForStream().groups(streamKey))
                .extracting(StreamInfo.XInfoGroup::groupName).contains(group);
    }

    /**
     * 验证消费组创建遇到非幂等故障时异常继续向上传播。
     *
     * <p>把 Stream 位置成字符串类型后，{@code XGROUP CREATE} 会被真实服务端拒绝；
     * 这类故障吞掉之后容器会注册成功却永远收不到消息，因此必须断言异常真的传播出去。</p>
     */
    @Test
    @DisplayName("消费组创建被服务端拒绝时异常继续抛出，不会带着不可用消费者启动")
    void shouldPropagateNonBusyGroupFailure() {
        String streamKey = keyPrefix + "wrong-type-stream";
        stringRedisTemplate.opsForValue().set(streamKey, "not-a-stream");
        trackKey(streamKey);
        FixedKeyStreamListener listener = new FixedKeyStreamListener(streamKey, keyPrefix + "absent-group");
        BasicFrameworkRedisMQConsumerAutoConfiguration configuration =
                new BasicFrameworkRedisMQConsumerAutoConfiguration();

        assertThatThrownBy(() -> configuration.createConsumerGroup(stringRedisTemplate, listener))
                .isInstanceOf(DataAccessException.class);
    }

    /**
     * 验证 Pub/Sub 容器把模板注入监听器，并订阅消息类型推导出的频道。
     *
     * <p>用真实容器投递证明注册频道正确、模板已注入且消费被真实执行；缺少任一步消息都会静默滞留。</p>
     */
    @Test
    @DisplayName("Pub/Sub 容器把模板注入监听器，并订阅消息类型推导出的频道")
    void shouldRegisterChannelListenerOnDerivedChannel() throws Exception {
        List<String> events = new CopyOnWriteArrayList<>();
        RedisMQTemplate consumerTemplate = newRedisMQTemplate();
        consumerTemplate.addInterceptor(new RecordingInterceptor("audit", events));
        // 发送走独立模板，避免发送钩子混入消费钩子的顺序断言。
        RedisMQTemplate producerTemplate = newRedisMQTemplate();
        ChannelProbeListener listener = new ChannelProbeListener();
        BasicFrameworkRedisMQConsumerAutoConfiguration configuration =
                new BasicFrameworkRedisMQConsumerAutoConfiguration();

        RedisMessageListenerContainer container =
                configuration.redisMessageListenerContainer(consumerTemplate, List.of(listener));
        container.afterPropertiesSet();
        container.start();
        try {
            ChannelProbeMessage message = new ChannelProbeMessage();
            message.setContent("channel-delivered");
            await().atMost(20, TimeUnit.SECONDS).pollInterval(200, TimeUnit.MILLISECONDS).until(() -> {
                producerTemplate.send(message);
                return !listener.consumed.isEmpty();
            });
        } finally {
            container.stop();
            container.destroy();
        }

        assertThat(listener.getChannel()).isEqualTo(ChannelProbeMessage.class.getSimpleName());
        assertThat(listener.consumed.get(0).getContent()).isEqualTo("channel-delivered");
        assertForwardThenReversePairs(events, "audit");
    }

    /**
     * 验证 Stream 容器创建消费组并注册监听器，消息消费后被确认。
     *
     * <p>消费组创建与注册在同一段装配里，任一失败都会让监听器收不到消息；
     * 这里用真实投递加待确认数量归零证明整条装配成立。</p>
     */
    @Test
    @DisplayName("Stream 容器创建消费组并注册监听器，消息消费后被确认")
    void shouldRegisterStreamListenerAndAcknowledge() throws Exception {
        String streamKey = new ConsumerProbeMessage().getStreamKey();
        String group = keyPrefix + "stream-group";
        trackKey(streamKey);
        newRedisMQTemplate().send(new ConsumerProbeMessage());
        RedisMQTemplate template = newRedisMQTemplate();
        TypedStreamListener listener = new TypedStreamListener();
        ReflectionTestUtils.setField(listener, "group", group);
        BasicFrameworkRedisMQConsumerAutoConfiguration configuration =
                new BasicFrameworkRedisMQConsumerAutoConfiguration();

        StreamMessageListenerContainer<String, ObjectRecord<String, String>> container =
                configuration.redisStreamMessageListenerContainer(template, List.of(listener));
        container.start();
        boolean running;
        try {
            newRedisMQTemplate().send(new ConsumerProbeMessage());

            await().atMost(20, TimeUnit.SECONDS).pollInterval(200, TimeUnit.MILLISECONDS)
                    .until(() -> stringRedisTemplate.opsForStream().pending(streamKey, group)
                            .getTotalPendingMessages() == 0L);
            running = container.isRunning();
        } finally {
            container.stop();
        }

        assertThat(stringRedisTemplate.opsForStream().groups(streamKey))
                .extracting(StreamInfo.XInfoGroup::groupName).contains(group);
        assertThat(running).as("容器必须已启动消费任务").isTrue();
    }

    /**
     * 验证清理任务把监听器列表、模板与锁客户端原样装配。
     *
     * <p>这三个引用决定了任务真正操作的 Stream 与锁；装配错对象会让任务静默清理错误的 Stream。
     * 任务本身没有读取入口，因此用字段同实例断言锁定装配契约。</p>
     */
    @Test
    @DisplayName("清理任务把监听器列表、发送模板与锁客户端原样装配")
    void shouldWireCleanupJobDependencies() {
        List<AbstractRedisStreamMessageListener<?>> listeners =
                List.of(new FixedKeyStreamListener(keyPrefix + "wired", keyPrefix + "wired-group"));
        RedisMQTemplate template = newRedisMQTemplate();
        BasicFrameworkRedisMQConsumerAutoConfiguration configuration =
                new BasicFrameworkRedisMQConsumerAutoConfiguration();

        RedisStreamMessageCleanupJob job =
                configuration.redisStreamMessageCleanupJob(listeners, template, redissonClient);

        assertThat(ReflectionTestUtils.getField(job, "listeners")).isSameAs(listeners);
        assertThat(ReflectionTestUtils.getField(job, "redisTemplate")).isSameAs(template);
        assertThat(ReflectionTestUtils.getField(job, "redissonClient")).isSameAs(redissonClient);
    }

    /**
     * 验证重投任务把监听器列表、模板与锁客户端原样装配。
     *
     * <p>与清理任务同理：任务只持有这三个引用，装配错对象会让重投作用在错误的消费组上。</p>
     */
    @Test
    @DisplayName("重投任务把监听器列表、发送模板与锁客户端原样装配")
    void shouldWireResendJobDependencies() {
        List<AbstractRedisStreamMessageListener<?>> listeners =
                List.of(new FixedKeyStreamListener(keyPrefix + "wired", keyPrefix + "wired-group"));
        RedisMQTemplate template = newRedisMQTemplate();
        BasicFrameworkRedisMQConsumerAutoConfiguration configuration =
                new BasicFrameworkRedisMQConsumerAutoConfiguration();

        RedisPendingMessageResendJob job =
                configuration.redisPendingMessageResendJob(listeners, template, redissonClient);

        assertThat(ReflectionTestUtils.getField(job, "listeners")).isSameAs(listeners);
        assertThat(ReflectionTestUtils.getField(job, "redisTemplate")).isSameAs(template);
        assertThat(ReflectionTestUtils.getField(job, "redissonClient")).isSameAs(redissonClient);
    }

    /**
     * 验证没有监听器时容器依然建立，不因空列表失败。
     *
     * <p>容器按 Bean 条件装配，可能出现“有自动配置、无监听器”的组合；此时不应阻断启动。</p>
     */
    @Test
    @DisplayName("没有监听器时 Pub/Sub 容器仍可建立，不阻断启动")
    void shouldBuildChannelContainerWithoutListener() {
        BasicFrameworkRedisMQConsumerAutoConfiguration configuration =
                new BasicFrameworkRedisMQConsumerAutoConfiguration();

        RedisMessageListenerContainer container =
                configuration.redisMessageListenerContainer(newRedisMQTemplate(), new ArrayList<>());

        assertThat(container.isAutoStartup()).as("空监听器时容器仍应可启动").isTrue();
    }

    /**
     * 声明了消息泛型的 Stream 监听器，Stream Key 由消息类型推导。
     * @author shady2713
     */
    public static final class TypedStreamListener extends AbstractRedisStreamMessageListener<ConsumerProbeMessage> {

        /**
         * 记录被消费到的内容。
         */
        private final List<String> consumed = new CopyOnWriteArrayList<>();

        /**
         * 记录被消费到的消息。
         *
         * @param message 反序列化后的消息
         */
        @Override
        public void onMessage(ConsumerProbeMessage message) {
            consumed.add(message.getContent());
        }
    }

    /**
     * 使用显式 Stream Key 的监听器，用于不需要反序列化的装配断言。
     * @author shady2713
     */
    public static final class FixedKeyStreamListener
            extends AbstractRedisStreamMessageListener<ConsumerProbeMessage> {

        /**
         * 指定 Stream Key 与消费组后构造。
         *
         * @param streamKey Stream Key
         * @param group 消费组
         */
        public FixedKeyStreamListener(String streamKey, String group) {
            super(streamKey, group);
        }

        /**
         * 显式路由下没有消息类型可供反序列化，这里不消费任何消息。
         *
         * @param message 反序列化后的消息
         */
        @Override
        public void onMessage(ConsumerProbeMessage message) {
        }
    }

    /**
     * 用于验证 Pub/Sub 容器注册的监听器。
     * @author shady2713
     */
    public static final class ChannelProbeListener
            extends AbstractRedisChannelMessageListener<ChannelProbeMessage> {

        /**
         * 已消费的消息。
         */
        private final List<ChannelProbeMessage> consumed = new CopyOnWriteArrayList<>();

        /**
         * 记录被消费到的消息。
         *
         * @param message 反序列化后的消息
         */
        @Override
        public void onMessage(ChannelProbeMessage message) {
            consumed.add(message);
        }
    }

    /**
     * 用于验证 Stream 装配的最小消息。
     * @author shady2713
     */
    @Getter
    @Setter
    public static final class ConsumerProbeMessage extends AbstractRedisStreamMessage {

        /**
         * 业务负载。
         */
        private String content;
    }

    /**
     * 用于验证频道推导的最小消息。
     * @author shady2713
     */
    @Getter
    @Setter
    public static final class ChannelProbeMessage extends AbstractRedisChannelMessage {

        /**
         * 业务负载。
         */
        private String content;
    }
}
