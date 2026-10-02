package com.basicframework.module.infra.framework.security.config;

import com.basicframework.framework.security.config.AuthorizeRequestsCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AuthorizeHttpRequestsConfigurer;

/**
 * Infra 模块的 Security 配置
 *
 * 注册 infra 模块需要额外放行的接口路径。
 *
 * @author 李杰
 */
@Configuration(proxyBeanMethods = false, value = "infraSecurityConfiguration")
public class SecurityConfiguration {

    /**
     * 创建 infra 模块的请求授权自定义器。
     *
     * @return 请求授权自定义器
     */
    @Bean("infraAuthorizeRequestsCustomizer")
    public AuthorizeRequestsCustomizer authorizeRequestsCustomizer() {
        return new AuthorizeRequestsCustomizer() {

            /**
             * 配置 infra 模块允许匿名访问的请求路径。
             *
             * @param registry Spring Security 请求匹配注册器
             */
            @Override
            public void customize(AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry registry) {
                // 仅健康检查供负载均衡和容器探针匿名访问；文档与 info 端点沿用默认认证策略。
                registry.requestMatchers("/actuator/health").permitAll()
                        .requestMatchers("/actuator/health/**").permitAll();
                // Druid 监控 - 由 Druid 自身的 login-username/login-password 保护，无需 Spring Security 额外放行
                // 注意：Druid StatViewServlet 自带认证，此处不再 permitAll
                // 业务约束要求对象 URL 长期可访问，仅放行按完整路径读取单个文件的接口。
                registry.requestMatchers(buildAdminApi("/infra/file/content/**")).permitAll();
            }

        };
    }

}
