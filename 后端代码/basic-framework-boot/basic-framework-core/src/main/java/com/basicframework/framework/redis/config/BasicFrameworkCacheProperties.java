package com.basicframework.framework.redis.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * 缓存扩展配置项（与 {@code basic-framework.cache} 命名空间绑定）。
 *
 * @author 李杰
 *
 */
@ConfigurationProperties("basic-framework.cache")
@Data
@Validated
public class BasicFrameworkCacheProperties {

    /**
     * {@link #redisScanBatchSize} 默认值
     */
    private static final Integer REDIS_SCAN_BATCH_SIZE_DEFAULT = 30;

    /**
     * redis scan 一次返回数量
     * <p>用于 RedisCacheWriter 的 scan 批次大小，影响清理/扫描场景下的内存占用与单次查询压力。</p>
     */
    private Integer redisScanBatchSize = REDIS_SCAN_BATCH_SIZE_DEFAULT;

}
