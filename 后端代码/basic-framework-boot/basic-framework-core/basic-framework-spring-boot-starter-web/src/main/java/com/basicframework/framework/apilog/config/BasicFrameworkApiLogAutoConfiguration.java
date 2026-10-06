package com.basicframework.framework.apilog.config;

import com.basicframework.framework.apilog.core.filter.ApiAccessLogFilter;
import com.basicframework.framework.apilog.core.interceptor.ApiAccessLogInterceptor;
import com.basicframework.framework.common.biz.infra.logger.ApiAccessLogCommonApi;
import com.basicframework.framework.common.enums.WebFilterOrderEnum;
import com.basicframework.framework.web.config.WebProperties;
import com.basicframework.framework.web.config.BasicFrameworkWebAutoConfiguration;
import jakarta.servlet.Filter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * BasicFrameworkApiLogAutoConfiguration 自动配置类。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-framework/yudao-spring-boot-starter-web/src/main/java/cn/iocoder/yudao/framework/apilog/config/YudaoApiLogAutoConfiguration.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配、配置前缀由 yudao.* 改为 basic-framework.*；本地改写/新增代码 1 行，上游代码 1 行在本地被移除或改写，例如 @ConditionalOnProperty(prefix = "basic-framework.access-log", value = "enable", matchIfMissing = true) // 允许使用 basic-fra；本地补充注释 4 行。
 */
@AutoConfiguration(after = BasicFrameworkWebAutoConfiguration.class)
public class BasicFrameworkApiLogAutoConfiguration implements WebMvcConfigurer {

    /**
     * 创建 ApiAccessLogFilter Bean，记录 API 请求日志
     */
    @Bean
    @ConditionalOnProperty(prefix = "basic-framework.access-log", value = "enable", matchIfMissing = true) // 允许使用 basic-framework.access-log.enable=false 禁用访问日志
    public FilterRegistrationBean<ApiAccessLogFilter> apiAccessLogFilter(WebProperties webProperties,
                                                                         @Value("${spring.application.name}") String applicationName,
                                                                         ApiAccessLogCommonApi apiAccessLogApi) {
        ApiAccessLogFilter filter = new ApiAccessLogFilter(webProperties, applicationName, apiAccessLogApi);
        return createFilterBean(filter, WebFilterOrderEnum.API_ACCESS_LOG_FILTER);
    }

    /**
     * 创建过滤器Bean。
     */
    private static <T extends Filter> FilterRegistrationBean<T> createFilterBean(T filter, Integer order) {
        FilterRegistrationBean<T> bean = new FilterRegistrationBean<>(filter);
        bean.setOrder(order);
        return bean;
    }

    /**
     * 添加Interceptors。
     *
     * @param registry registry 参数
     */
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new ApiAccessLogInterceptor());
    }

}
