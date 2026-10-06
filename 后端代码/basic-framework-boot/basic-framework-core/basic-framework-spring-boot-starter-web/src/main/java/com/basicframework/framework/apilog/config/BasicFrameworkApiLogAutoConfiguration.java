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
 * 上游文件：yudao-framework/yudao-spring-boot-starter-web/src/main/java/cn/
 * 上游文件续：iocoder/yudao/framework/apilog/config/YudaoApiLogAutoConfiguration.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：命名空间/模块名/类名前缀适配、配置前缀 yudao.*→basic-framework.*；改写/新增 1 行，移除或改写上游 1 行；import 新增 1 行、移除 1 行；补充注释 7 行。
 * 来源验收：尚未验收
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
