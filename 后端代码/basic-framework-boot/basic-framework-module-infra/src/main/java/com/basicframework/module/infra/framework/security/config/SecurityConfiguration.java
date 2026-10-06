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
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-infra/src/main/java/cn/iocoder/yudao/module/infra/framework/security/config/SecurityConfiguration.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 3 行，移除或改写上游 8 行；补充注释 14 行，上游注释 4 行未保留。
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
