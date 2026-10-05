package com.basicframework.module.system.framework.security.config;

import com.basicframework.framework.security.config.AuthorizeRequestsCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AuthorizeHttpRequestsConfigurer;

/**
 * System 模块的 Security 配置
 *
 * <p>本模块不声明任何机器 API 面。{@code /admin-api/system/oauth2/user/**} 是供第三方应用读取
 * 授权用户资料的接口：用户编号取自认证上下文，而客户端凭据模式签发的机器主体使用占位编号 0，
 * 在 {@code system_users} 中没有对应账号；把它声明为机器接口只会让请求在控制器内对空用户解引用，
 * 返回系统异常而不是任何真实数据。该接口依赖真实用户，不能作为机器入口放行。</p>
 *
 * <p>因此该路径交回框架 {@code BasicFrameworkWebSecurityConfigurerAdapter} 的机器主体兜底规则：
 * 机器主体访问 {@code /admin-api/**} 一律按无权限拒绝，真实用户继续由令牌的 {@code user.read}
 * 范围与方法级 {@code @PreAuthorize} 决定能否读取。模块将来若新增可供机器主体调用的接口，
 * 必须在这里用 {@code authorizeMachineApi} 显式声明，并在方法上限定授权范围。</p>
 *
 * @author shady2713
 */
@Configuration(proxyBeanMethods = false, value = "systemSecurityConfiguration")
public class SecurityConfiguration {

    /**
     * 创建 system 模块的请求授权自定义器。
     *
     * <p>当前不注册任何请求规则：system 模块没有机器主体可访问的接口。</p>
     *
     * @return 请求授权自定义器
     */
    @Bean("systemAuthorizeRequestsCustomizer")
    public AuthorizeRequestsCustomizer authorizeRequestsCustomizer() {
        return new AuthorizeRequestsCustomizer() {

            /**
             * 配置 system 模块的请求路径规则。
             *
             * <p>OAuth2 用户接口依赖真实登录用户，不能声明为机器接口；这里保持无规则，
             * 由安全链的机器主体兜底规则拒绝机器主体。</p>
             *
             * @param registry Spring Security 请求匹配注册器
             */
            @Override
            public void customize(AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry registry) {
                // 无机器接口：system 模块的接口都要求真实用户；新增机器接口时必须在此显式声明。
            }

        };
    }

}
