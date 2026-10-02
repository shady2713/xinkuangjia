package com.basicframework.framework.mq.rabbitmq.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.amqp.ConnectionFactoryCustomizer;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.context.annotation.Bean;

/**
 * RabbitMQ 消息队列配置类
 *
 * @author 李杰
 */
@AutoConfiguration
@Slf4j
@ConditionalOnClass(name = "org.springframework.amqp.rabbit.core.RabbitTemplate")
public class BasicFrameworkRabbitMQAutoConfiguration {

    private static final int DEFAULT_MAX_INBOUND_MESSAGE_BODY_SIZE = 128 * 1024 * 1024;

    /**
     * Jackson2JsonMessageConverter Bean：使用 jackson 序列化消息
     */
    @Bean
    public MessageConverter createMessageConverter() {
        return new Jackson2JsonMessageConverter();
    }

    /**
     * 调整 RabbitMQ Java 客户端入站消息体上限，避免历史大结果消息直接打断连接。
     *
     * @param maxInboundMessageBodySize 入站消息体最大字节数，小于等于 0 时不覆盖客户端默认值
     * @return RabbitMQ 连接工厂定制器
     */
    @Bean
    public ConnectionFactoryCustomizer rabbitConnectionFactoryCustomizer(
            @Value("${basic-framework.rabbitmq.max-inbound-message-body-size:" + DEFAULT_MAX_INBOUND_MESSAGE_BODY_SIZE + "}")
            int maxInboundMessageBodySize) {
        return connectionFactory -> {
            if (maxInboundMessageBodySize <= 0) {
                return;
            }
            connectionFactory.setMaxInboundMessageBodySize(maxInboundMessageBodySize);
            log.info("[rabbitConnectionFactoryCustomizer][maxInboundMessageBodySize({})]", maxInboundMessageBodySize);
        };
    }

}
