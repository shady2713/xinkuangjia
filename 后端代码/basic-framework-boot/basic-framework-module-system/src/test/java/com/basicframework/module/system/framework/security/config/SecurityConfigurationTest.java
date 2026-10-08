package com.basicframework.module.system.framework.security.config;

import com.basicframework.framework.security.config.AuthorizeRequestsCustomizer;
import org.junit.jupiter.api.Test;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AuthorizeHttpRequestsConfigurer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * 验证 system 模块不向安全链登记任何机器主体接口。
 *
 * <p>该模块的用户资料接口依赖真实登录用户，客户端凭据模式签发的机器主体使用占位用户编号，在
 * {@code system_users} 中没有对应账号。把这条路径声明为机器接口只会让请求在控制器内对空用户解引用，
 * 返回系统异常而不是任何真实数据。因此这里必须保持"无规则"，让框架的机器主体兜底规则继续拒绝
 * 机器主体访问管理端接口。</p>
 *
 * <p>这条"什么都不做"的行为本身就是契约：模块将来新增可供机器主体调用的接口时，必须在此显式声明，
 * 否则等于默认开放。</p>
 *
 * @author shady2713
 */
class SecurityConfigurationTest {

    /** 被测模块安全配置。 */
    private final SecurityConfiguration securityConfiguration = new SecurityConfiguration();

    /** 必须产出一个非空的请求授权自定义器，供安全链收集并按顺序应用。 */
    @Test
    void producesANonNullAuthorizeRequestsCustomizer() {
        AuthorizeRequestsCustomizer customizer = securityConfiguration.authorizeRequestsCustomizer();

        assertThat(customizer).isNotNull();
        assertThat(customizer.getOrder()).as("模块规则必须排在安全链兜底规则之前").isZero();
    }

    /** 自定义器不得登记任何规则，机器主体继续由框架兜底规则按无权限拒绝。 */
    @Test
    void customizerRegistersNoRules() {
        AuthorizeRequestsCustomizer customizer = securityConfiguration.authorizeRequestsCustomizer();
        AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry registry =
                mock(AuthorizeHttpRequestsConfigurer.AuthorizationManagerRequestMatcherRegistry.class);

        customizer.customize(registry);

        verifyNoInteractions(registry);
        assertThat(customizer.getOrder()).isZero();
    }

    /** 配置类必须以静态 Bean 方式装配，避免同一个配置类被多次代理导致规则重复登记。 */
    @Test
    void configurationIsRegisteredWithAStableBeanName() {
        assertThat(SecurityConfiguration.class
                .getAnnotation(org.springframework.context.annotation.Configuration.class).value())
                .isEqualTo("systemSecurityConfiguration");
        assertThat(SecurityConfiguration.class
                .getAnnotation(org.springframework.context.annotation.Configuration.class).proxyBeanMethods())
                .as("代理 Bean 方法会放大装配成本，且本配置没有跨方法依赖").isFalse();
    }

}