package com.basicframework.framework.signature.config;

import com.basicframework.framework.redis.config.BasicFrameworkRedisAutoConfiguration;
import com.basicframework.framework.signature.core.aop.ApiSignatureAspect;
import com.basicframework.framework.signature.core.redis.ApiSignatureRedisDAO;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.data.redis.core.StringRedisTemplate;

/**
 * HTTP API 签名自动配置类，注册签名切面和签名 Redis 访问对象。
 *
 * @author 李杰
 */
@AutoConfiguration(after = BasicFrameworkRedisAutoConfiguration.class)
public class BasicFrameworkApiSignatureAutoConfiguration {

    /**
     * 创建 HTTP API 签名切面。
     *
     * @param signatureRedisDAO 签名 Redis 访问对象
     * @return HTTP API 签名切面
     */
    @Bean
    public ApiSignatureAspect signatureAspect(ApiSignatureRedisDAO signatureRedisDAO) {
        return new ApiSignatureAspect(signatureRedisDAO);
    }

    /**
     * 创建 HTTP API 签名 Redis 访问对象。
     *
     * @param stringRedisTemplate 字符串 Redis 模板
     * @return 签名 Redis 访问对象
     */
    @Bean
    public ApiSignatureRedisDAO signatureRedisDAO(StringRedisTemplate stringRedisTemplate) {
        return new ApiSignatureRedisDAO(stringRedisTemplate);
    }

}
