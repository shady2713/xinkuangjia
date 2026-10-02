package com.basicframework.framework.encrypt.config;

import com.basicframework.framework.common.enums.WebFilterOrderEnum;
import com.basicframework.framework.encrypt.core.filter.ApiEncryptFilter;
import com.basicframework.framework.web.config.WebProperties;
import com.basicframework.framework.web.core.handler.GlobalExceptionHandler;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import static com.basicframework.framework.web.config.BasicFrameworkWebAutoConfiguration.createFilterBean;

/**
 * API 加解密自动配置类
 *
 * 当开启 basic-framework.api-encrypt.enable 时，注册 ApiEncryptFilter。
 *
 * @author 李杰
 */
@AutoConfiguration
@Slf4j
@EnableConfigurationProperties(ApiEncryptProperties.class)
@ConditionalOnProperty(prefix = "basic-framework.api-encrypt", name = "enable", havingValue = "true")
public class BasicFrameworkApiEncryptAutoConfiguration {

    /**
     * 创建 ApiEncryptFilter Bean
     *
     * @param webProperties            全局 Web 配置
     * @param apiEncryptProperties API 加解密配置
     * @param requestMappingHandlerMapping spring 请求映射注册表
     * @param globalExceptionHandler   全局异常处理器
     * @return 请求解密 + 响应加密 Filter bean
     */
    @Bean
    public FilterRegistrationBean<ApiEncryptFilter> apiEncryptFilter(WebProperties webProperties,
                                                                     ApiEncryptProperties apiEncryptProperties,
                                                                     RequestMappingHandlerMapping requestMappingHandlerMapping,
                                                                     GlobalExceptionHandler globalExceptionHandler) {
        ApiEncryptFilter filter = new ApiEncryptFilter(webProperties, apiEncryptProperties,
                requestMappingHandlerMapping, globalExceptionHandler);
        return createFilterBean(filter, WebFilterOrderEnum.API_ENCRYPT_FILTER);

    }

}
