package com.basicframework.module.infra.framework.web.config;

import com.basicframework.framework.swagger.config.BasicFrameworkSwaggerAutoConfiguration;
import org.springdoc.core.models.GroupedOpenApi;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * infra 模块的 web 组件的 Configuration
 *
 * 注册 infra 模块的 OpenAPI 分组。
 *
 * @author 李杰
 */
@Configuration(proxyBeanMethods = false)
public class InfraWebConfiguration {

    /**
     * infra 模块的 API 分组
     *
     * @return infra 模块 OpenAPI 分组
     */
    @Bean
    public GroupedOpenApi infraGroupedOpenApi() {
        return BasicFrameworkSwaggerAutoConfiguration.buildGroupedOpenApi("infra");
    }

}
