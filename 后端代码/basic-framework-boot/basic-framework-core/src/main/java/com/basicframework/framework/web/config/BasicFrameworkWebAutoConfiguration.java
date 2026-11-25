package com.basicframework.framework.web.config;

import java.util.List;
import java.util.Map;
import java.util.function.Predicate;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.Module;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
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
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

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
 * @author shady
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
     * 创建全局异常处理器 Bean。
     *
     * @return 全局异常处理器实例
     */
    @Bean
    public GlobalExceptionHandler globalExceptionHandler() {
        return new GlobalExceptionHandler(applicationName);
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
     * 创建 CorsFilter Bean，解决跨域问题
     */
    @Bean
    @Order(value = WebFilterOrderEnum.CORS_FILTER) // 特殊：修复因执行顺序影响到跨域配置不生效问题
    public FilterRegistrationBean<CorsFilter> corsFilterBean(WebProperties webProperties) {
        // 创建 CorsConfiguration 对象
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowCredentials(true);
        // 携带凭据（Cookie/Authorization）时禁止放行全局通配符 "*"，强制显式声明受信来源。
        for (String origin : webProperties.getCorsAllowedOrigins()) {
            String trimmed = StrUtil.trim(origin);
            if ("*".equals(trimmed)) {
                throw new IllegalStateException(
                        "CORS 携带凭据模式下禁止配置通配符 '*'，请指定明确的来源域名或模式");
            }
            if (StrUtil.isNotBlank(trimmed)) {
                config.addAllowedOriginPattern(trimmed);
            }
        }
        config.addAllowedHeader("*"); // 设置访问源请求头
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
     * 创建 RestTemplate 实例，并为其配置不含 Web XSS 字符串清洗器的独立 JSON 映射器，
     * 避免在 HTTP 请求线程内调用外部接口时篡改出站或回传的原始字符（且不原地修改 MVC 共享转换器）。
     *
     * @param restTemplateBuilder {@link RestTemplateAutoConfiguration#restTemplateBuilder}
     * @param timestampSupportModuleProvider 时间与 Long 精度模块提供器
     * @return 独立隔离 XSS 反序列化器的 RestTemplate 实例
     */
    @Bean
    @ConditionalOnMissingBean
    public RestTemplate restTemplate(
            RestTemplateBuilder restTemplateBuilder,
            @Qualifier("timestampSupportModuleBean") ObjectProvider<Module> timestampSupportModuleProvider) {
        RestTemplate restTemplate = restTemplateBuilder.build();
        ObjectMapper outboundMapper = buildOutboundObjectMapper(timestampSupportModuleProvider.getIfAvailable());
        List<HttpMessageConverter<?>> converters = restTemplate.getMessageConverters();
        for (int i = 0; i < converters.size(); i++) {
            HttpMessageConverter<?> converter = converters.get(i);
            if (converter instanceof MappingJackson2HttpMessageConverter jacksonConverter) {
                MappingJackson2HttpMessageConverter isolatedConverter =
                        new MappingJackson2HttpMessageConverter(outboundMapper);
                if (!jacksonConverter.getSupportedMediaTypes().isEmpty()) {
                    isolatedConverter.setSupportedMediaTypes(jacksonConverter.getSupportedMediaTypes());
                }
                converters.set(i, isolatedConverter);
            }
        }
        return restTemplate;
    }

    /**
     * 构造专供外部 HTTP 通信使用的 Jackson {@link ObjectMapper}，对齐框架时间与未知字段策略且不挂接 XSS 清洗器。
     *
     * @param timestampSupportModule 时间与 Long 精度兼容模块，可能为空
     * @return 独立的 ObjectMapper 实例
     */
    private static ObjectMapper buildOutboundObjectMapper(Module timestampSupportModule) {
        ObjectMapper outboundMapper = new ObjectMapper();
        outboundMapper.configure(SerializationFeature.FAIL_ON_EMPTY_BEANS, false);
        outboundMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        outboundMapper.registerModule(new JavaTimeModule());
        if (timestampSupportModule != null) {
            outboundMapper.registerModule(timestampSupportModule);
        }
        return outboundMapper;
    }

}
