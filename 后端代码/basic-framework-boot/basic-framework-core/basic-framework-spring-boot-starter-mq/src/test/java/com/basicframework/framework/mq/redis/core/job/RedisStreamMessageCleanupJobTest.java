package com.basicframework.framework.mq.redis.core.job;

import com.basicframework.framework.mq.redis.core.RedisMQTemplate;
import com.basicframework.framework.mq.redis.core.stream.AbstractRedisStreamMessageListener;
import com.basicframework.framework.mq.redis.core.stream.AbstractRedisStreamMessage;
import com.basicframework.framework.mq.support.MqRedisTestSupport;
import lombok.Getter;
import lombok.Setter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.springframework.data.redis.core.RedisCallback;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * 用真实 Redis 验证 Stream 清理任务的四个契约：按保留上限裁剪、未超限不裁剪、单流失败不影响其它流、
 * 未拿到分布式锁时整段跳过。
 *
 * <p>清理任务运行在所有实例上，靠固定锁键保证同一时刻只有一个节点裁剪。没有锁就继续执行会让多个节点
 * 同时对同一 Stream 反复下发 XTRIM，放大服务端压力；单个 Stream 裁剪失败若向上抛出，则一个坏流会
 * 让整轮清理中断，其它 Stream 的历史消息无限堆积。</p>
 *
 * @author shady2713
 */
class RedisStreamMessageCleanupJobTest extends MqRedisTestSupport {

    /**
     * 生产常量：保留最近的消息条数。
     */
    private static final long MAX_COUNT = 10000L;

    /**
     * 超过保留上限的 Stream Key。
     *
     * <p>写入 10100 条而不是刚好超过 10000：Redis 的近似裁剪按整块宏节点（默认 100 条）删除，
     * 溢出不足一整块时一条都不会删，实测 10050 条裁剪后仍是 10050 条。</p>
     */
    private String overflowStreamKey;

    /**
     * 未超过保留上限的 Stream Key。
     */
    private String smallStreamKey;

    /**
     * 监听器列表。
     */
    private List<AbstractRedisStreamMessageListener<?>> listeners;

    /**
     * 为每个用例建立独立的 Stream 与监听器列表，键名都在随机前缀下。
     */
    @BeforeEach
    void prepareStreams() {
        trackLockKey(CLEANUP_LOCK_KEY);
        overflowStreamKey = keyPrefix + "overflow";
        smallStreamKey = keyPrefix + "small";
        listeners = List.of(
                new FixedKeyStreamListener(overflowStreamKey, keyPrefix + "overflow-group"),
                new FixedKeyStreamListener(smallStreamKey, keyPrefix + "small-group"));
        fillStream(overflowStreamKey, 10100);
        fillStream(smallStreamKey, 5);
    }

    /**
     * 验证超过保留上限的 Stream 被真实裁剪到上限以内。
     *
     * <p>{@code XTRIM MAXLEN ~} 按宏节点裁剪，实际长度只会小于等于上限，因此断言上界而不是精确值。</p>
     */
    @Test
    @DisplayName("超过保留上限的 Stream 被真实裁剪到上限以内")
    void shouldTrimOverflowStreamToKeepLimit() {
        RedisStreamMessageCleanupJob job =
                new RedisStreamMessageCleanupJob(listeners, newRedisMQTemplate(), redissonClient);
        assertThat(stringRedisTemplate.opsForStream().size(overflowStreamKey)).isGreaterThan(MAX_COUNT);

        job.cleanup();

        assertThat(stringRedisTemplate.opsForStream().size(overflowStreamKey)).isLessThanOrEqualTo(MAX_COUNT);
    }

    /**
     * 验证未超过保留上限的 Stream 保持原样。
     *
     * <p>未超限时不应删除任何消息，否则新上线的业务会在几小时内丢掉全部历史消息。</p>
     */
    @Test
    @DisplayName("未超过保留上限的 Stream 保持原样，不删除任何消息")
    void shouldKeepStreamWithinLimitUntouched() {
        RedisStreamMessageCleanupJob job =
                new RedisStreamMessageCleanupJob(listeners, newRedisMQTemplate(), redissonClient);

        job.cleanup();

        assertThat(stringRedisTemplate.opsForStream().size(smallStreamKey)).isEqualTo(5L);
    }

    /**
     * 验证单个 Stream 裁剪失败被就地吞掉，不影响同一轮里的其它 Stream。
     *
     * <p>用真实服务端拒绝写入制造失败：把 Stream 位置成字符串类型后，XTRIM 会返回 WRONGTYPE。
     * 同一个任务里的正常 Stream 仍必须完成裁剪，否则一个坏流会让历史消息无限堆积。</p>
     */
    @Test
    @DisplayName("单个 Stream 裁剪失败被吞掉，同一轮里的正常 Stream 仍完成裁剪")
    void shouldIsolateFailureToSingleStream() {
        stringRedisTemplate.opsForValue().set(smallStreamKey, "not-a-stream");
        RedisStreamMessageCleanupJob job =
                new RedisStreamMessageCleanupJob(listeners, newRedisMQTemplate(), redissonClient);

        assertThatCode(job::cleanup).doesNotThrowAnyException();

        assertThat(stringRedisTemplate.opsForStream().size(overflowStreamKey)).isLessThanOrEqualTo(MAX_COUNT);
    }

    /**
     * 验证锁被其它节点持有时整段跳过，不做任何裁剪。
     *
     * <p>用第二个真实 Redisson 客户端持有同名锁键，复现多实例同时调度的真实竞争；
     * 被跳过后 Stream 长度必须保持不变。</p>
     */
    @Test
    @DisplayName("锁被其它节点持有时整段跳过，Stream 长度保持不变")
    void shouldSkipWhenLockHeldByAnotherNode() {
        RedissonClient other = newRedissonClient(Integer.parseInt(requiredEnvironment("BF_TEST_REDIS_PORT")));
        RLock heldByOther = other.getLock(CLEANUP_LOCK_KEY);
        assertThat(heldByOther.tryLock()).as("第二个客户端必须先拿到锁").isTrue();
        RedisStreamMessageCleanupJob job =
                new RedisStreamMessageCleanupJob(listeners, newRedisMQTemplate(), redissonClient);
        try {
            job.cleanup();

            assertThat(stringRedisTemplate.opsForStream().size(overflowStreamKey)).isEqualTo(10100L);
        } finally {
            heldByOther.unlock();
        }
    }

    /**
     * 验证执行期异常被记录后仍然释放锁，下一轮调度可以继续加锁。
     *
     * <p>用一个没有底层模板的发送模板让执行在第一步就失败。若异常路径不释放锁，
     * 清理任务会在之后所有调度里静默停摆，历史消息再也得不到裁剪。</p>
     */
    @Test
    @DisplayName("执行期异常被吞掉后仍然释放锁，下一轮调度可以继续加锁")
    void shouldReleaseLockAfterExecutionFailure() {
        RedisStreamMessageCleanupJob job =
                new RedisStreamMessageCleanupJob(listeners, new RedisMQTemplate(null), redissonClient);

        assertThatCode(job::cleanup).doesNotThrowAnyException();

        RLock lock = redissonClient.getLock(CLEANUP_LOCK_KEY);
        assertThat(lock.tryLock()).as("失败路径必须释放锁").isTrue();
        lock.unlock();
    }

    /**
     * 校验清理完成后锁键没有残留，避免影响同实例上的其它任务。
     */
    @Test
    @DisplayName("正常执行结束后锁被释放，锁键不再残留")
    void shouldReleaseLockAfterSuccessfulExecution() {
        RedisStreamMessageCleanupJob job =
                new RedisStreamMessageCleanupJob(listeners, newRedisMQTemplate(), redissonClient);

        job.cleanup();

        assertThat(redissonClient.getLock(CLEANUP_LOCK_KEY).isLocked()).isFalse();
    }

    /**
     * 用流水线批量写入指定条数的消息，避免逐条往返拖慢用例。
     *
     * @param streamKey Stream Key
     * @param count 写入条数
     */
    private void fillStream(String streamKey, int count) {
        byte[] key = streamKey.getBytes(StandardCharsets.UTF_8);
        byte[] field = "payload".getBytes(StandardCharsets.UTF_8);
        stringRedisTemplate.executePipelined((RedisCallback<Object>) connection -> {
            for (int index = 0; index < count; index++) {
                connection.streamCommands().xAdd(key,
                        Map.of(field, ("value-" + index).getBytes(StandardCharsets.UTF_8)));
            }
            return null;
        });
    }

    /**
     * 使用显式 Stream Key 的监听器，清理任务只读取它的 Key。
     */
    static final class FixedKeyStreamListener extends AbstractRedisStreamMessageListener<CleanupProbeMessage> {

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
         * 清理任务不消费消息，这里无需实现真实逻辑。
         *
         * @param message 反序列化后的消息
         */
        @Override
        public void onMessage(CleanupProbeMessage message) {
        }
    }

    /**
     * 清理任务只依赖 Stream Key，消息类型仅用于满足泛型约束。
     */
    @Getter
    @Setter
    static final class CleanupProbeMessage extends AbstractRedisStreamMessage {

        /**
         * 业务负载。
         */
        private String content;
    }
}
