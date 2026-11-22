package com.basicframework.module.system.framework.sms.config;

import com.basicframework.module.system.framework.sms.core.AliyunSmsSender;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 极简短信配置类：仅绑定验证码频控与阿里云短信配置。
 *
 * @author 李杰
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties({SmsCodeProperties.class, AliyunSmsProperties.class})
public class SmsConfiguration {

    @Bean
    public AliyunSmsSender aliyunSmsSender(AliyunSmsProperties properties) {
        return new AliyunSmsSender(properties);
    }

}
