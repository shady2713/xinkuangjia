package com.basicframework.framework.mq.redis.config;

import com.basicframework.framework.mq.redis.core.RedisMQTemplate;
import com.basicframework.framework.mq.redis.core.pubsub.AbstractRedisChannelMessage;
import com.basicframework.framework.mq.redis.core.stream.AbstractRedisStreamMessage;
import com.basicframework.framework.mq.support.MqRedisTestSupport;
import com.basicframework.framework.mq.support.RecordingInterceptor;
import lombok.Getter;
import lombok.Setter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.stream.RecordId;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 Producer 自动配置把容器里的拦截器全部装进发送模板，并在真实发送时生效。
 *
 * <p>拦截器由各业务模块以 Bean 形式提供，自动配置负责集中注册。少注册一个，多租户或审计能力
 * 就会对整个应用静默失效，因此这里用真实发送证明注册结果，而不是只断言 Bean 非空。</p>
 *
 * @author shady2713
 */
public class BasicFrameworkRedisMQProducerAutoConfigurationTest extends MqRedisTestSupport {

    /**
     * 验证容器里的全部拦截器被注册到发送模板，并按注册顺序参与发送。
     *
     * <p>注册顺序就是钩子的执行顺序，顺序错了会让后注册的拦截器读不到前面补齐的消息头。</p>
     */
    @Test
    @DisplayName("容器中的全部拦截器被注册到发送模板，并按注册顺序参与真实发送")
    void shouldRegisterAllInterceptorsFromContainer() {
        List<String> events = new ArrayList<>();
        RecordingInterceptor tenant = new RecordingInterceptor("tenant", events);
        RecordingInterceptor audit = new RecordingInterceptor("audit", events);
        BasicFrameworkRedisMQProducerAutoConfiguration configuration =
                new BasicFrameworkRedisMQProducerAutoConfiguration();

        RedisMQTemplate template = configuration.redisMQTemplate(stringRedisTemplate, List.of(tenant, audit));
        trackKey(new ProducerStreamMessage().getStreamKey());
        ProducerStreamMessage message = new ProducerStreamMessage();
        message.setContent("produced-by-auto-configuration");

        template.send(message);

        assertThat(template.getInterceptors()).containsExactly(tenant, audit);
        assertThat(template.getRedisTemplate()).isSameAs(stringRedisTemplate);
        assertThat(events).containsExactly(
                "tenant.sendBefore", "audit.sendBefore", "audit.sendAfter", "tenant.sendAfter");
        assertThat(stringRedisTemplate.opsForStream().size(message.getStreamKey())).isEqualTo(1L);
    }

    /**
     * 验证没有任何拦截器 Bean 时模板依然可用。
     *
     * <p>拦截器是可选扩展点。空列表若让装配失败，所有还没接入拦截器的模块都无法启动。</p>
     */
    @Test
    @DisplayName("没有拦截器 Bean 时模板仍可装配，消息照常写入真实 Stream")
    void shouldBuildUsableTemplateWithoutInterceptors() {
        BasicFrameworkRedisMQProducerAutoConfiguration configuration =
                new BasicFrameworkRedisMQProducerAutoConfiguration();
        RedisMQTemplate template = configuration.redisMQTemplate(stringRedisTemplate, List.of());
        trackKey(new ProducerStreamMessage().getStreamKey());
        ProducerStreamMessage message = new ProducerStreamMessage();
        message.setContent("no-interceptor");

        RecordId recordId = template.send(message);

        assertThat(recordId).isNotNull();
        assertThat(template.getInterceptors()).isEmpty();
        assertThat(stringRedisTemplate.opsForStream().size(message.getStreamKey())).isEqualTo(1L);
    }

    /**
     * 验证模板持有的是注入进来的同一个 Redis 模板，而不是自建副本。
     *
     * <p>生产端与消费端必须共用连接工厂与序列化配置，各建一份会出现一边能读一边不能读的分裂。</p>
     */
    @Test
    @DisplayName("模板复用注入进来的 StringRedisTemplate，不自建副本")
    void shouldReuseInjectedStringRedisTemplate() {
        BasicFrameworkRedisMQProducerAutoConfiguration configuration =
                new BasicFrameworkRedisMQProducerAutoConfiguration();

        RedisMQTemplate template = configuration.redisMQTemplate(stringRedisTemplate, List.of());

        assertThat(template.getRedisTemplate()).isSameAs(stringRedisTemplate);
    }

    /**
     * 用于验证自动配置写入 Stream 的最小消息。
     * @author shady2713
     */
    @Getter
    @Setter
    public static final class ProducerStreamMessage extends AbstractRedisStreamMessage {

        /**
         * 业务负载。
         */
        private String content;
    }
}
