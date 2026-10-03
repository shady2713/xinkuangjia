package com.basicframework.framework.web.config;

import java.util.Map;
import java.util.function.Predicate;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.web.client.RestTemplateAutoConfiguration;
import org.springframework.boot.autoconfigure.web.servlet.WebMvcRegistrations;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.core.annotation.Order;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import com.basicframework.framework.common.biz.infra.logger.ApiErrorLogCommonApi;
import com.basicframework.framework.common.enums.WebFilterOrderEnum;
import com.basicframework.framework.web.core.filter.CacheRequestBodyFilter;
import com.basicframework.framework.web.core.handler.GlobalExceptionHandler;
import com.basicframework.framework.web.core.handler.GlobalResponseBodyHandler;
import com.basicframework.framework.web.core.util.WebFrameworkUtils;
import com.google.common.collect.Maps;

import cn.hutool.core.util.StrUtil;
import jakarta.servlet.Filter;

/**
 * BasicFrameworkWebAutoConfiguration 自动配置类。
 *
 * @author 李杰
 */
@AutoConfiguration
@EnableConfigurationProperties(WebProperties.class)
public class BasicFrameworkWebAutoConfiguration {

    /**
     * 应用名
     */
    @Value("${spring.application.name}")
    private String applicationName;

    /**
     * 完成 webMvcRegistrations 对应的业务处理。
     *
     * @param webProperties 配置参数
     * @return 方法处理结果
     */
    @Bean
    public WebMvcRegistrations webMvcRegistrations(WebProperties webProperties) {
        return new WebMvcRegistrations() {

            /**
             * 获取RequestMappingHandlerMapping。
             *
             * @return 查询或转换后的结果
             */
            @Override
            public RequestMappingHandlerMapping getRequestMappingHandlerMapping() {
                RequestMappingHandlerMapping mapping = new RequestMappingHandlerMapping();
                // 实例化时就带上前缀
                mapping.setPathPrefixes(buildPathPrefixes(webProperties));
                return mapping;
            }

            /**
             * 构建 prefix → 匹配条件的映射
             */
            private Map<String, Predicate<Class<?>>> buildPathPrefixes(WebProperties webProperties) {
                AntPathMatcher antPathMatcher = new AntPathMatcher(".");
                Map<String, Predicate<Class<?>>> pathPrefixes = Maps.newLinkedHashMapWithExpectedSize(2);
                putPathPrefix(pathPrefixes, webProperties.getAdminApi(), antPathMatcher);
                putPathPrefix(pathPrefixes, webProperties.getAppApi(), antPathMatcher);
                return pathPrefixes;
            }

            /**
             * 设置 API 前缀，仅仅匹配 controller 包下的
             */
            private void putPathPrefix(Map<String, Predicate<Class<?>>> pathPrefixes, WebProperties.Api api, AntPathMatcher matcher) {
                if (api == null || StrUtil.isEmpty(api.getPrefix())) {
                    return;
                }
                pathPrefixes.put(api.getPrefix(), // api 前缀
                        clazz -> clazz.isAnnotationPresent(RestController.class)
                                && matcher.match(api.getController(), clazz.getPackage().getName()));
            }

        };
    }

    /**
     * 完成 globalExceptionHandler 对应的业务处理。
     *
     * @param apiErrorLogApi apiError日志Api参数
     * @return 方法处理结果
     */
    @Bean
    @SuppressWarnings("SpringJavaInjectionPointsAutowiringInspection")
    public GlobalExceptionHandler globalExceptionHandler(ApiErrorLogCommonApi apiErrorLogApi) {
        return new GlobalExceptionHandler(applicationName, apiErrorLogApi);
    }

    /**
     * 完成 globalResponseBodyHandler 对应的业务处理。
     *
     * @return 方法处理结果
     */
    @Bean
    public GlobalResponseBodyHandler globalResponseBodyHandler() {
        return new GlobalResponseBodyHandler();
    }

    /**
     * 完成 webFrameworkUtils 对应的业务处理。
     *
     * @param webProperties 配置参数
     * @return 方法处理结果
     */
    @Bean
    @SuppressWarnings("InstantiationOfUtilityClass")
    public WebFrameworkUtils webFrameworkUtils(WebProperties webProperties) {
        // 由于 WebFrameworkUtils 需要使用到 webProperties 属性，所以注册为一个 Bean
        return new WebFrameworkUtils(webProperties);
    }

    // ========== Filter 相关 ==========

    /**
     * 按精确源白名单允许跨域 Bearer 请求，不允许浏览器附带 Cookie 等隐式凭据。
     *
     * @param webProperties 已校验的 Web 配置；空白名单拒绝跨域
     * @return 先于认证执行、允许 Authorization 与 Content-Type 预检的过滤器
     */
    @Bean
    @Order(value = WebFilterOrderEnum.CORS_FILTER) // 特殊：修复因执行顺序影响到跨域配置不生效问题
    public FilterRegistrationBean<CorsFilter> corsFilterBean(WebProperties webProperties) {
        // 创建 CorsConfiguration 对象
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowCredentials(false);
        webProperties.getCorsAllowedOrigins().forEach(config::addAllowedOrigin);
        config.addAllowedHeader("*"); // 设置访问源请求头
        config.addExposedHeader("Content-Disposition"); // 明确授权的前端可读取下载文件名
        config.addAllowedMethod("*"); // 设置访问源请求方法
        // 创建 UrlBasedCorsConfigurationSource 对象
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config); // 对接口配置跨域设置
        return createFilterBean(new CorsFilter(source), WebFilterOrderEnum.CORS_FILTER);
    }

    /**
     * 创建 RequestBodyCacheFilter Bean，可重复读取请求内容
     */
    @Bean
    public FilterRegistrationBean<CacheRequestBodyFilter> requestBodyCacheFilter() {
        return createFilterBean(new CacheRequestBodyFilter(), WebFilterOrderEnum.REQUEST_BODY_CACHE_FILTER);
    }

    /**
     * 创建FilterBean。
     *
     * @param filter filter参数
     * @param order order参数
     * @return 创建结果
     */
    public static <T extends Filter> FilterRegistrationBean<T> createFilterBean(T filter, Integer order) {
        FilterRegistrationBean<T> bean = new FilterRegistrationBean<>(filter);
        bean.setOrder(order);
        return bean;
    }

    /**
     * 创建 RestTemplate 实例
     *
     * @param restTemplateBuilder {@link RestTemplateAutoConfiguration#restTemplateBuilder}
     */
    @Bean
    @ConditionalOnMissingBean
    public RestTemplate restTemplate(RestTemplateBuilder restTemplateBuilder) {
        return restTemplateBuilder.build();
    }

}
