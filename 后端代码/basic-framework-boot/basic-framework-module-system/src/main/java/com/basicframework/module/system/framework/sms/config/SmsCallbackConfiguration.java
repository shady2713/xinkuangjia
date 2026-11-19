package com.basicframework.module.system.framework.sms.config;

import com.basicframework.module.system.framework.sms.core.callback.SmsCallbackSignatureVerifier;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;

/**
 * 短信回调配置，注册回调签名属性与校验器。
 *
 * @author shady2713
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(SmsCallbackProperties.class)
public class SmsCallbackConfiguration {

    /**
     * 创建短信回调签名校验器，供回调入口在写入回执状态前校验请求来源与重放窗口。
     *
     * @param properties                  短信回调配置
     * @param stringRedisTemplateProvider 可选 Redis 客户端提供器
     * @return 短信回调签名校验器
     */
    @Bean
    public SmsCallbackSignatureVerifier smsCallbackSignatureVerifier(
            SmsCallbackProperties properties,
            ObjectProvider<StringRedisTemplate> stringRedisTemplateProvider) {
        return new SmsCallbackSignatureVerifier(properties, stringRedisTemplateProvider.getIfAvailable());
    }

}
