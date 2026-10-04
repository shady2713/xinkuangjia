package com.basicframework.framework.redis.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证缓存扩展配置项的绑定前缀与默认值。
 *
 * <p>批次大小决定清理缓存时一次向 Redis 取回的键数量：默认值被改动会让所有未显式配置的环境
 * 同时改变扫描压力，绑定前缀被改动则运维写入的配置会被静默忽略、继续按默认值扫描。
 * 因此这里分别锁定默认值与生产配置键的实际绑定结果。</p>
 *
 * @author shady2713
 */
class BasicFrameworkCachePropertiesTest {

    /** 未提供任何配置时必须使用与 RedisCacheWriter 批次一致的文档默认值。 */
    @Test
    void redisScanBatchSizeUsesDocumentedDefault() {
        BasicFrameworkCacheProperties properties = new BasicFrameworkCacheProperties();

        assertThat(properties.getRedisScanBatchSize())
                .as("未配置时必须使用默认批次大小")
                .isEqualTo(30);
    }

    /** 生产配置键必须真实绑定到属性，否则运维改动不会生效。 */
    @Test
    void bindsRedisScanBatchSizeFromConfigurationNamespace() {
        MockEnvironment environment = new MockEnvironment()
                .withProperty("basic-framework.cache.redis-scan-batch-size", "128");

        BasicFrameworkCacheProperties properties = Binder.get(environment)
                .bind("basic-framework.cache", BasicFrameworkCacheProperties.class)
                .get();

        assertThat(properties.getRedisScanBatchSize())
                .as("basic-framework.cache 命名空间下的配置必须生效")
                .isEqualTo(128);
    }
}
