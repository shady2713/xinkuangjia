package com.basicframework.module.system.framework.captcha.config;

import com.anji.captcha.properties.AjCaptchaProperties;
import com.anji.captcha.service.CaptchaCacheService;
import com.anji.captcha.util.ImageUtils;
import com.basicframework.module.system.framework.captcha.core.RedisCaptchaServiceImpl;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.redisson.Redisson;
import org.redisson.api.RedissonClient;
import org.redisson.config.Config;
import org.redisson.spring.data.connection.RedissonConnectionFactory;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证验证码配置注册的缓存实现与启动图片加载器。
 *
 * <p>验证码缓存决定滑块校验能否跨请求生效：Redis 实现必须真正拿到连接模板，否则校验时直接空指针；
 * 启动图片加载器决定登录页使用的背景图，加载失败按约定阻止启动（不允许回退到依赖包默认素材）。
 * 用例连接真实隔离 Redis 断言写入与过期时间，并用真实类路径资源驱动加载器。</p>
 *
 * <p>需要外部注入隔离 Redis 连接；缺失环境变量时直接失败，不退化成内存替身。</p>
 *
 * @author shady2713
 */
class BasicFrameworkCaptchaConfigurationTest {

    /** 本测试类独占的键前缀，清理只按它定位。 */
    private static String keyPrefix;
    /** 真实 Redis 连接工厂。 */
    private static RedissonConnectionFactory connectionFactory;
    /** 真实 Redisson 客户端，结束时关闭。 */
    private static RedissonClient redissonClient;

    /** 连接隔离 Redis，缺少环境变量时直接失败。 */
    @BeforeAll
    static void startRedis() throws Exception {
        int port = Integer.parseInt(requiredEnvironment("BF_TEST_REDIS_PORT"));
        Config redissonConfig = new Config();
        redissonConfig.useSingleServer()
                .setAddress("redis://127.0.0.1:" + port)
                .setPassword(requiredEnvironment("BF_TEST_REDIS_PASSWORD"))
                .setConnectionMinimumIdleSize(1)
                .setConnectionPoolSize(4);
        redissonClient = Redisson.create(redissonConfig);
        connectionFactory = new RedissonConnectionFactory(redissonClient);
        connectionFactory.afterPropertiesSet();
        keyPrefix = "r8-captcha-" + UUID.randomUUID() + ":";
    }

    /** 关闭连接工厂与客户端前清理本类写入的键。 */
    @AfterAll
    static void stopRedis() throws Exception {
        if (connectionFactory != null) {
            StringRedisTemplate probe = new StringRedisTemplate(connectionFactory);
            probe.afterPropertiesSet();
            probe.delete(keyPrefix + "code");
            connectionFactory.destroy();
        }
        if (redissonClient != null) {
            redissonClient.shutdown();
        }
    }

    /**
     * Redis 缓存实现必须拿到真实连接模板，写入的验证码必须真的落到 Redis 并带过期时间。
     *
     * <p>这是登录校验的关键路径：未注入模板时 {@code set} 会直接空指针，注入错误模板则会写到别的实例。</p>
     */
    @Test
    void captchaCacheServiceInjectsRedisTemplateAndWritesToRedis() {
        StringRedisTemplate template = new StringRedisTemplate(connectionFactory);
        template.afterPropertiesSet();
        AjCaptchaProperties properties = new AjCaptchaProperties();
        properties.setCacheType(AjCaptchaProperties.StorageType.redis);

        CaptchaCacheService cacheService = new BasicFrameworkCaptchaConfiguration()
                .captchaCacheService(properties, template);
        String key = keyPrefix + "code";
        cacheService.set(key, "DUMMY-CODE", 120L);

        assertThat(cacheService).as("Redis 类型必须解析到项目的 Redis 实现")
                .isInstanceOf(RedisCaptchaServiceImpl.class);
        assertThat(cacheService.type()).isEqualTo("redis");
        assertThat(template.opsForValue().get(key)).as("验证码必须真的写入 Redis").isEqualTo("DUMMY-CODE");
        assertThat(template.getExpire(key)).as("必须按声明设置过期时间").isBetween(60L, 120L);
        assertThat(cacheService.exists(key)).isTrue();

        cacheService.delete(key);
        assertThat(cacheService.exists(key)).as("删除后必须不可见").isFalse();
    }

    /** 本地缓存类型必须解析到依赖包实现，且不得被注入 Redis 模板。 */
    @Test
    void captchaCacheServiceKeepsLocalImplementation() {
        StringRedisTemplate template = new StringRedisTemplate(connectionFactory);
        template.afterPropertiesSet();
        AjCaptchaProperties properties = new AjCaptchaProperties();
        properties.setCacheType(AjCaptchaProperties.StorageType.local);

        CaptchaCacheService cacheService = new BasicFrameworkCaptchaConfiguration()
                .captchaCacheService(properties, template);

        assertThat(cacheService).as("本地类型不得被替换成 Redis 实现")
                .isNotInstanceOf(RedisCaptchaServiceImpl.class);
        assertThat(cacheService.type()).isEqualTo("local");
    }

    /**
     * 启动加载器必须能加载真实类路径下的自定义背景图，并保持缓存内容可解码。
     *
     * <p>加载失败按实现约定直接阻止启动，因此这里断言调用不抛错且缓存中的背景图仍是可解码的真实图片。</p>
     */
    @Test
    void captchaJigsawImageCacheLoaderLoadsImages() {
        SmartInitializingSingleton loader = new BasicFrameworkCaptchaConfiguration()
                .captchaJigsawImageCacheLoader();

        loader.afterSingletonsInstantiated();

        assertThat(ImageUtils.getOriginal()).as("自定义背景图必须已进入可解码的启动缓存").isNotNull();
        assertThat(ImageUtils.getOriginal().getWidth()).isPositive();
        assertThat(ImageUtils.getOriginal().getHeight()).isPositive();
    }

    /** 缺失隔离环境时直接失败，避免退化成跳过真实 Redis 证据。 */
    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("缺少隔离测试环境变量 " + name);
        }
        return value;
    }

}
