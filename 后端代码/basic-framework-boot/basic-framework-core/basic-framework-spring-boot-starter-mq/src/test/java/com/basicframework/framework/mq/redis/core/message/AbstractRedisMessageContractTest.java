package com.basicframework.framework.mq.redis.core.message;

import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.framework.mq.redis.core.pubsub.AbstractRedisChannelMessage;
import com.basicframework.framework.mq.redis.core.stream.AbstractRedisStreamMessage;
import lombok.Getter;
import lombok.Setter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 用真实序列化结果验证三类 Redis 消息的公共契约：消息头读写、频道与 Stream Key 的推导规则。
 *
 * <p>这两个抽象基类没有可执行的发送逻辑，但它们决定了消息体里出现哪些字段。频道与 Stream Key
 * 被 {@code @JsonIgnore} 排除是有意为之——Redis 发布与写入时已经单独指定路由，再放进负载会造成
 * 同一份路由信息出现两次，扩展方按负载重建路由时容易取到过期值，所以这里直接锁定字段集合。</p>
 *
 * @author shady2713
 */
class AbstractRedisMessageContractTest {

    /**
     * 验证消息头按名称读写，并且未写入的名称返回 {@code null} 而不是空串。
     *
     * <p>拦截器依赖 {@code getHeader} 判断消息来源，缺失与空串必须可区分，否则无法判断是否要补默认值。</p>
     */
    @Test
    @DisplayName("消息头按名称读写，未写入的名称返回 null 而非空串")
    void shouldReadAndWriteHeaders() {
        DemoChannelMessage message = new DemoChannelMessage();

        assertThat(message.getHeader("tenant")).isNull();
        message.addHeader("tenant", "1024");
        message.addHeader("tenant", "2048");

        assertThat(message.getHeader("tenant")).isEqualTo("2048");
        assertThat(message.getHeaders()).containsExactly(Map.entry("tenant", "2048"));
    }

    /**
     * 验证消息头容器按实例隔离。
     *
     * <p>消息头是实例字段，若在并发消费下共享同一个 Map，租户或链路标识会互相覆盖，
     * 因此这里用两个实例证明写入互不影响。</p>
     */
    @Test
    @DisplayName("消息头按实例隔离，并发消费不会互相覆盖租户标识")
    void shouldIsolateHeadersPerInstance() {
        DemoStreamMessage first = new DemoStreamMessage();
        DemoStreamMessage second = new DemoStreamMessage();

        first.addHeader("tenant", "1024");

        assertThat(second.getHeader("tenant")).isNull();
        assertThat(second.getHeaders()).isEmpty();
    }

    /**
     * 验证 Pub/Sub 消息以类名推导频道，且频道不会进入 JSON 负载。
     *
     * <p>监听器的无参构造依赖同一个类名解析订阅频道，序列化若带上频道，扩展方按负载自建路由时会
     * 与真实发布频道产生分叉。</p>
     */
    @Test
    @DisplayName("Pub/Sub 消息以类名作为频道，频道被排除在 JSON 负载之外")
    void shouldDeriveChannelFromTypeAndExcludeItFromPayload() {
        DemoChannelMessage message = new DemoChannelMessage();
        message.setContent("hello");

        assertThat(message.getChannel()).isEqualTo("DemoChannelMessage");
        assertThat(serializedFieldNames(message)).containsExactlyInAnyOrder("headers", "content");
    }

    /**
     * 验证 Stream 消息以类名推导 Stream Key，且 Key 不会进入 JSON 负载。
     *
     * <p>Stream Key 同时是清理任务与重投任务的遍历范围，一旦混入负载，扩展方可能写入另一个 Key
     * 导致消息既不被清理也不被重投。</p>
     */
    @Test
    @DisplayName("Stream 消息以类名作为 Stream Key，Key 被排除在 JSON 负载之外")
    void shouldDeriveStreamKeyFromTypeAndExcludeItFromPayload() {
        DemoStreamMessage message = new DemoStreamMessage();
        message.setContent("hello");

        assertThat(message.getStreamKey()).isEqualTo("DemoStreamMessage");
        assertThat(serializedFieldNames(message)).containsExactlyInAnyOrder("headers", "content");
    }

    /**
     * 读取消息实际被序列化出的字段名，用来证明路由字段确实被排除在负载之外。
     *
     * @param message 待序列化消息
     * @return JSON 中的字段名集合
     */
    private static Set<String> serializedFieldNames(AbstractRedisMessage message) {
        Iterator<String> names = JsonUtils.parseTree(JsonUtils.toJsonString(message)).fieldNames();
        Set<String> fields = new LinkedHashSet<>();
        names.forEachRemaining(fields::add);
        return fields;
    }

    /**
     * 用于验证 Pub/Sub 频道推导的最小消息。
     */
    @Getter
    @Setter
    static final class DemoChannelMessage extends AbstractRedisChannelMessage {

        /**
         * 业务负载，用于确认消息体确实被序列化。
         */
        private String content;
    }

    /**
     * 用于验证 Stream Key 推导的最小消息。
     */
    @Getter
    @Setter
    static final class DemoStreamMessage extends AbstractRedisStreamMessage {

        /**
         * 业务负载，用于确认消息体确实被序列化。
         */
        private String content;
    }
}
