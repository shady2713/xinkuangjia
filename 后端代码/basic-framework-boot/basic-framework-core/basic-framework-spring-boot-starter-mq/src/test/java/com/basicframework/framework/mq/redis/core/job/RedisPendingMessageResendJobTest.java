package com.basicframework.framework.mq.redis.core.job;

import com.basicframework.framework.mq.redis.core.RedisMQTemplate;
import com.basicframework.framework.mq.redis.core.stream.AbstractRedisStreamMessage;
import com.basicframework.framework.mq.redis.core.stream.AbstractRedisStreamMessageListener;
import com.basicframework.framework.mq.support.MqRedisTestSupport;
import lombok.Getter;
import lombok.Setter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.springframework.data.domain.Range;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.ObjectRecord;
import org.springframework.data.redis.connection.stream.PendingMessagesSummary;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.stream.StreamListener;
import org.springframework.data.redis.stream.StreamMessageListenerContainer;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.awaitility.Awaitility.await;

/**
 * 用真实 Redis 验证待确认消息重投任务的三个可达契约：未超时消息不重投、锁被占用时整段跳过、
 * 执行期异常被吞掉后仍然释放锁。
 *
 * <p>重投只处理“上次投递已超过 5 分钟”的待确认消息。未超时消息仍在处理窗口内，提前重投会让同一条
 * 业务被并发执行两次；任务运行在所有实例上，没有锁就继续会让多个节点同时对同一消费组重投。</p>
 *
 * <p>“已超时”分支在当前隔离实例上无法覆盖：{@code EXPIRE_TIME} 是 5 分钟，而让服务端把待确认消息的
 * 空闲时间改大的 {@code XCLAIM ... IDLE} 选项要求 Redis 6.2，本实例是 5.0.14.1，服务端会把它当成
 * 额外的消息编号并忽略。详见 {@code shouldRedeliverTimedOutPendingMessage} 的禁用原因。</p>
 *
 * @author shady2713
 */
class RedisPendingMessageResendJobTest extends MqRedisTestSupport {

    /**
     * 被测 Stream Key。
     */
    private String streamKey;

    /**
     * 被测消费组。
     */
    private String group;

    /**
     * 产生待确认消息的消费者名。
     */
    private String pendingConsumer;

    /**
     * 为每个用例建立独立的 Stream、消费组与一条待确认消息。
     */
    @BeforeEach
    void preparePendingMessage() {
        trackLockKey(RESEND_LOCK_KEY);
        // 发送模板按消息类型推导 Stream Key，任务遍历的键必须与之一致，否则待确认列表永远是空的。
        streamKey = new PendingProbeMessage().getStreamKey();
        trackKey(streamKey);
        group = keyPrefix + "pending-group";
        pendingConsumer = keyPrefix + "crashed-consumer";
        // 先建组再建消息：客户端会自动创建 Stream，消费组从空流末尾开始，
        // 这样后面写入的唯一一条消息就是全部待确认消息，前置条件不会随用例变化。
        stringRedisTemplate.opsForStream().createGroup(streamKey, group);
        readIntoPendingWithoutAcknowledge();
        assertThat(stringRedisTemplate.opsForStream().pending(streamKey, group).getTotalPendingMessages())
                .as("前置条件：必须真实存在一条待确认消息").isEqualTo(1L);
    }

    /**
     * 验证未超过处理窗口的待确认消息不会被重投。
     *
     * <p>刚写入的待确认消息空闲时间接近 0 秒，落在 5 分钟窗口内；此时重投会让同一条业务被并发执行。
     * 断言 Stream 长度与待确认数量都不变，证明既没有重投也没有误确认。</p>
     */
    @Test
    @DisplayName("未超过处理窗口的待确认消息不重投，也不被误确认")
    void shouldLeaveFreshPendingMessageUntouched() {
        RedisPendingMessageResendJob job = new RedisPendingMessageResendJob(List.of(newListener()),
                newRedisMQTemplate(), redissonClient);

        job.messageResend();

        assertThat(stringRedisTemplate.opsForStream().size(streamKey)).isEqualTo(1L);
        assertThat(stringRedisTemplate.opsForStream().pending(streamKey, group).getTotalPendingMessages())
                .isEqualTo(1L);
        assertThat(stringRedisTemplate.opsForStream()
                .range(streamKey, Range.unbounded()).get(0).getValue())
                .as("待确认消息必须仍留在原处").isNotNull();
    }

    /**
     * 验证遍历到了真实消费者的待确认消息，而不是因为没有数据提前结束。
     *
     * <p>待确认汇总是按消费者分组的；这里直接读取服务端汇总，确认用例确实走到了按消费者下钻的逻辑。</p>
     */
    @Test
    @DisplayName("重投任务按消费者汇总待确认消息，刚投递的消息归属于崩溃消费者")
    void shouldGroupPendingMessagesByConsumer() {
        PendingMessagesSummary summary = stringRedisTemplate.opsForStream().pending(streamKey, group);

        assertThat(summary.getPendingMessagesPerConsumer()).containsEntry(pendingConsumer, 1L);
        assertThat(summary.getTotalPendingMessages()).isEqualTo(1L);
    }

    /**
     * 验证锁被其它节点持有时整段跳过，不做任何重投。
     *
     * <p>用第二个真实 Redisson 客户端持有同名锁键，复现多实例同时调度的真实竞争；
     * 被跳过后待确认消息必须原样保留。</p>
     */
    @Test
    @DisplayName("锁被其它节点持有时整段跳过，待确认消息原样保留")
    void shouldSkipWhenLockHeldByAnotherNode() {
        RedissonClient other = newRedissonClient(Integer.parseInt(requiredEnvironment("BF_TEST_REDIS_PORT")));
        RLock heldByOther = other.getLock(RESEND_LOCK_KEY);
        assertThat(heldByOther.tryLock()).as("第二个客户端必须先拿到锁").isTrue();
        RedisPendingMessageResendJob job = new RedisPendingMessageResendJob(List.of(newListener()),
                newRedisMQTemplate(), redissonClient);
        try {
            job.messageResend();

            assertThat(stringRedisTemplate.opsForStream().size(streamKey)).isEqualTo(1L);
            assertThat(stringRedisTemplate.opsForStream().pending(streamKey, group).getTotalPendingMessages())
                    .isEqualTo(1L);
        } finally {
            heldByOther.unlock();
        }
    }

    /**
     * 验证执行期异常被记录后仍然释放锁，下一轮调度可以继续加锁。
     *
     * <p>用一个没有底层模板的发送模板让执行在第一步就失败。若异常路径不释放锁，
     * 重投任务会在之后所有调度里静默停摆，崩溃消费者的消息永远得不到重投。</p>
     */
    @Test
    @DisplayName("执行期异常被吞掉后仍然释放锁，下一轮调度可以继续加锁")
    void shouldReleaseLockAfterExecutionFailure() {
        RedisPendingMessageResendJob job = new RedisPendingMessageResendJob(List.of(newListener()),
                new RedisMQTemplate(null), redissonClient);

        assertThatCode(job::messageResend).doesNotThrowAnyException();

        RLock lock = redissonClient.getLock(RESEND_LOCK_KEY);
        assertThat(lock.tryLock()).as("失败路径必须释放锁").isTrue();
        lock.unlock();
    }

    /**
     * 验证正常执行结束后锁被释放，锁键不再残留。
     */
    @Test
    @DisplayName("正常执行结束后锁被释放，锁键不再残留")
    void shouldReleaseLockAfterSuccessfulExecution() {
        RedisPendingMessageResendJob job = new RedisPendingMessageResendJob(List.of(newListener()),
                newRedisMQTemplate(), redissonClient);

        job.messageResend();

        assertThat(redissonClient.getLock(RESEND_LOCK_KEY).isLocked()).isFalse();
    }

    /**
     * 验证“已超时”重投分支在当前隔离实例上无法构造。
     *
     * <p>任务用服务端上报的待确认空闲时间与 5 分钟阈值比较。空闲时间由 {@code XPENDING} 直接返回，
     * 客户端无法伪造；唯一能改写它的 {@code XCLAIM ... IDLE} 选项要求 Redis 6.2，而本隔离实例是
     * 5.0.14.1，实测该选项被当成额外消息编号忽略、空闲时间仍为 0。唯一的真实办法是等待 5 分钟，
     * 不适合放进构建流程。隔离实例升级到 6.2 及以上后，本用例即可启用。</p>
     */
    @Test
    @Disabled("需要 Redis 6.2+ 的 XCLAIM ... IDLE 才能把待确认空闲时间调到 5 分钟以上，"
            + "当前隔离实例为 5.0.14.1，服务端会忽略该选项")
    @DisplayName("已超时的待确认消息被重新投递并确认（需要 Redis 6.2+）")
    void shouldRedeliverTimedOutPendingMessage() {
        byte[] recordId = stringRedisTemplate.opsForStream().range(streamKey, Range.unbounded())
                .get(0).getId().getValue().getBytes(StandardCharsets.UTF_8);
        stringRedisTemplate.execute((RedisCallback<Object>) connection -> {
            connection.execute("XCLAIM", utf8(streamKey), utf8(group), utf8(pendingConsumer),
                    utf8("0"), recordId, utf8("IDLE"), utf8("400000"));
            return null;
        });
        RedisPendingMessageResendJob job = new RedisPendingMessageResendJob(List.of(newListener()),
                newRedisMQTemplate(), redissonClient);

        job.messageResend();

        assertThat(stringRedisTemplate.opsForStream().size(streamKey)).isEqualTo(2L);
        assertThat(stringRedisTemplate.opsForStream().pending(streamKey, group).getTotalPendingMessages())
                .isZero();
    }

    /**
     * 创建指向本用例 Stream 的监听器，重投任务只读取它的 Key 与消费组。
     *
     * @return 监听器实例
     */
    private AbstractRedisStreamMessageListener<?> newListener() {
        return new FixedKeyStreamListener(streamKey, group);
    }

    /**
     * 用真实消费容器把消息读成待确认状态且不做确认，复现“消费者崩溃后消息滞留”。
     *
     * <p>直接下发裸 {@code XREADGROUP} 在当前 Redis 客户端桥接下不受支持，因此改用与生产同构的
     * 消费容器：关闭自动确认、注册一个不做确认的空监听器，停止容器后消息就稳定留在待确认列表里。</p>
     */
    private void readIntoPendingWithoutAcknowledge() {
        StreamMessageListenerContainer<String, ObjectRecord<String, String>> container =
                StreamMessageListenerContainer.create(connectionFactory,
                        StreamMessageListenerContainer.StreamMessageListenerContainerOptions
                                .<String, ObjectRecord<String, String>>builder()
                                .batchSize(10)
                                .targetType(String.class)
                                .build());
        container.register(StreamMessageListenerContainer.StreamReadRequest
                .builder(StreamOffset.create(streamKey, ReadOffset.lastConsumed()))
                .consumer(Consumer.from(group, pendingConsumer))
                .autoAcknowledge(false)
                .cancelOnError(throwable -> false)
                .build(), (StreamListener<String, ObjectRecord<String, String>>) record -> {
        });
        container.start();
        try {
            newRedisMQTemplate().send(new PendingProbeMessage());
            await().atMost(15, TimeUnit.SECONDS).pollInterval(100, TimeUnit.MILLISECONDS)
                    .until(() -> stringRedisTemplate.opsForStream().pending(streamKey, group)
                            .getTotalPendingMessages() >= 1L);
        } finally {
            container.stop();
        }
    }

    /**
     * 使用显式 Stream Key 的监听器。
     */
    static final class FixedKeyStreamListener extends AbstractRedisStreamMessageListener<PendingProbeMessage> {

        /**
         * 指定 Stream Key 与消费组后构造。
         *
         * @param streamKey Stream Key
         * @param group 消费组
         */
        FixedKeyStreamListener(String streamKey, String group) {
            super(streamKey, group);
        }

        /**
         * 重投任务不消费消息，这里无需实现真实逻辑。
         *
         * @param message 反序列化后的消息
         */
        @Override
        public void onMessage(PendingProbeMessage message) {
        }
    }

    /**
     * 重投任务只按记录编号搬运负载，消息类型仅用于满足泛型约束。
     */
    @Getter
    @Setter
    static final class PendingProbeMessage extends AbstractRedisStreamMessage {

        /**
         * 业务负载。
         */
        private String content;
    }
}
