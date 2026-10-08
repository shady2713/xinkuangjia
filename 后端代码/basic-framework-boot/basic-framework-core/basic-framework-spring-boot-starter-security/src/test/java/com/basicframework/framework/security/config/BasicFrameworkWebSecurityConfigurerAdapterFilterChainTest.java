package com.basicframework.framework.security.config;

import com.basicframework.framework.security.core.filter.TokenAuthenticationFilter;
import com.basicframework.framework.web.config.WebProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContext;
import org.springframework.context.support.StaticApplicationContext;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.ObjectPostProcessor;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.authentication.builders.AuthenticationManagerBuilder;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AuthorizeHttpRequestsConfigurer;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.authentication.www.BasicAuthenticationFilter;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.header.HeaderWriterFilter;
import org.springframework.security.web.session.DisableEncodeUrlFilter;
import org.springframework.security.web.session.SessionManagementFilter;
import org.springframework.security.web.context.SecurityContextPersistenceFilter;
import org.springframework.security.web.context.SecurityContextHolderFilter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 验证安全过滤链的真实装配结果与认证管理器的暴露方式。
 *
 * <p>过滤链本身决定了鉴权边界的执行顺序与开关：令牌过滤器必须排在用户名密码过滤器之前，否则令牌
 * 请求在到达鉴权逻辑前就被拦下；CSRF 必须关闭，因为系统不使用 Session，令牌模式下开启 CSRF 会让
 * 全部写请求失败；会话策略必须是无状态，此时不应再出现依赖 Session 存储安全上下文的过滤器。</p>
 *
 * <p>认证管理器必须原样来自认证配置。Spring Security 创建该对象时不带 {@code @Bean} 注解，无法被
 * 注入，因此这里覆写并重新声明；构造失败必须原样上抛，不能被包装成"没有认证管理器"的假象。</p>
 *
 * @author shady2713
 */
class BasicFrameworkWebSecurityConfigurerAdapterFilterChainTest {

    /** 被测适配器。 */
    private BasicFrameworkWebSecurityConfigurerAdapter adapter;
    /** 认证配置替身。 */
    private AuthenticationConfiguration authenticationConfiguration;
    /** 认证管理器替身。 */
    private AuthenticationManager authenticationManager;
    /** 装配出来的安全过滤链。 */
    private SecurityFilterChain securityFilterChain;
    /** 模块自定义授权规则替身，记录安全链是否把规则逐个下发。 */
    private RecordingCustomizer moduleCustomizer;

    /** 装配被测适配器并建立一条真实构建的安全过滤链。 */
    @BeforeEach
    void setUp() throws Exception {
        adapter = new BasicFrameworkWebSecurityConfigurerAdapter();
        WebProperties webProperties = new WebProperties();
        webProperties.getAdminApi().setPrefix("/admin-api");
        webProperties.getAppApi().setPrefix("/app-api");
        SecurityProperties securityProperties = new SecurityProperties();
        securityProperties.setPermitAllUrls(List.of("/admin-api/system/auth/login"));
        ReflectionTestUtils.setField(adapter, "webProperties", webProperties);
        ReflectionTestUtils.setField(adapter, "securityProperties", securityProperties);
        ReflectionTestUtils.setField(adapter, "authenticationEntryPoint",
                mock(org.springframework.security.web.AuthenticationEntryPoint.class));
        ReflectionTestUtils.setField(adapter, "accessDeniedHandler",
                mock(org.springframework.security.web.access.AccessDeniedHandler.class));
        ReflectionTestUtils.setField(adapter, "authenticationTokenFilter", mock(TokenAuthenticationFilter.class));
        moduleCustomizer = new RecordingCustomizer();
        ReflectionTestUtils.setField(adapter, "authorizeRequestsCustomizers", List.of(moduleCustomizer));
        ReflectionTestUtils.setField(adapter, "applicationContext", handlerMappingContext());

        authenticationConfiguration = mock(AuthenticationConfiguration.class);
        authenticationManager = mock(AuthenticationManager.class);
        when(authenticationConfiguration.getAuthenticationManager()).thenReturn(authenticationManager);
        securityFilterChain = adapter.filterChain(httpSecurity());
    }

    /** 模块自定义规则必须被安全链逐个下发；跳过这一步会让模块声明的接口全部落回兜底规则。 */
    @Test
    void moduleAuthorizeRequestsCustomizersAreApplied() {
        assertThat(invokedByAdapter()).as("安全链必须回调模块的自定义规则").isTrue();
        assertThat(securityFilterChain.getFilters()).isNotEmpty();
    }

    /** 令牌过滤器必须排在授权判定之前，否则请求到达授权规则时上下文里还没有登录用户。 */
    @Test
    void tokenFilterIsPlacedBeforeTheAuthorizationDecision() {
        List<Class<?>> filters = filterTypes();

        assertThat(filters).contains(TokenAuthenticationFilter.class);
        assertThat(filters.indexOf(TokenAuthenticationFilter.class))
                .as("令牌过滤器必须早于异常处理与授权判定")
                .isLessThan(filters.indexOf(org.springframework.security.web.access.ExceptionTranslationFilter.class))
                .isLessThan(filters.indexOf(org.springframework.security.web.access.intercept.AuthorizationFilter.class));
    }

    /** 授权与异常处理过滤器必须存在，说明授权规则被真正装配进链条而不是空配置。 */
    @Test
    void authorizationAndExceptionTranslationFiltersAreInstalled() {
        assertThat(filterTypes())
                .contains(org.springframework.security.web.access.intercept.AuthorizationFilter.class)
                .contains(org.springframework.security.web.access.ExceptionTranslationFilter.class);
    }

    /** CSRF 必须关闭：系统不使用 Session，令牌模式下开启 CSRF 会让全部写请求失败。 */
    @Test
    void csrfIsDisabledForTokenAuthentication() {
        assertThat(filterTypes()).doesNotContain(CsrfFilter.class);
    }

    /** 会话策略必须是无状态：不再有依赖 Session 保存安全上下文与请求缓存的过滤器。 */
    @Test
    void sessionIsStatelessSoNoSessionBackedContextOrRequestCacheIsInstalled() {
        List<Class<?>> filters = filterTypes();
        assertThat(filters)
                .contains(SessionManagementFilter.class)
                .doesNotContain(SecurityContextPersistenceFilter.class)
                .doesNotContain(SecurityContextHolderFilter.class);
        assertThat(filters.stream().map(Class::getSimpleName))
                .as("无状态模式下不保留任何基于会话请求缓存的过滤器").doesNotContain("RequestCacheFilter");
    }

    /**
     * 只保留跨域与安全响应头两条外围过滤器，其余按令牌模式裁剪。
     *
     * <p>启用表单登录或 Basic 认证会多出以口令为凭据的入口，与令牌模式并存时两套判定口径不一致；
     * 关闭 URL 编码过滤器则避免请求中的令牌在路径参数里被二次编码后取不到。</p>
     */
    @Test
    void onlyTheCrossOriginAndHeaderWritesFiltersAreInstalled() {
        assertThat(filterTypes())
                .contains(org.springframework.web.filter.CorsFilter.class)
                .contains(HeaderWriterFilter.class)
                .contains(DisableEncodeUrlFilter.class)
                .doesNotContain(BasicAuthenticationFilter.class)
                .doesNotContain(UsernamePasswordAuthenticationFilter.class);
    }

    /** 认证管理器必须原样来自认证配置，作为 Bean 供其它组件注入。 */
    @Test
    void authenticationManagerIsTakenFromAuthenticationConfiguration() throws Exception {
        assertThat(adapter.authenticationManagerBean(authenticationConfiguration)).isSameAs(authenticationManager);
    }

    /** 认证配置构造认证管理器失败时必须原样上抛，不得包装成"没有认证管理器"的假象。 */
    @Test
    void authenticationManagerFailurePropagatesUnchanged() throws Exception {
        Exception failure = new IllegalStateException("认证配置装配失败");
        when(authenticationConfiguration.getAuthenticationManager()).thenThrow(failure);

        assertThatThrownBy(() -> adapter.authenticationManagerBean(authenticationConfiguration))
                .isSameAs(failure);
    }

    /**
     * 读取模块自定义规则是否已被安全链回调。
     *
     * @return 已回调时为真
     */
    private boolean invokedByAdapter() {
        return moduleCustomizer.invoked;
    }

    /**
     * 取出过滤链中全部过滤器的类型，用于按类型断言装配结果。
     *
     * @return 过滤器类型列表，保持链上的先后顺序
     */
    private List<Class<?>> filterTypes() {
        List<Class<?>> types = new ArrayList<>();
        securityFilterChain.getFilters().forEach(filter -> types.add(filter.getClass()));
        return types;
    }

    /**
     * 建立一个可独立构建的安全过滤链构建器。
     *
     * @return 安全过滤链构建器
     */
    private HttpSecurity httpSecurity() {
        ObjectPostProcessor<Object> objectPostProcessor = new ObjectPostProcessor<>() {

            /**
             * 后处理器链在本用例中为空，直接返回原对象即可完成装配。
             *
             * @param <O> 对象类型
             * @param object 待后处理对象
             * @return 原对象
             */
            @Override
            public <O> O postProcess(O object) {
                return object;
            }

        };
        HttpSecurity httpSecurity = new HttpSecurity(objectPostProcessor,
                new AuthenticationManagerBuilder(objectPostProcessor), new HashMap<>());
        httpSecurity.setSharedObject(ApplicationContext.class, handlerMappingContext());
        return httpSecurity;
    }

    /**
     * 记录安全链是否把模块自定义规则下发给注册器。
     *
     * <p>跳过这一步意味着模块声明的接口全部落回框架兜底规则，机器主体隔离会静默失效。</p>
     *
     * @author shady2713
     */
    private static final class RecordingCustomizer extends AuthorizeRequestsCustomizer {

        /** 安全链是否已回调本规则。 */
        private boolean invoked;

        /**
         * 记录安全链下发模块规则。
         *
         * @param registry Spring Security 请求匹配注册器
         */
        @Override
        public void customize(AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry registry) {
            invoked = true;
        }

    }

    /**
     * 构造一个只登记空的处理器映射的真实上下文，免登录白名单因此为空。
     *
     * <p>Spring Security 在构建过滤器链时会向共享的上下文查询各类 Bean 的名称，因此这里必须给出
     * 真实上下文而不是接口替身；处理器映射本身仍以替身形式提供，免登录 URL 的推导才不牵涉真实
     * 控制器扫描。</p>
     *
     * @return 处理器映射所在的应用上下文
     */
    private ApplicationContext handlerMappingContext() {
        RequestMappingHandlerMapping mapping = mock(RequestMappingHandlerMapping.class);
        when(mapping.getHandlerMethods()).thenReturn(new HashMap<>());
        StaticApplicationContext context = new StaticApplicationContext();
        context.getBeanFactory().registerSingleton("requestMappingHandlerMapping", mapping);
        // 安全链开启了跨域，构建时需要一个跨域配置来源；本用例不验证跨域规则本身。
        context.getBeanFactory().registerSingleton("corsConfigurationSource",
                new org.springframework.web.cors.UrlBasedCorsConfigurationSource());
        return context;
    }

}