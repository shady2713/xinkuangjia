package com.basicframework.framework.redis.config;

import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.redis.core.TimeoutRedisCacheManager;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.cache.CacheProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.data.redis.cache.BatchStrategies;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.cache.RedisCacheWriter;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.serializer.RedisSerializationContext;
import org.springframework.util.StringUtils;

import java.util.Objects;

import static com.basicframework.framework.redis.config.BasicFrameworkRedisAutoConfiguration.buildRedisSerializer;

/**
 * Cache 配置类，基于 Redis 实现
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-framework/yudao-spring-boot-starter-redis/src/main/java/cn/iocoder/yudao/framework/redis/config/
 * 上游文件续：YudaoCacheAutoConfiguration.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：命名空间与类名前缀适配，缓存属性改为 BasicFrameworkCacheProperties；补全职责与方法 JavaDoc。
 */
@AutoConfiguration
@EnableConfigurationProperties({CacheProperties.class, BasicFrameworkCacheProperties.class})
@EnableCaching
public class BasicFrameworkCacheAutoConfiguration {

    /**
     * 构建 Redis 缓存基础配置。
     *
     * <p>参考 Spring Boot 的 RedisCacheConfiguration.createConfiguration 设计，补充自定义前缀与 JSON 序列化器。</p>
     *
     * @param cacheProperties Spring Boot 缓存配置
     * @return RedisCacheConfiguration
     */
    @Bean
    @Primary
    public RedisCacheConfiguration redisCacheConfiguration(CacheProperties cacheProperties) {
        RedisCacheConfiguration config = RedisCacheConfiguration.defaultCacheConfig();
        config = config.computePrefixWith(cacheName -> {
            String keyPrefix = cacheProperties.getRedis().getKeyPrefix();
            if (StringUtils.hasText(keyPrefix)) {
                keyPrefix = keyPrefix.lastIndexOf(StrUtil.COLON) == -1 ? keyPrefix + StrUtil.COLON : keyPrefix;
                return keyPrefix + cacheName + StrUtil.COLON;
            }
            return cacheName + StrUtil.COLON;
        });
        // 设置使用 JSON 序列化方式
        config = config.serializeValuesWith(
                RedisSerializationContext.SerializationPair.fromSerializer(buildRedisSerializer()));

        // 设置 CacheProperties.Redis 的属性
        CacheProperties.Redis redisProperties = cacheProperties.getRedis();
        if (redisProperties.getTimeToLive() != null) {
            config = config.entryTtl(redisProperties.getTimeToLive());
        }
        if (!redisProperties.isCacheNullValues()) {
            config = config.disableCachingNullValues();
        }
        if (!redisProperties.isUseKeyPrefix()) {
            config = config.disableKeyPrefix();
        }
        return config;
    }

    /**
     * 完成 redisCacheManager 对应的业务处理。
     *
     * @param redisTemplate redis模板参数
     * @param redisCacheConfiguration redis缓存Configuration参数
     * @param basicFrameworkCacheProperties 配置参数
     * @return 方法处理结果
     */
    @Bean
    public RedisCacheManager redisCacheManager(RedisTemplate<String, Object> redisTemplate,
                                               RedisCacheConfiguration redisCacheConfiguration,
                                               BasicFrameworkCacheProperties basicFrameworkCacheProperties) {
        // 创建 RedisCacheWriter 对象
        RedisConnectionFactory connectionFactory = Objects.requireNonNull(redisTemplate.getConnectionFactory());
        RedisCacheWriter cacheWriter = RedisCacheWriter.nonLockingRedisCacheWriter(connectionFactory,
                BatchStrategies.scan(basicFrameworkCacheProperties.getRedisScanBatchSize()));
        // 创建 RedisCacheManager 对象
        return new TimeoutRedisCacheManager(cacheWriter, redisCacheConfiguration);
    }

}
