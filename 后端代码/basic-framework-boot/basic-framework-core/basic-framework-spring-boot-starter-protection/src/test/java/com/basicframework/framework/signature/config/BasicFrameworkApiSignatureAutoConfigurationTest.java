package com.basicframework.framework.signature.config;

import com.basicframework.framework.protection.support.ProtectionRedisTestSupport;
import com.basicframework.framework.signature.core.aop.ApiSignatureAspect;
import com.basicframework.framework.signature.core.redis.ApiSignatureRedisDAO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.data.redis.core.StringRedisTemplate;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 API 签名自动配置在最小上下文中装配出切面与 Redis 访问对象，且共享同一份密钥数据。
 *
 * <p>签名切面与访问对象必须指向同一份密钥与随机数数据：一旦注入的不是同一个模板，预加载的密钥就读不到，
 * 所有签名请求都会被判为未授权。这里因此用真实 Redis 预加载密钥，再从上下文里取回访问对象读一次，
 * 证明装配结果是可用的而不是两个互不相干的空壳。</p>
 *
 * @author shady2713
 */
class BasicFrameworkApiSignatureAutoConfigurationTest extends ProtectionRedisTestSupport {

    /** 生产代码使用的固定 HASH 键名，存放 appId 与 appSecret 的映射。 */
    private static final String SIGNATURE_APPID_KEY = "api_signature_app";

    /** 本测试类的应用编号，带随机前缀。 */
    private String appId;

    /** 本测试类的应用密钥。 */
    private String appSecret;

    /**
     * 把应用密钥预加载到固定的 HASH 中，供上下文里的访问对象读取。
     */
    @BeforeEach
    void setUp() {
        appId = nextKey("app");
        appSecret = "secret-" + appId;
        stringRedisTemplate.opsForHash().put(SIGNATURE_APPID_KEY, appId, appSecret);
        trackHashField(SIGNATURE_APPID_KEY, appId);
    }

    /**
     * 验证签名相关的 Bean 都被注册。
     */
    @Test
    @DisplayName("API 签名自动配置注册切面与 Redis 访问对象")
    void shouldRegisterSignatureBeans() {
        contextRunner().run(context -> {
            assertThat(context).hasSingleBean(ApiSignatureAspect.class);
            assertThat(context).hasSingleBean(ApiSignatureRedisDAO.class);
        });
    }

    /**
     * 验证装配出来的访问对象能读到预加载的密钥，证明切面与访问对象共享同一份数据。
     */
    @Test
    @DisplayName("装配出来的签名 Redis 访问对象能读到预加载的密钥")
    void shouldReadPreloadedAppSecretFromContext() {
        contextRunner().run(context -> {
            ApiSignatureRedisDAO apiSignatureRedisDAO = context.getBean(ApiSignatureRedisDAO.class);

            assertThat(apiSignatureRedisDAO.getAppSecret(appId))
                    .as("访问对象必须连到预加载密钥的那个实例，否则所有验签都会失败")
                    .isEqualTo(appSecret);
        });
    }

    /**
     * 构造只装配被测自动配置的最小上下文，并把真实的字符串模板作为依赖注入。
     *
     * @return 最小上下文运行器
     */
    private ApplicationContextRunner contextRunner() {
        return new ApplicationContextRunner()
                .withBean(StringRedisTemplate.class, () -> stringRedisTemplate)
                .withConfiguration(AutoConfigurations.of(BasicFrameworkApiSignatureAutoConfiguration.class));
    }
}
