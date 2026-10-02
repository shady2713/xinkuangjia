package com.basicframework.module.system.framework.sms.config;

import com.basicframework.module.system.framework.sms.core.client.SmsClientFactory;
import com.basicframework.module.system.framework.sms.core.client.impl.SmsClientFactoryImpl;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 短信配置类，包括短信客户端、短信验证码两部分
 *
 * @author 李杰
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(SmsCodeProperties.class)
public class SmsConfiguration {

    /**
     * 完成 smsClientFactory 对应的业务处理。
     *
     * @return 方法处理结果
     */
    @Bean
    public SmsClientFactory smsClientFactory() {
        return new SmsClientFactoryImpl();
    }

}
