package com.basicframework.module.system.framework.security.config;

import com.basicframework.framework.security.config.AuthorizeRequestsCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AuthorizeHttpRequestsConfigurer;

/**
 * System 模块的 Security 配置
 *
 * <p>声明第三方客户端可以访问的机器 API 面。机器主体不是管理端用户，安全链默认拒绝其访问管理端与
 * 应用端接口；这里只放行 OAuth2 授权范围接口，且这些接口在方法级用 {@code @ss.hasScope} 限定范围。</p>
 *
 * @author shady2713
 */
@Configuration(proxyBeanMethods = false, value = "systemSecurityConfiguration")
public class SecurityConfiguration {

    /**
     * 创建 system 模块的请求授权自定义器。
     *
     * @return 请求授权自定义器
     */
    @Bean("systemAuthorizeRequestsCustomizer")
    public AuthorizeRequestsCustomizer authorizeRequestsCustomizer() {
        return new AuthorizeRequestsCustomizer() {

            /**
             * 配置 system 模块允许机器主体访问的请求路径。
             *
             * <p>OAuth2 用户接口是框架中唯一按授权范围对外开放的接口：{@code get} 要求 user.read、
             * {@code update} 要求 user.write，机器令牌只能在这些范围内调用。其余 system 接口不在声明内，
             * 因此继续对机器主体关闭。</p>
             *
             * @param registry Spring Security 请求匹配注册器
             */
            @Override
            public void customize(AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry registry) {
                authorizeMachineApi(registry, buildAdminApi("/system/oauth2/user/**"));
            }

        };
    }

}
