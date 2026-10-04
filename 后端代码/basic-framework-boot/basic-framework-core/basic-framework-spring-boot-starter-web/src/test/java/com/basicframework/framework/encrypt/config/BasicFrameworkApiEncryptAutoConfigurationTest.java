package com.basicframework.framework.encrypt.config;

import com.basicframework.framework.common.biz.infra.logger.ApiErrorLogCommonApi;
import com.basicframework.framework.common.enums.WebFilterOrderEnum;
import com.basicframework.framework.encrypt.core.filter.ApiEncryptFilter;
import com.basicframework.framework.web.config.WebProperties;
import com.basicframework.framework.web.core.handler.GlobalExceptionHandler;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * 验证 API 加解密自动配置的装配开关与过滤器注册契约。
 *
 * <p>该配置类只在 {@code basic-framework.api-encrypt.enable=true} 时注册过滤器：
 * 条件写错会让加解密在未开启时被静默启用（前端明文请求被拒绝），或开启后过滤器未注册
 * （前端密文请求被当成明文解析）。注册顺序同样重要——解密必须在请求体缓存之后执行，
 * 否则过滤器读到的正文已被缓存过滤器消费。</p>
 *
 * @author shady2713
 */
class BasicFrameworkApiEncryptAutoConfigurationTest {

    /** 被测自动配置类，通过直接调用其工厂方法观察真实装配结果。 */
    private static final BasicFrameworkApiEncryptAutoConfiguration CONFIGURATION =
            new BasicFrameworkApiEncryptAutoConfiguration();

    /**
     * 自动配置必须由 api-encrypt.enable 精确等于 true 触发。
     *
     * <p>锁定前缀、属性名与匹配值三者，任何一项写错都会改变启用条件；
     * 同时确认未声明 {@code matchIfMissing}，即缺少配置时不启用。</p>
     */
    @Test
    void activationIsConditionalOnExplicitEnableFlag() {
        ConditionalOnProperty condition = BasicFrameworkApiEncryptAutoConfiguration.class
                .getAnnotation(ConditionalOnProperty.class);

        assertThat(condition).as("缺少条件注解会让加解密在未开启时也被装配").isNotNull();
        assertThat(condition.prefix()).isEqualTo("basic-framework.api-encrypt");
        assertThat(condition.name()).containsExactly("enable");
        assertThat(condition.havingValue()).isEqualTo("true");
        assertThat(condition.matchIfMissing()).as("缺少配置时必须不启用").isFalse();
    }

    /**
     * 工厂方法必须返回按约定顺序注册的 API 加解密过滤器。
     *
     * <p>断言真实过滤器类型与注册顺序：顺序错误会让解密读到已被消费的请求体，
     * 表现为开启加解密后所有密文请求解析失败。</p>
     */
    @Test
    void apiEncryptFilterIsRegisteredWithConfiguredOrder() {
        FilterRegistrationBean<ApiEncryptFilter> registration = CONFIGURATION.apiEncryptFilter(
                new WebProperties(), aesProperties(), new RequestMappingHandlerMapping(), globalExceptionHandler());

        assertThat(registration).isNotNull();
        assertThat(registration.getFilter()).isInstanceOf(ApiEncryptFilter.class);
        assertThat(registration.getOrder()).isEqualTo(WebFilterOrderEnum.API_ENCRYPT_FILTER);
        assertThat(registration.getOrder())
                .as("解密必须排在请求体缓存过滤器之后").isEqualTo(WebFilterOrderEnum.REQUEST_BODY_CACHE_FILTER + 1);
    }

    /**
     * 每次调用必须返回独立注册对象，避免共享 Bean 被后续修改影响。
     *
     * <p>配置类方法可被多次调用（例如测试上下文重复刷新），返回同一实例会让
     * 一次顺序调整污染其他注册结果。</p>
     */
    @Test
    void eachCallReturnsIndependentRegistration() {
        FilterRegistrationBean<ApiEncryptFilter> first = CONFIGURATION.apiEncryptFilter(
                new WebProperties(), aesProperties(), new RequestMappingHandlerMapping(), globalExceptionHandler());
        FilterRegistrationBean<ApiEncryptFilter> second = CONFIGURATION.apiEncryptFilter(
                new WebProperties(), aesProperties(), new RequestMappingHandlerMapping(), globalExceptionHandler());

        assertThat(first).isNotSameAs(second);
        assertThat(first.getFilter()).isNotSameAs(second.getFilter());
    }

    /**
     * 构造全局异常处理器，日志上报协作者按外部边界替换为替身。
     *
     * <p>过滤器只持有该引用，注册断言不触发异常处理，因此无需真实日志上报链路。</p>
     *
     * @return 装配完成的全局异常处理器
     */
    private static GlobalExceptionHandler globalExceptionHandler() {
        return new GlobalExceptionHandler("basic-framework-test", mock(ApiErrorLogCommonApi.class));
    }

    /**
     * 构造满足 AES 分支校验的加解密配置。
     *
     * <p>过滤器构造时会校验密钥长度，密钥必须为 16／24／32 字节；此处使用 16 字节合成密钥，
     * 不对应任何真实环境凭据。</p>
     *
     * @return 算法为 AES 且密钥合法的加解密配置
     */
    private static ApiEncryptProperties aesProperties() {
        ApiEncryptProperties properties = new ApiEncryptProperties();
        properties.setEnable(true);
        properties.setAlgorithm("AES");
        properties.setRequestKey("DUMMY-REQ-KEY-16");
        properties.setResponseKey("DUMMY-RES-KEY-16");
        return properties;
    }
}
