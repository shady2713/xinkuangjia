package com.basicframework.framework.security.config;

import com.basicframework.framework.common.biz.system.oauth2.OAuth2TokenCommonApi;
import com.basicframework.framework.common.biz.system.permission.PermissionCommonApi;
import com.basicframework.framework.security.core.context.TransmittableThreadLocalSecurityContextHolderStrategy;
import com.basicframework.framework.security.core.filter.TokenAuthenticationFilter;
import com.basicframework.framework.security.core.handler.AccessDeniedHandlerImpl;
import com.basicframework.framework.security.core.handler.AuthenticationEntryPointImpl;
import com.basicframework.framework.security.core.service.SecurityFrameworkService;
import com.basicframework.framework.web.core.handler.GlobalExceptionHandler;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.config.MethodInvokingFactoryBean;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * 验证安全自动配置产出的组件类型与关键参数。
 *
 * <p>密码编码器必须按配置的长度工作：长度变化会改变 BCrypt 的开销因子，直接影响存量密码是否还能
 * 校验通过。令牌过滤器必须拿到同一份安全配置，否则它读到的令牌头名与安全链白名单对不上，合法请求
 * 会被判为未登录。</p>
 *
 * @author shady2713
 */
class BasicFrameworkSecurityAutoConfigurationTest {

    /** 被测自动配置类。 */
    private BasicFrameworkSecurityAutoConfiguration autoConfiguration;
    /** 密码编码器长度配置。 */
    private SecurityProperties securityProperties;

    /** 装配被测自动配置类并注入安全属性。 */
    @BeforeEach
    void setUp() {
        autoConfiguration = new BasicFrameworkSecurityAutoConfiguration();
        securityProperties = new SecurityProperties();
        ReflectionTestUtils.setField(autoConfiguration, "securityProperties", securityProperties);
    }

    /** 未认证与权限不足的处理器必须是框架自带的实现类型，响应体格式才与前端约定一致。 */
    @Test
    void entryPointAndDeniedHandlerUseTheFrameworkImplementations() {
        AuthenticationEntryPoint entryPoint = autoConfiguration.authenticationEntryPoint();
        AccessDeniedHandler accessDeniedHandler = autoConfiguration.accessDeniedHandler();

        assertThat(entryPoint).isInstanceOf(AuthenticationEntryPointImpl.class);
        assertThat(accessDeniedHandler).isInstanceOf(AccessDeniedHandlerImpl.class);
    }

    /** 密码编码器必须是 BCrypt，且按配置长度生成的哈希可以被任一 BCrypt 编码器校验通过。 */
    @Test
    void passwordEncoderHonoursTheConfiguredCost() {
        securityProperties.setPasswordEncoderLength(6);

        PasswordEncoder encoder = autoConfiguration.passwordEncoder();
        String encoded = encoder.encode("secret");

        assertThat(encoder.matches("secret", encoded)).isTrue();
        assertThat(encoder.matches("wrong", encoded)).isFalse();
        assertThat(encoded).startsWith("$2");
        assertThat(new BCryptPasswordEncoder(6).matches("secret", encoded))
                .as("成本写进哈希串，存量密码在调整配置后仍可校验").isTrue();
    }

    /**
     * 构造一个只用于被测装配的异常处理器：错误日志接口为替身，不参与断言。
     *
     * @return 异常处理器实例
     */
    private static GlobalExceptionHandler exceptionHandler() {
        return new GlobalExceptionHandler("test",
                mock(com.basicframework.framework.common.biz.infra.logger.ApiErrorLogCommonApi.class));
    }

    /** 令牌过滤器必须使用同一份安全属性，令牌头名与白名单配置才不会相互错位。 */
    @Test
    void tokenFilterReceivesTheSameSecurityProperties() {
        securityProperties.setTokenHeader("X-Token");
        GlobalExceptionHandler globalExceptionHandler = exceptionHandler();
        @SuppressWarnings("unchecked")
        ObjectProvider<OAuth2TokenCommonApi> provider = mock(ObjectProvider.class);

        TokenAuthenticationFilter filter =
                autoConfiguration.authenticationTokenFilter(globalExceptionHandler, provider);

        assertThat(ReflectionTestUtils.getField(filter, "securityProperties")).isSameAs(securityProperties);
        assertThat(ReflectionTestUtils.getField(filter, "globalExceptionHandler")).isSameAs(globalExceptionHandler);
        assertThat(ReflectionTestUtils.getField(filter, "oauth2TokenApiProvider")).isSameAs(provider);
    }

    /** 权限服务 Bean 必须按固定名称注册，方法级授权表达式按该名称引用它。 */
    @Test
    void permissionServiceIsExposedUnderTheShortBeanName() throws NoSuchMethodException {
        SecurityFrameworkService service =
                autoConfiguration.securityFrameworkService(mock(PermissionCommonApi.class));

        assertThat(service).isNotNull();
        assertThat(BasicFrameworkSecurityAutoConfiguration.class
                .getMethod("securityFrameworkService", PermissionCommonApi.class)
                .getAnnotation(org.springframework.context.annotation.Bean.class).value())
                .as("方法级授权表达式按 ss 这个名字引用权限服务").containsExactly("ss");
    }

    /** 安全上下文策略必须切换到可传递实现，否则异步线程读不到登录用户。 */
    @Test
    void securityContextHolderStrategyIsSwitchedToTransmittableHolder() {
        MethodInvokingFactoryBean factoryBean = autoConfiguration.securityContextHolderMethodInvokingFactoryBean();

        assertThat(factoryBean.getTargetClass())
                .isEqualTo(org.springframework.security.core.context.SecurityContextHolder.class);
        assertThat(factoryBean.getTargetMethod()).isEqualTo("setStrategyName");
        assertThat((Object[]) factoryBean.getArguments())
                .containsExactly(TransmittableThreadLocalSecurityContextHolderStrategy.class.getName());
    }

}