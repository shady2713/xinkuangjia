package com.basicframework.framework.mq.rabbitmq.config;

import com.rabbitmq.client.ConnectionFactory;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.amqp.ConnectionFactoryCustomizer;
import org.springframework.boot.test.context.FilteredClassLoader;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 用条件装配测试验证 RabbitMQ 自动配置的三个契约：类路径缺失时不生效、消息转换器固定为 JSON、
 * 入站消息体上限按配置覆盖且非正值不覆盖客户端默认值。
 *
 * <p>本机没有 RabbitMQ，测试只装配 Bean 定义并检查定制结果，不建立任何连接，避免把“配置正确”
 * 伪装成“连通性正确”。入站上限是防止历史大结果消息打断连接的兜底，配置成非正值时若直接写入
 * 0 反而会让所有消息都读不出来，因此必须保留客户端默认值。</p>
 *
 * @author shady2713
 */
class BasicFrameworkRabbitMQAutoConfigurationTest {

    /**
     * 生产默认入站消息体上限：128MB。
     */
    private static final int DEFAULT_MAX_INBOUND_MESSAGE_BODY_SIZE = 128 * 1024 * 1024;

    /**
     * 条件装配上下文。
     */
    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(BasicFrameworkRabbitMQAutoConfiguration.class));

    /**
     * 验证类路径存在 RabbitTemplate 时，JSON 转换器与连接工厂定制器都被装配。
     *
     * <p>缺少转换器时消息体只能按字节传输，接收端无法按业务类型反序列化。</p>
     */
    @Test
    @DisplayName("类路径存在 RabbitTemplate 时装配 JSON 转换器与连接工厂定制器")
    void shouldRegisterBeansWhenRabbitTemplatePresent() {
        contextRunner.run(context -> {
            assertThat(context).hasSingleBean(MessageConverter.class);
            assertThat(context.getBean(MessageConverter.class))
                    .isInstanceOf(Jackson2JsonMessageConverter.class);
            assertThat(context).hasSingleBean(ConnectionFactoryCustomizer.class);
        });
    }

    /**
     * 验证类路径缺少 RabbitTemplate 时整个自动配置不生效。
     *
     * <p>类路径里没有 RabbitMQ 却仍然注册定制器，会让不需要消息队列的应用也被迫引入连接工厂定制逻辑。</p>
     */
    @Test
    @DisplayName("类路径缺少 RabbitTemplate 时自动配置整体不生效")
    void shouldBackOffWhenRabbitTemplateAbsent() {
        contextRunner.withClassLoader(new FilteredClassLoader(RabbitTemplate.class))
                .run(context -> {
                    assertThat(context).doesNotHaveBean(MessageConverter.class);
                    assertThat(context).doesNotHaveBean(ConnectionFactoryCustomizer.class);
                });
    }

    /**
     * 验证未配置上限时按 128MB 默认值定制真实客户端。
     *
     * <p>默认值直接决定历史大结果消息是否会被打断连接，缺失配置时也必须落到该值而不是 0。</p>
     */
    @Test
    @DisplayName("未配置上限时按 128MB 默认值定制真实客户端")
    void shouldApplyDefaultInboundMessageBodySize() {
        contextRunner.run(context -> {
            ConnectionFactory clientFactory = new ConnectionFactory();

            context.getBean(ConnectionFactoryCustomizer.class).customize(clientFactory);

            assertThat(inboundMessageBodySizeOf(clientFactory))
                    .isEqualTo(DEFAULT_MAX_INBOUND_MESSAGE_BODY_SIZE);
        });
    }

    /**
     * 验证配置为非正值时保留客户端原有取值。
     *
     * <p>非正值若被写入客户端，所有消息都读不出来；先放入哨兵值即可证明定制器确实提前返回而不是
     * 恰好写回了同样的数。</p>
     */
    @Test
    @DisplayName("配置为非正值时保留客户端原有取值，不写入 0")
    void shouldKeepClientValueWhenConfiguredNonPositive() {
        contextRunner.withPropertyValues("basic-framework.rabbitmq.max-inbound-message-body-size=0")
                .run(context -> {
                    ConnectionFactory clientFactory = new ConnectionFactory();
                    clientFactory.setMaxInboundMessageBodySize(4096);

                    context.getBean(ConnectionFactoryCustomizer.class).customize(clientFactory);

                    assertThat(inboundMessageBodySizeOf(clientFactory)).isEqualTo(4096);
                });
        contextRunner.withPropertyValues("basic-framework.rabbitmq.max-inbound-message-body-size=-1")
                .run(context -> {
                    ConnectionFactory clientFactory = new ConnectionFactory();
                    clientFactory.setMaxInboundMessageBodySize(4096);

                    context.getBean(ConnectionFactoryCustomizer.class).customize(clientFactory);

                    assertThat(inboundMessageBodySizeOf(clientFactory)).isEqualTo(4096);
                });
    }

    /**
     * 验证配置为正值时按配置值覆盖客户端默认值。
     *
     * <p>已超过默认值的大结果消息需要更大的上限才能读出，覆盖失败会让这些消息持续打断连接。</p>
     */
    @Test
    @DisplayName("配置为正值时按配置值覆盖客户端默认值")
    void shouldOverrideClientValueWhenConfiguredPositive() {
        contextRunner.withPropertyValues("basic-framework.rabbitmq.max-inbound-message-body-size=33554432")
                .run(context -> {
                    ConnectionFactory clientFactory = new ConnectionFactory();
                    clientFactory.setMaxInboundMessageBodySize(4096);

                    context.getBean(ConnectionFactoryCustomizer.class).customize(clientFactory);

                    assertThat(inboundMessageBodySizeOf(clientFactory)).isEqualTo(33554432);
                });
    }

    /**
     * 读取 RabbitMQ 客户端实际生效的入站消息体上限。
     *
     * <p>客户端只提供写入方法且不建立连接即可观察，直接读私有字段比启动 broker 更贴近被测契约。</p>
     *
     * @param clientFactory RabbitMQ 客户端连接工厂
     * @return 当前生效的上限字节数
     */
    private static int inboundMessageBodySizeOf(ConnectionFactory clientFactory) {
        return (Integer) ReflectionTestUtils.getField(clientFactory, "maxInboundMessageBodySize");
    }
}
