package com.basicframework.framework.mq.redis.core.job;

import com.basicframework.framework.mq.redis.core.RedisMQTemplate;
import com.basicframework.framework.mq.redis.core.stream.AbstractRedisStreamMessage;
import com.basicframework.framework.mq.redis.core.stream.AbstractRedisStreamMessageListener;
import com.basicframework.framework.mq.support.MqRedisTestSupport;
import lombok.Getter;
import lombok.Setter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.springframework.data.domain.Range;
import org.springframework.data.redis.connection.ReturnType;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.PendingMessage;
import org.springframework.data.redis.connection.stream.PendingMessagesSummary;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.StreamReadOptions;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StreamOperations;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * 用真实 Redis 验证待确认消息重投任务的契约：未超时消息不重投、已超时消息被重新投递并确认、
 * 锁被占用时整段跳过、执行期异常被吞掉后仍然释放锁。
 *
 * <p>重投只处理“上次投递已超过 5 分钟”的待确认消息。未超时消息仍在处理窗口内，提前重投会让同一条
 * 业务被并发执行两次；任务运行在所有实例上，没有锁就继续会让多个节点同时对同一消费组重投。</p>
 *
 * <p>“已超时”分支用 {@code XCLAIM ... IDLE} 把待确认消息的空闲时间改到窗口之外，该选项自 Redis 6.2
 * 起由服务端支持，仓库要求的 Redis 7.x 与当前隔离实例（8.8.0）都具备；服务端不支持时用例会在前置
 * 断言处真实失败，而不是跳过。</p>
 *
 * @author shady2713
 */
class RedisPendingMessageResendJobTest extends MqRedisTestSupport {

    /** 改写的待确认空闲时间（毫秒），比生产 5 分钟超时窗口多 100 秒。 */
    private static final String CLAIM_IDLE_MILLIS = "400000";

    /**
     * 通过 Lua 下发原生 {@code XCLAIM} 的脚本，成功时返回被抢占的消息条数。
     *
     * <p>生产使用的 Redisson 连接桥没有实现 {@code RedisConnection#execute}，无法直接下发裸命令
     * （调用会抛 {@code UnsupportedOperationException}）；Redisson 自身也用 EVAL 包装 XPENDING，
     * 因此这里走连接自带的 EVAL 通道下发未改写的 {@code XCLAIM ... IDLE}，服务端执行的仍是原生命令。</p>
     */
    private static final String CLAIM_WITH_IDLE_SCRIPT =
            "local claimed = redis.call('XCLAIM', KEYS[1], ARGV[1], ARGV[2], '0', ARGV[3], 'IDLE', ARGV[4]) "
                    + "return #claimed";

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
     *
     * <p>用同步 {@code XREADGROUP} 把消息留在待确认列表，复现消费者崩溃后的滞留消息。这里刻意不启动
     * 消费容器：容器停止后仍可能完成一次已发出的阻塞读取，把重投产生的新消息再次读成待确认，
     * 导致“重投是否真的确认了原消息”无法判定。读取刻意不加 {@code NOACK}（Spring Data 的
     * {@code noack()}/{@code autoAcknowledge()} 都会加上该选项），消息才会真实进入待确认列表。</p>
     */
    @BeforeEach
    void preparePendingMessage() {
        trackLockKey(RESEND_LOCK_KEY);
        // 发送模板按消息类型推导 Stream Key，任务遍历的键必须与之一致，否则待确认列表永远是空的。
        streamKey = new PendingProbeMessage().getStreamKey();
        trackKey(streamKey);
        group = keyPrefix + "pending-group";
        pendingConsumer = keyPrefix + "crashed-consumer";
        // 先建组再建消息：客户端会自动创建 Stream，消费组从空流开始，
        // 这样后面写入的唯一一条消息就是全部待确认消息，前置条件不会随用例变化。
        stringRedisTemplate.opsForStream().createGroup(streamKey, group);
        newRedisMQTemplate().send(new PendingProbeMessage());
        List<MapRecord<String, Object, Object>> records = stringRedisTemplate.opsForStream().read(
                Consumer.from(group, pendingConsumer), StreamReadOptions.empty(),
                StreamOffset.create(streamKey, ReadOffset.lastConsumed()));
        assertThat(records).as("前置条件：消息必须被真实读成待确认").hasSize(1);
        assertThat(stringRedisTemplate.opsForStream().pending(streamKey, group).getTotalPendingMessages())
                .as("前置条件：必须真实存在一条待确认消息")
                .isEqualTo(1L);
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
     * 验证“已超时”的待确认消息被重新投递到 Stream 并确认原记录。
     *
     * <p>先用 {@code XCLAIM ... IDLE 400000} 把待确认消息的空闲时间真实改到 5 分钟窗口之外
     * （该选项需要 Redis 6.2+，服务端不支持时前置断言会失败并指出原因），再执行重投任务。
     * 断言 Stream 长度从 1 变为 2 且待确认数量归零：重新投递产生新记录，原记录被确认，
     * 崩溃消费者的消息因此不会永久滞留。</p>
     */
    @Test
    @DisplayName("已超时的待确认消息被重新投递并确认")
    void shouldRedeliverTimedOutPendingMessage() {
        String recordId = markPendingMessageTimedOut();
        RedisPendingMessageResendJob job = new RedisPendingMessageResendJob(List.of(newListener()),
                newRedisMQTemplate(), redissonClient);

        job.messageResend();

        assertThat(stringRedisTemplate.opsForStream().size(streamKey)).isEqualTo(2L);
        assertThat(stringRedisTemplate.opsForStream().pending(streamKey, group).getTotalPendingMessages())
                .isZero();
    }

    /**
     * Stream 中已被删除的待确认消息必须跳过，既不重投也不删除待确认记录。
     *
     * <p>消息可能已被清理任务从 Stream 中移除，而崩溃消费者的待确认记录仍留在 PEL 里；
     * 此时按编号取不到消息体。生产的处理是跳过并且不确认，待确认记录留给后续清理，
     * 这里用真实 {@code XDEL} 构造该状态，断言没有凭空重投、也没有误确认。</p>
     */
    @Test
    @DisplayName("Stream 中已删除的待确认消息被跳过，既不重投也不确认")
    void shouldSkipPendingMessageWhoseStreamEntryWasDeleted() {
        String recordId = markPendingMessageTimedOut();

        Long deleted = stringRedisTemplate.opsForStream().delete(streamKey, recordId);
        assertThat(deleted).as("必须真实删除 Stream 实体").isEqualTo(1L);
        assertThat(stringRedisTemplate.opsForStream().range(streamKey, Range.unbounded()))
                .as("前置条件：Stream 中已无消息体").isEmpty();
        assertThat(stringRedisTemplate.opsForStream().pending(streamKey, group).getTotalPendingMessages())
                .as("前置条件：待确认记录仍留在 PEL").isEqualTo(1L);

        new RedisPendingMessageResendJob(List.of(newListener()), newRedisMQTemplate(), redissonClient)
                .messageResend();

        assertThat(stringRedisTemplate.opsForStream().size(streamKey)).as("不得凭空重投消息").isZero();
        assertThat(stringRedisTemplate.opsForStream().pending(streamKey, group).getTotalPendingMessages())
                .as("跳过时不得误确认，待确认记录保留").isEqualTo(1L);
    }

    /**
     * 汇总与下钻两次读取之间消息被其它节点确认时，必须跳过该消费者且不产生副作用。
     *
     * <p>{@code XPENDING} 汇总与按消费者下钻是两次独立读取，生产中存在“汇总说有、下钻已空”的
     * 竞争窗口（另一实例刚完成确认）。用并发线程复现会变成偶发用例，因此这里由测试在两次真实
     * Redis 命令之间执行一次真实 {@code XACK} 把窗口固定下来：被测任务仍自己读汇总、自己读下钻，
     * 测试只决定何时确认，不伪造任何返回值。</p>
     */
    @Test
    @DisplayName("汇总后消息被其它节点确认时跳过该消费者，不重投")
    void shouldSkipConsumerConfirmedBetweenSummaryAndDetailReads() {
        String recordId = markPendingMessageTimedOut();
        AtomicBoolean summaryObserved = new AtomicBoolean();
        InterleavingStringRedisTemplate interleavingTemplate = new InterleavingStringRedisTemplate(
                stringRedisTemplate, () -> {
                    summaryObserved.set(true);
                    stringRedisTemplate.opsForStream().acknowledge(streamKey, group, recordId);
                });
        RedisPendingMessageResendJob job = new RedisPendingMessageResendJob(List.of(newListener()),
                new RedisMQTemplate(interleavingTemplate), redissonClient);

        job.messageResend();

        assertThat(summaryObserved).as("竞争窗口必须在真实汇总读取之后才触发").isTrue();
        assertThat(stringRedisTemplate.opsForStream().size(streamKey))
                .as("消息已被确认，不得再重投").isEqualTo(1L);
        assertThat(stringRedisTemplate.opsForStream().pending(streamKey, group).getTotalPendingMessages())
                .isZero();
    }

    /**
     * 把当前待确认消息的空闲时间改到 5 分钟窗口之外并返回其编号。
     *
     * <p>用原生 {@code XCLAIM ... IDLE} 真实改写空闲时间；服务端不支持该选项时前置断言会失败，
     * 用例以“无法构造超时待确认消息”收场而不是静默跳过。</p>
     *
     * @return 被改写的待确认消息编号
     */
    private String markPendingMessageTimedOut() {
        String recordId = stringRedisTemplate.opsForStream().range(streamKey, Range.unbounded())
                .get(0).getId().getValue();
        Long claimed = stringRedisTemplate.execute((RedisCallback<Long>) connection -> connection.eval(
                utf8(CLAIM_WITH_IDLE_SCRIPT), ReturnType.INTEGER, 1,
                utf8(streamKey), utf8(group), utf8(pendingConsumer), utf8(recordId), utf8(CLAIM_IDLE_MILLIS)));
        assertThat(claimed).as("必须真实抢占到目标待确认消息").isEqualTo(1L);
        PendingMessage claimedMessage = stringRedisTemplate.opsForStream()
                .pending(streamKey, Consumer.from(group, pendingConsumer), Range.unbounded(), 10L).get(0);
        assertThat(claimedMessage.getElapsedTimeSinceLastDelivery().getSeconds())
                .as("XCLAIM ... IDLE 必须真实生效（需要 Redis 6.2+），否则无法构造超时待确认消息")
                .isGreaterThanOrEqualTo(300L);
        return recordId;
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
     * 在真实汇总读取之后注入一次真实确认的字符串模板，用于固定竞争窗口。
     *
     * <p>只代理 {@code opsForStream()}：除在首次两参数 {@code XPENDING} 汇总返回后执行一次注入动作外，
     * 其余命令与返回值都原样交给真实模板，因此被测任务面对的仍是真实 Redis 结果。</p>
     */
    static class InterleavingStringRedisTemplate extends StringRedisTemplate {

        /** 真实模板的 Stream 操作，代理只在其外层附加注入动作。 */
        private final StreamOperations<String, Object, Object> delegate;
        /** 首次汇总读取返回后执行的动作。 */
        private final Runnable afterSummaryRead;
        /** 保证注入动作只触发一次。 */
        private final AtomicBoolean summaryRead = new AtomicBoolean();
        /** 对外暴露的代理操作。 */
        private final StreamOperations<String, Object, Object> operations;

        /**
         * 基于真实模板连接创建代理模板。
         *
         * @param delegate 连接同一个隔离 Redis 的真实模板
         * @param afterSummaryRead 首次汇总读取后执行的动作
         */
        @SuppressWarnings("unchecked")
        InterleavingStringRedisTemplate(StringRedisTemplate delegate, Runnable afterSummaryRead) {
            super(delegate.getConnectionFactory());
            afterPropertiesSet();
            this.delegate = delegate.opsForStream();
            this.afterSummaryRead = afterSummaryRead;
            this.operations = (StreamOperations<String, Object, Object>) Proxy.newProxyInstance(
                    StreamOperations.class.getClassLoader(), new Class<?>[] {StreamOperations.class},
                    this::invokeWithInterleaving);
        }

        /** 返回附加了竞争窗口注入的 Stream 操作。 */
        @Override
        @SuppressWarnings("unchecked")
        public <HK, HV> StreamOperations<String, HK, HV> opsForStream() {
            return (StreamOperations<String, HK, HV>) operations;
        }

        /**
         * 先执行真实命令，再在首次两参数汇总读取后触发注入动作。
         *
         * @param proxy 代理对象
         * @param method 被调用的 Stream 操作
         * @param args 调用参数
         * @return 真实命令的返回值
         * @throws Throwable 真实命令抛出的异常原样传播
         */
        private Object invokeWithInterleaving(Object proxy, Method method, Object[] args) throws Throwable {
            Object result = method.invoke(delegate, args);
            if ("pending".equals(method.getName()) && args != null && args.length == 2
                    && summaryRead.compareAndSet(false, true)) {
                afterSummaryRead.run();
            }
            return result;
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
