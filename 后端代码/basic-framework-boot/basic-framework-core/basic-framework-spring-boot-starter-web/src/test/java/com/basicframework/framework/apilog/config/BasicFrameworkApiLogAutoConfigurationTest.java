package com.basicframework.framework.apilog.config;

import com.basicframework.framework.apilog.core.filter.ApiAccessLogFilter;
import com.basicframework.framework.apilog.core.interceptor.ApiAccessLogInterceptor;
import com.basicframework.framework.common.biz.infra.logger.ApiAccessLogCommonApi;
import com.basicframework.framework.common.enums.WebFilterOrderEnum;
import com.basicframework.framework.web.config.WebProperties;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 校验访问日志自动配置的过滤器注册、拦截器注册与开关条件。
 *
 * <p>访问日志依赖两条装配：过滤器负责在请求结束后把访问记录写入日志库，拦截器负责把
 * 命中的 Controller 方法存入请求属性，供过滤器补充操作名与操作类型。过滤器顺序也必须
 * 落在请求体缓存之后，否则日志里拿不到请求参数。关闭开关时不得再注册过滤器，避免关闭
 * 访问日志的部署形态仍然产生日志写入。</p>
 *
 * @author shady2713
 */
class BasicFrameworkApiLogAutoConfigurationTest {

    /** 过滤器注册 Bean 必须携带真实日志过滤器与约定顺序。 */
    @Test
    void filterRegistrationCarriesFilterAndOrder() {
        FilterRegistrationBean<ApiAccessLogFilter> registrationBean = new BasicFrameworkApiLogAutoConfiguration()
                .apiAccessLogFilter(new WebProperties(), "basic-framework-server", createDTO -> {
                });

        assertThat(registrationBean.getFilter()).isInstanceOf(ApiAccessLogFilter.class);
        assertThat(registrationBean.getOrder())
                .as("必须排在请求体缓存之后").isEqualTo(WebFilterOrderEnum.API_ACCESS_LOG_FILTER);
    }

    /** 必须注册访问日志拦截器，否则访问日志缺少 Controller 方法信息。 */
    @Test
    void addInterceptorsRegistersApiAccessLogInterceptor() {
        InspectableInterceptorRegistry registry = new InspectableInterceptorRegistry();

        new BasicFrameworkApiLogAutoConfiguration().addInterceptors(registry);

        assertThat(registry.registered()).hasSize(1);
        assertThat(registry.registered().get(0)).isInstanceOf(ApiAccessLogInterceptor.class);
    }

    /** 真实最小上下文必须注册过滤器 Bean，并在关闭开关时不再注册。 */
    @Test
    void contextRegistersFilterOnlyWhenAccessLogEnabled() {
        ApplicationContextRunner contextRunner = new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(BasicFrameworkApiLogAutoConfiguration.class))
                .withBean(WebProperties.class, WebProperties::new)
                .withBean(ApiAccessLogCommonApi.class, () -> createDTO -> {
                })
                .withPropertyValues("spring.application.name=basic-framework-server");

        contextRunner.run(context -> {
            assertThat(context).hasNotFailed();
            FilterRegistrationBean<?> registrationBean =
                    context.getBean("apiAccessLogFilter", FilterRegistrationBean.class);
            assertThat(registrationBean.getFilter()).isInstanceOf(ApiAccessLogFilter.class);
            assertThat(registrationBean.getOrder()).isEqualTo(WebFilterOrderEnum.API_ACCESS_LOG_FILTER);
        });

        contextRunner.withPropertyValues("basic-framework.access-log.enable=false").run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).as("关闭访问日志后不得注册过滤器").doesNotHaveBean("apiAccessLogFilter");
        });
    }

    /** 暴露注册结果的注册表样例，用于把 Spring 受保护入口的真实内容取出来断言。 */
    static class InspectableInterceptorRegistry extends InterceptorRegistry {

        /**
         * 返回已注册的拦截器对象。
         *
         * @return 按顺序注册的拦截器列表
         */
        List<Object> registered() {
            return getInterceptors();
        }
    }
}
