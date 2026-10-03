package com.basicframework.framework.security.core.filter;

import com.basicframework.framework.common.biz.system.permission.PermissionCommonApi;
import com.basicframework.framework.common.biz.system.permission.dto.DeptDataPermissionRespDTO;
import com.basicframework.framework.common.biz.system.oauth2.OAuth2TokenCommonApi;
import com.basicframework.framework.common.biz.system.oauth2.dto.OAuth2AccessTokenCheckRespDTO;
import com.basicframework.framework.common.biz.system.oauth2.dto.OAuth2AccessTokenCreateReqDTO;
import com.basicframework.framework.common.biz.system.oauth2.dto.OAuth2AccessTokenRespDTO;
import com.basicframework.framework.common.biz.infra.logger.ApiErrorLogCommonApi;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.framework.security.config.AuthorizeRequestsCustomizer;
import com.basicframework.framework.security.config.BasicFrameworkSecurityAutoConfiguration;
import com.basicframework.framework.security.config.BasicFrameworkWebSecurityConfigurerAdapter;
import com.basicframework.framework.security.config.SecurityProperties;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.framework.security.core.context.TransmittableThreadLocalSecurityContextHolderStrategy;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.basicframework.framework.web.config.WebProperties;
import com.basicframework.framework.web.core.handler.GlobalExceptionHandler;
import com.basicframework.framework.web.core.util.WebFrameworkUtils;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.annotation.security.PermitAll;
import jakarta.servlet.Filter;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.MapPropertySource;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AuthorizeHttpRequestsConfigurer;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.context.SecurityContextHolderStrategy;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 用生产 {@link BasicFrameworkWebSecurityConfigurerAdapter}、生产 {@link TokenAuthenticationFilter}、
 * 生产异常处理器和真实 Spring Security 过滤链，验证令牌鉴权的真实放行与拒绝边界。
 *
 * <p>令牌仓储在本切片内以内存实现替代业务模块：被测边界是过滤器与过滤链的判定，
 * 令牌在真实 MySQL 上的签发与校验由 system 模块的集成测试负责，此处只按生产契约返回结果。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class TokenAuthenticationFilterSecurityIT {

    /** 免登录的类级注解入口，用于验证按类收集免登录 URL。 */
    @RestController
    @RequestMapping("/admin-api/open-class")
    @PermitAll
    static class ClassPermitAllController {

        /** 免登录读端点。 */
        @GetMapping("/value")
        public CommonResult<String> value() {
            return CommonResult.success("class-permit-all");
        }
    }

    /** 方法级免登录与需登录并存的入口，用于验证按方法收集免登录 URL。 */
    @RestController
    @RequestMapping("/admin-api/mixed")
    static class MethodPermitAllController {

        /** 方法级免登录读端点。 */
        @GetMapping("/public")
        @PermitAll
        public CommonResult<String> publicEndpoint() {
            return CommonResult.success("method-permit-all");
        }

        /** 未标注免登录，读端点需要真实登录。 */
        @GetMapping("/private")
        public CommonResult<String> privateEndpoint() {
            return CommonResult.success("method-private");
        }
    }

    /**
     * 只写 {@code @RequestMapping} 而未声明 method 的入口。
     * 生产按“未限制方法即视为免登录”处理，{@code OPTIONS} 也在其放行范围内。
     */
    @RestController
    @PermitAll
    static class AnyMethodPermitAllController {

        /** 未限定方法的免登录读端点。 */
        @RequestMapping("/admin-api/any-method")
        public CommonResult<String> anyMethod() {
            return CommonResult.success("any-method-permit-all");
        }
    }

    /**
     * 无任何免登录标注的受保护入口。
     * 请求体统一使用生产 {@link CommonResult}，使断言同时校验响应码与业务数据。
     */
    @RestController
    @RequestMapping("/admin-api/protected")
    static class ProtectedController {

        /** 仅要求登录的读端点。 */
        @GetMapping("/login-only")
        public CommonResult<String> loginOnly() {
            return CommonResult.success("login-only:" + SecurityFrameworkUtils.getLoginUserId());
        }

        /** 需要功能权限的读端点，权限判定走生产 {@code ss} Bean。 */
        @GetMapping("/secured")
        @PreAuthorize("@ss.hasPermission('system:user:query')")
        public CommonResult<String> secured() {
            return CommonResult.success("secured");
        }
    }

    /**
     * 配置项白名单与自定义扩展点白名单对应的处理器。
     * 路径必须真实存在，否则免登录判定是否放行无法与“未匹配到处理器”区分开。
     */
    @RestController
    static class PermitAllWhitelistController {

        /** 配置项声明的免登录路径。 */
        @GetMapping("/admin-api/config-permit/anything")
        public CommonResult<String> configPermit() {
            return CommonResult.success("config-permit");
        }

        /** 自定义扩展点声明的免登录路径。 */
        @GetMapping("/admin-api/biz-permit/anything")
        public CommonResult<String> bizPermit() {
            return CommonResult.success("biz-permit");
        }
    }

    /** 会员端入口，用于验证 userType 与请求路径声明不一致时的拒绝。 */
    @RestController
    @RequestMapping("/app-api/member")
    static class MemberController {

        /** 会员端免登录读端点。 */
        @GetMapping("/public")
        @PermitAll
        public CommonResult<String> publicEndpoint() {
            return CommonResult.success("member-public");
        }
    }

    /** 读取真实安全上下文的前端处理配置。 */
    @Configuration(proxyBeanMethods = false)
    @EnableWebMvc
    static class MvcConfiguration {
    }

    /** 补齐 Spring Boot WebSecurity 自动配置在生产中提供的开关。 */
    @Configuration(proxyBeanMethods = false)
    @EnableWebSecurity
    static class WebSecurityTestConfiguration {
    }

    /** 装配生产安全自动配置、Web 前缀配置、免登录白名单与测试用令牌仓储。 */
    @Configuration(proxyBeanMethods = false)
    static class SecuritySliceConfiguration {

        /** 暴露测试令牌仓储，供用例直接签发令牌。 */
        @Bean
        InMemoryOAuth2TokenCommonApi oauth2TokenCommonApi() {
            return tokenApi;
        }

        /** 生产 Web 前缀配置，驱动用户类型识别。 */
        @Bean
        WebProperties webProperties() {
            return new WebProperties();
        }

        /** 初始化静态请求工具持有的前缀配置。 */
        @Bean
        WebFrameworkUtils webFrameworkUtils(WebProperties properties) {
            return new WebFrameworkUtils(properties);
        }

        /** 生产全局异常处理，令牌校验失败与用户类型不符的响应体与生产一致。 */
        @Bean
        GlobalExceptionHandler globalExceptionHandler() {
            return new GlobalExceptionHandler("security-slice-test", mock(ApiErrorLogCommonApi.class));
        }

        /** 权限 API 替身，仅记录调用参数，用于证明未登录时不会触达权限查询。 */
        @Bean
        RecordingPermissionCommonApi permissionCommonApi() {
            return permissionApi;
        }

        /**
         * 生产同源的 CORS 过滤器实例。
         * 预检请求在生产中先于安全链被应答，缺失该过滤器会让预检落到鉴权链上，
         * 从而把 CORS 行为误判为鉴权规则的放行能力。
         */
        @Bean
        CorsFilter corsFilter(WebProperties properties) {
            CorsConfiguration config = new CorsConfiguration();
            config.setAllowCredentials(false);
            // 与生产一致：只接受配置声明的精确源
            config.addAllowedOrigin(properties.getCorsAllowedOrigins().isEmpty()
                    ? "http://localhost:5175" : properties.getCorsAllowedOrigins().get(0));
            config.addAllowedHeader("*");
            config.addExposedHeader("Content-Disposition");
            config.addAllowedMethod("*");
            UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
            source.registerCorsConfiguration("/**", config);
            return new CorsFilter(source);
        }

        /**
         * 提供一个真实的自定义授权扩展点，使生产适配器的 {@code List<AuthorizeRequestsCustomizer>} 注入可用。
         * 顺带验证 {@code buildAdminApi} 使用生产前缀组合 URL。
         */
        @Bean
        AuthorizeRequestsCustomizer customExtraAuthorizeRequestsCustomizer() {
            return new AuthorizeRequestsCustomizer() {

                /** 与生产扩展点一致：追加一条按生产前缀组合出的免登录规则。 */
                @Override
                public void customize(
                        AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry registry) {
                    registry.requestMatchers(buildAdminApi("/biz-permit/**")).permitAll();
                }
            };
        }
    }

    /** 令牌仓储与权限查询替身，供静态配置读取。 */
    private static InMemoryOAuth2TokenCommonApi tokenApi = new InMemoryOAuth2TokenCommonApi();
    /** 权限查询替身，供静态配置读取。 */
    private static RecordingPermissionCommonApi permissionApi = new RecordingPermissionCommonApi();

    private AnnotationConfigWebApplicationContext context;
    private MockMvc mvc;
    private SecurityContextHolderStrategy originalStrategy;

    /** 装配真实过滤链；SecurityContextHolder 策略是全局静态，测试结束后必须还原。 */
    @BeforeAll
    void createEnvironment() {
        originalStrategy = SecurityContextHolder.getContextHolderStrategy();
        context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("security-slice",
                Map.of("basic-framework.security.permit-all-urls[0]", "/admin-api/config-permit/**",
                        // WebProperties 的管理后台地址为必填项，缺失时属性绑定校验会失败
                        "basic-framework.web.admin-ui.url", "http://localhost:5175",
                        // 跨域精确源白名单，预检放行来源与生产保持一致
                        "basic-framework.web.cors-allowed-origins[0]", "http://localhost:5175")));
        context.register(MvcConfiguration.class, WebSecurityTestConfiguration.class,
                SecuritySliceConfiguration.class, BasicFrameworkSecurityAutoConfiguration.class,
                BasicFrameworkWebSecurityConfigurerAdapter.class, ClassPermitAllController.class,
                MethodPermitAllController.class, AnyMethodPermitAllController.class, ProtectedController.class,
                PermitAllWhitelistController.class, MemberController.class, PrefixProbeConfiguration.class);
        context.refresh();

        // 静态替身与容器 Bean 必须是同一实例，断言才能观察到容器内的实际调用。
        assertThat(context.getBean(InMemoryOAuth2TokenCommonApi.class)).isSameAs(tokenApi);
        assertThat(context.getBean(RecordingPermissionCommonApi.class)).isSameAs(permissionApi);
        // 生产中 CORS 过滤器先于安全链执行；显式声明顺序，避免预检行为被安全链吸收。
        mvc = MockMvcBuilders.webAppContextSetup(context)
                .addFilters(context.getBean(CorsFilter.class),
                        context.getBean("springSecurityFilterChain", Filter.class))
                .build();
    }

    /** 关闭上下文并还原全局安全上下文策略，避免污染同 JVM 的其他测试。 */
    @AfterAll
    void closeEnvironment() {
        try {
            if (context != null) {
                context.close();
            }
        } finally {
            SecurityContextHolder.setContextHolderStrategy(originalStrategy);
        }
    }

    /** 每例清空令牌与请求记录，并确保当前线程没有残留登录态。 */
    @BeforeEach
    void resetFixture() {
        tokenApi.tokens.clear();
        tokenApi.checkedTokens.clear();
        tokenApi.failingTokens.clear();
        tokenApi.errorTokens.clear();
        permissionApi.checkedUserIds.clear();
        permissionApi.grantedUserIds.clear();
        SecurityContextHolder.clearContext();
    }

    /** 无令牌访问受保护资源必须返回未授权，说明后续放行不是因为链路失效。 */
    @Test
    void protectedEndpointRejectsMissingToken() throws Exception {
        JsonNode body = perform(get("/admin-api/protected/login-only"));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(401);
    }

    /** 仅带 Bearer 前缀而没有凭据时按无凭据处理，空白不构成令牌。 */
    @Test
    void protectedEndpointRejectsEmptyToken() throws Exception {
        JsonNode body = perform(get("/admin-api/protected/login-only").header("Authorization", "Bearer "));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(401);
        assertThat(tokenApi.checkedTokens).as("空令牌不应触达令牌校验").isEmpty();
    }

    /** 伪造令牌必须被令牌仓储拒绝，链路按未登录处理。 */
    @Test
    void protectedEndpointRejectsForgedToken() throws Exception {
        JsonNode body = perform(get("/admin-api/protected/login-only")
                .header("Authorization", "Bearer forged-" + UUID.randomUUID()));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(401);
        assertThat(tokenApi.checkedTokens).as("伪造令牌必须真实进入校验").hasSize(1);
    }

    /** 过期令牌必须被拒绝；放过过期令牌等同于凭据永久有效。 */
    @Test
    void protectedEndpointRejectsExpiredToken() throws Exception {
        String token = issueToken(11L, UserTypeEnum.ADMIN, LocalDateTime.now().minusMinutes(1), Map.of());
        JsonNode body = perform(get("/admin-api/protected/login-only")
                .header("Authorization", "Bearer " + token));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(401);
    }

    /** 有效管理员令牌必须写入安全上下文，业务读到真实用户编号。 */
    @Test
    void validAdminTokenPopulatesSecurityContext() throws Exception {
        String token = issueToken(42L, UserTypeEnum.ADMIN, LocalDateTime.now().plusMinutes(10),
                Map.of(LoginUser.INFO_KEY_NICKNAME, "张三", LoginUser.INFO_KEY_DEPT_ID, "7"));
        JsonNode body = perform(get("/admin-api/protected/login-only")
                .header("Authorization", "Bearer " + token));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(0);
        assertThat(body.get("data").asText()).isEqualTo("login-only:42");
    }

    /** 令牌可以通过查询参数传递，覆盖 Web 无法设置请求头的场景。 */
    @Test
    void validTokenFromQueryParameterAuthenticates() throws Exception {
        String token = issueToken(43L, UserTypeEnum.ADMIN, LocalDateTime.now().plusMinutes(10), Map.of());
        JsonNode body = perform(get("/admin-api/protected/login-only").param("token", token));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(0);
        assertThat(body.get("data").asText()).isEqualTo("login-only:43");
    }

    /** 请求头与查询参数同时存在时以请求头为准，避免被低优先级参数覆盖。 */
    @Test
    void headerTokenWinsOverQueryParameter() throws Exception {
        String headerToken = issueToken(51L, UserTypeEnum.ADMIN, LocalDateTime.now().plusMinutes(10), Map.of());
        String parameterToken = issueToken(52L, UserTypeEnum.ADMIN, LocalDateTime.now().plusMinutes(10), Map.of());
        JsonNode body = perform(get("/admin-api/protected/login-only")
                .header("Authorization", "Bearer " + headerToken).param("token", parameterToken));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(0);
        assertThat(body.get("data").asText()).isEqualTo("login-only:51");
    }

    /**
     * 会员令牌访问后台接口必须按用户类型不符拒绝。
     * 若放行，会员凭据即可读取管理后台数据。
     */
    @Test
    void memberTokenRejectedOnAdminEndpoint() throws Exception {
        String token = issueToken(61L, UserTypeEnum.MEMBER, LocalDateTime.now().plusMinutes(10), Map.of());
        JsonNode body = perform(get("/admin-api/protected/login-only")
                .header("Authorization", "Bearer " + token));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(403);
    }

    /** 管理员令牌访问会员端接口同样按用户类型不符拒绝，双向隔离。 */
    @Test
    void adminTokenRejectedOnMemberEndpoint() throws Exception {
        String token = issueToken(62L, UserTypeEnum.ADMIN, LocalDateTime.now().plusMinutes(10), Map.of());
        JsonNode body = perform(get("/app-api/member/private-not-exist")
                .header("Authorization", "Bearer " + token));
        // 端点不存在同样必须先完成令牌校验，类型不符时返回 403 而不是 404。
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(403);
    }

    /** 无前缀声明的路径不带用户类型约束，任意合法用户类型的令牌都可通过。 */
    @Test
    void tokenAcceptedWhenPathDeclaresNoUserType() throws Exception {
        String token = issueToken(63L, UserTypeEnum.MEMBER, LocalDateTime.now().plusMinutes(10), Map.of());
        JsonNode body = perform(get("/plain/path-without-api-prefix")
                .header("Authorization", "Bearer " + token));
        // 该路径受 anyRequest().authenticated() 保护，鉴权已通过说明令牌被接受，随后才因无处理器失败。
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isNotEqualTo(401);
    }

    /**
     * 记录并锁定机器主体（userId=0）当前的真实行为：过滤器不拒绝该主体，
     * 会把它写入安全上下文。是否允许访问由后续功能权限判定决定，因此需在别处单独加固。
     */
    @Test
    void machinePrincipalIsWrittenIntoContextByFilter() throws Exception {
        String token = issueToken(0L, UserTypeEnum.ADMIN, LocalDateTime.now().plusMinutes(10), Map.of());
        JsonNode body = perform(get("/admin-api/protected/login-only")
                .header("Authorization", "Bearer " + token));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(0);
        assertThat(body.get("data").asText())
                .as("机器主体当前会被写入上下文，实际行为=%s", body.get("data").asText())
                .isEqualTo("login-only:0");
    }

    /** 负数主体与零号主体同属机器边界，过滤器同样不做拒绝，实际行为一并锁定。 */
    @Test
    void negativePrincipalIsWrittenIntoContextByFilter() throws Exception {
        String token = issueToken(-1L, UserTypeEnum.ADMIN, LocalDateTime.now().plusMinutes(10), Map.of());
        JsonNode body = perform(get("/admin-api/protected/login-only")
                .header("Authorization", "Bearer " + token));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(0);
        assertThat(body.get("data").asText()).isEqualTo("login-only:-1");
    }

    /** 类级 {@code @PermitAll} 声明的 URL 必须免登录。 */
    @Test
    void classLevelPermitAllIsAnonymousAccessible() throws Exception {
        JsonNode body = perform(get("/admin-api/open-class/value"));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(0);
        assertThat(body.get("data").asText()).isEqualTo("class-permit-all");
    }

    /** 方法级 {@code @PermitAll} 声明的 URL 必须免登录，同类未标注方法仍需登录。 */
    @Test
    void methodLevelPermitAllDoesNotLeakToSiblingMethod() throws Exception {
        JsonNode publicBody = perform(get("/admin-api/mixed/public"));
        assertThat(publicBody.get("code").asInt()).as("真实响应=%s", publicBody).isEqualTo(0);
        JsonNode privateBody = perform(get("/admin-api/mixed/private"));
        assertThat(privateBody.get("code").asInt()).as("真实响应=%s", privateBody).isEqualTo(401);
    }

    /**
     * 未声明 method 的 {@code @RequestMapping} 必须对 GET 和 POST 都免登录。
     *
     * <p>OPTIONS 单独在 {@link optionsPreflightIsAnsweredBeforeSecurityChain} 中验证：
     * 生产安全链并未注册 OPTIONS 免登录规则，浏览器预检实际由前置 CORS 过滤器应答。</p>
     */
    @Test
    void permitAllWithoutMethodAllowsGetAndPost() throws Exception {
        JsonNode getBody = perform(get("/admin-api/any-method"));
        assertThat(getBody.get("code").asInt()).as("真实响应=%s", getBody).isEqualTo(0);
        assertThat(getBody.get("data").asText()).isEqualTo("any-method-permit-all");
        JsonNode postBody = perform(post("/admin-api/any-method"));
        assertThat(postBody.get("code").asInt()).as("真实响应=%s", postBody).isEqualTo(0);
    }

    /**
     * 锁定 OPTIONS 预检的真实放行来源。
     *
     * <p>生产安全链只注册了 GET/POST/PUT/DELETE/HEAD/PATCH 六种方法的免登录规则，
     * 免登录 URL 收集中的 OPTIONS 分支并未被注册进链路；浏览器预检之所以能匿名通过，
     * 是因为前置 CORS 过滤器先行应答。若把预检放行归因于安全链的免登录规则，就会误判防线位置。</p>
     */
    @Test
    void optionsPreflightIsAnsweredBeforeSecurityChain() throws Exception {
        MockHttpServletRequestBuilder preflight = MockMvcRequestBuilders.options("/admin-api/any-method")
                .header(HttpHeaders.ORIGIN, "http://localhost:5175")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST");
        MvcResult result = mvc.perform(preflight).andReturn();
        assertThat(result.getResponse().getHeader(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN))
                .as("预检必须由 CORS 过滤器应答，而不是安全链的免登录规则")
                .isEqualTo("http://localhost:5175");
    }

    /**
     * 不带 CORS 上下文的 OPTIONS 请求会落到安全链并被拒绝。
     * 该断言用于证明安全链本身没有 OPTIONS 免登录规则，避免把 CORS 行为误记为鉴权能力。
     */
    @Test
    void optionsWithoutCorsContextIsRejectedBySecurityChain() throws Exception {
        JsonNode body = perform(MockMvcRequestBuilders.options("/admin-api/any-method"));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(401);
    }

    /** 配置项声明的免登录白名单必须生效。 */
    @Test
    void configuredPermitAllUrlIsAnonymousAccessible() throws Exception {
        JsonNode body = perform(get("/admin-api/config-permit/anything"));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(0);
    }

    /** 业务自定义授权扩展点放行的路径必须免登录。 */
    @Test
    void customizerPermitAllUrlIsAnonymousAccessible() throws Exception {
        JsonNode body = perform(get("/admin-api/biz-permit/anything"));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(0);
    }

    /** 静态资源匿名可访问，避免前端构建产物被鉴权拦截。 */
    @Test
    void staticResourceIsAnonymousAccessible() throws Exception {
        JsonNode body = perform(get("/index.html"));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isNotEqualTo(401);
    }

    /** 有效令牌访问需功能权限的端点，权限判定真实通过。 */
    @Test
    void validTokenPassesPreAuthorizeWhenPermissionGranted() throws Exception {
        permissionApi.grantedUserIds.add(71L);
        String token = issueToken(71L, UserTypeEnum.ADMIN, LocalDateTime.now().plusMinutes(10), Map.of());
        JsonNode body = perform(get("/admin-api/protected/secured")
                .header("Authorization", "Bearer " + token));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(0);
        assertThat(body.get("data").asText()).isEqualTo("secured");
        assertThat(permissionApi.checkedUserIds).as("已登录请求必须真实进入权限判定").containsExactly(71L);
    }

    /** 已登录但缺少功能权限时必须返回无权限，与未登录的未授权区分开。 */
    @Test
    void loggedInWithoutPermissionGetsForbidden() throws Exception {
        String token = issueToken(72L, UserTypeEnum.ADMIN, LocalDateTime.now().plusMinutes(10), Map.of());
        JsonNode body = perform(get("/admin-api/protected/secured")
                .header("Authorization", "Bearer " + token));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(403);
        assertThat(permissionApi.checkedUserIds).as("拒绝必须来自真实权限判定，而非链路缺省").containsExactly(72L);
    }

    /**
     * 请求结束后当前线程的安全上下文必须被清空。
     * 生产使用线程池复用线程，残留上下文会让下一个请求继承上一个用户的身份。
     */
    @Test
    void securityContextIsClearedAfterRequest() throws Exception {
        String token = issueToken(81L, UserTypeEnum.ADMIN, LocalDateTime.now().plusMinutes(10), Map.of());
        JsonNode body = perform(get("/admin-api/protected/login-only")
                .header("Authorization", "Bearer " + token));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(0);
        assertThat(SecurityContextHolder.getContext().getAuthentication())
                .as("请求结束后线程不得残留登录态，否则线程池复用会串号").isNull();
    }

    /** 令牌校验失败后同样不得残留上下文，失败请求不能污染后续请求。 */
    @Test
    void securityContextStaysEmptyAfterRejectedToken() throws Exception {
        JsonNode body = perform(get("/admin-api/protected/login-only")
                .header("Authorization", "Bearer forged-" + UUID.randomUUID()));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(401);
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    /**
     * 生产安全上下文策略必须真正生效，而不是回退到默认线程本地实现；
     * 否则异步场景会丢失登录态，或在线程池复用时残留旧上下文。
     */
    @Test
    void transmittableThreadLocalStrategyIsInstalled() {
        assertThat(SecurityContextHolder.getContextHolderStrategy())
                .isInstanceOf(TransmittableThreadLocalSecurityContextHolderStrategy.class);
    }

    /** 令牌校验未发生时被拒绝，权限查询也不得被触达，避免未登录状态下的越权探测。 */
    @Test
    void anonymousRequestNeverReachesPermissionApi() throws Exception {
        JsonNode body = perform(get("/admin-api/protected/secured"));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(401);
        assertThat(permissionApi.checkedUserIds)
                .as("未登录时不得进入权限判定").isEmpty();
    }

    /** 构造带真实 servletPath 的请求，使生产基于 URL 前缀的用户类型判定生效。 */
    private MockHttpServletRequestBuilder get(String uri) {
        return withServletPath(MockMvcRequestBuilders.get(uri), uri);
    }

    /** 构造带真实 servletPath 的 POST 请求。 */
    private MockHttpServletRequestBuilder post(String uri) {
        return withServletPath(MockMvcRequestBuilders.post(uri), uri);
    }

    /**
     * 显式设置 servletPath。
     * 生产通过 {@code request.getServletPath()} 的 API 前缀识别用户类型，
     * MockMvc 默认 servletPath 为空会让该分支永远不执行，形成假绿。
     *
     * @param builder 原始请求构造器
     * @param uri     请求路径，同时作为 servletPath
     * @return 设置好 servletPath 的请求构造器
     */
    private MockHttpServletRequestBuilder withServletPath(MockHttpServletRequestBuilder builder, String uri) {
        return builder.servletPath(uri);
    }

    /** 执行真实过滤链并解析响应体，避免断言依赖日志输出。 */
    private JsonNode perform(MockHttpServletRequestBuilder builder) throws Exception {
        MvcResult result = mvc.perform(builder).andExpect(status().isOk()).andReturn();
        return JsonUtils.parseObject(result.getResponse().getContentAsString(), JsonNode.class);
    }

    /** 签发一个内存令牌，用于构造正例与边界场景。 */
    private String issueToken(Long userId, UserTypeEnum userType, LocalDateTime expiresTime,
                              Map<String, String> info) {
        return tokenApi.issue(userId, userType.getValue(), expiresTime, info);
    }

    /**
     * 内存令牌仓储，按生产 {@code OAuth2TokenService#checkAccessToken} 的契约返回结果。
     * 真实 MySQL 上的令牌行为由 system 模块集成测试覆盖，此处只提供被测过滤器的判定依赖。
     */
    static class InMemoryOAuth2TokenCommonApi implements OAuth2TokenCommonApi {

        /** 令牌值到校验结果的映射。 */
        private final Map<String, OAuth2AccessTokenCheckRespDTO> tokens = new ConcurrentHashMap<>();
        /** 记录被真实校验过的令牌，用于证明拒绝路径确实进入了令牌校验。 */
        private final List<String> checkedTokens = Collections.synchronizedList(new ArrayList<>());
        /** 需要抛出运行时异常的令牌，用于验证异常路径。 */
        private final Set<String> failingTokens = ConcurrentHashMap.newKeySet();
        /** 需要抛出 JVM 级故障的令牌，用于验证故障不被伪装成鉴权响应。 */
        private final Set<String> errorTokens = ConcurrentHashMap.newKeySet();

        /** 写入一个令牌。 */
        String issue(Long userId, Integer userType, LocalDateTime expiresTime, Map<String, String> info) {
            String token = "test-token-" + UUID.randomUUID();
            OAuth2AccessTokenCheckRespDTO dto = new OAuth2AccessTokenCheckRespDTO();
            dto.setUserId(userId);
            dto.setUserType(userType);
            dto.setExpiresTime(expiresTime);
            dto.setUserInfo(info);
            dto.setScopes(List.of("user.read"));
            tokens.put(token, dto);
            return token;
        }

        /** 按生产契约校验令牌：不存在或已过期时抛出未授权异常。 */
        @Override
        public OAuth2AccessTokenCheckRespDTO checkAccessToken(String accessToken) {
            checkedTokens.add(accessToken);
            if (errorTokens.contains(accessToken)) {
                throw new StackOverflowError("模拟令牌校验中的 JVM 级故障");
            }
            if (failingTokens.contains(accessToken)) {
                throw new IllegalStateException("模拟令牌校验中的运行时故障");
            }
            OAuth2AccessTokenCheckRespDTO dto = tokens.get(accessToken);
            if (dto == null) {
                throw new ServiceException(401, "访问令牌不存在");
            }
            if (dto.getExpiresTime().isBefore(LocalDateTime.now())) {
                throw new ServiceException(401, "访问令牌已过期");
            }
            return dto;
        }

        /** 令牌签发不在本切片的被测范围内。 */
        @Override
        public OAuth2AccessTokenRespDTO createAccessToken(OAuth2AccessTokenCreateReqDTO reqDTO) {
            throw new UnsupportedOperationException("本切片不签发令牌");
        }

        /** 令牌移除不在本切片的被测范围内。 */
        @Override
        public OAuth2AccessTokenRespDTO removeAccessToken(String accessToken) {
            throw new UnsupportedOperationException("本切片不移除令牌");
        }

        /** 令牌刷新不在本切片的被测范围内。 */
        @Override
        public OAuth2AccessTokenRespDTO refreshAccessToken(String refreshToken, String clientId) {
            throw new UnsupportedOperationException("本切片不刷新令牌");
        }
    }

    /**
     * 权限查询替身：只有登记在 {@code grantedUserIds} 中的用户才通过功能权限判定。
     * 若一律放行，“无权限应被拒绝”就成了恒真断言，无法证明拒绝路径真的可达。
     */
    static class RecordingPermissionCommonApi implements PermissionCommonApi {

        /** 被权限判定触达的用户编号。 */
        private final List<Long> checkedUserIds = Collections.synchronizedList(new ArrayList<>());
        /** 被授予目标权限的用户编号。 */
        private final Set<Long> grantedUserIds = ConcurrentHashMap.newKeySet();

        /** 记录调用来源，并只对已授权用户放行。 */
        @Override
        public boolean hasAnyPermissions(Long userId, String... permissions) {
            checkedUserIds.add(userId);
            return grantedUserIds.contains(userId);
        }

        /** 记录调用来源，并只对已授权用户放行。 */
        @Override
        public boolean hasAnyRoles(Long userId, String... roles) {
            checkedUserIds.add(userId);
            return grantedUserIds.contains(userId);
        }

        /** 数据权限不在本切片的被测范围内。 */
        @Override
        public DeptDataPermissionRespDTO getDeptDataPermission(Long userId) {
            throw new UnsupportedOperationException("本切片不查询数据权限");
        }
    }

    /** 保留安全配置属性的真实默认值，避免测试通过依赖被改写的配置。 */
    @Test
    void securityPropertiesKeepProductionDefaults() {
        SecurityProperties properties = context.getBean(SecurityProperties.class);
        assertThat(properties.getTokenHeader()).isEqualTo("Authorization");
        assertThat(properties.getTokenParameter()).isEqualTo("token");
        assertThat(properties.getMockEnable()).isFalse();
        assertThat(properties.getPasswordEncoderLength())
                .as("口令加密强度是安全参数，默认值不得被静默降低").isEqualTo(10);
    }

    /**
     * 口令编码器必须按配置强度生成 BCrypt 摘要。
     * 强度下降会让离线爆破成本骤降，因此同时校验可校验性与实际摘要强度。
     */
    @Test
    void passwordEncoderUsesConfiguredStrength() {
        PasswordEncoder encoder = context.getBean(PasswordEncoder.class);
        String raw = "Passw0rd-" + UUID.randomUUID();

        String encoded = encoder.encode(raw);
        assertThat(encoded).as("摘要不得包含原文").doesNotContain(raw);
        assertThat(encoder.matches(raw, encoded)).as("正确口令必须通过").isTrue();
        assertThat(encoder.matches("Wrong1pass", encoded)).as("错误口令必须被拒绝").isFalse();
        assertThat(encoded)
                .as("摘要前段编码了成本因子，可据此反推实际强度")
                .matches("^\\$2a\\$10\\$.*");
    }

    /** 相同口令两次编码必须得到不同摘要，盐值不得被省略。 */
    @Test
    void passwordEncoderSaltsEachEncoding() {
        PasswordEncoder encoder = context.getBean(PasswordEncoder.class);
        String raw = "Passw0rd";

        assertThat(encoder.encode(raw)).isNotEqualTo(encoder.encode(raw));
    }

    /** 授权扩展点必须按生产前缀组合 URL，组合错误会放行错误路径。 */
    @Test
    void customizerBuildsAdminAndAppApiUrls() {
        WebProperties webProperties = context.getBean(WebProperties.class);
        assertThat(webProperties.getAdminApi().getPrefix()).isEqualTo("/admin-api");
        assertThat(webProperties.getAppApi().getPrefix()).isEqualTo("/app-api");
        // 由容器注入属性的扩展点实例，验证生产生效路径下的前缀拼接。
        PrefixProbe customizer = context.getBean(PrefixProbe.class);
        assertThat(customizer.getOrder()).as("默认顺序为零，模块按声明顺序追加规则").isZero();
        assertThat(customizer.adminUrl("/x"))
                .as("容器实例必须使用 WebProperties 组合后台路径").isEqualTo("/admin-api/x");
        assertThat(customizer.appUrl("/x"))
                .as("容器实例必须使用 WebProperties 组合会员端路径").isEqualTo("/app-api/x");
    }

    /** 容器中注册的扩展点，额外暴露受保护的 URL 组合方法。 */
    @Configuration(proxyBeanMethods = false)
    static class PrefixProbeConfiguration {

        /** 暴露受保护方法的扩展点 Bean。 */
        @Bean
        PrefixProbe prefixProbe() {
            return new PrefixProbe();
        }
    }

    /** 暴露受保护的 URL 组合方法，用于验证生产前缀拼接。 */
    static class PrefixProbe extends AuthorizeRequestsCustomizer {

        /** 本组只验证 URL 组合，不追加授权规则。 */
        @Override
        public void customize(
                AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry registry) {
            // 无附加规则
        }

        /** 暴露后台前缀组合。 */
        String adminUrl(String url) {
            return buildAdminApi(url);
        }

        /** 暴露会员端前缀组合。 */
        String appUrl(String url) {
            return buildAppApi(url);
        }
    }

    /**
     * 令牌校验通过时，除安全上下文外还必须写入请求属性。
     * 访问日志过滤器位于安全过滤器之后，届时上下文已不可用，操作人只能来自请求属性。
     */
    @Test
    void loginUserIsAlsoWrittenToRequestAttributes() throws Exception {
        String token = issueToken(91L, UserTypeEnum.ADMIN, LocalDateTime.now().plusMinutes(10), Map.of());
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/protected/login-only");
        request.addHeader("Authorization", "Bearer " + token);
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean chainInvoked = new AtomicBoolean();

        new TokenAuthenticationFilter(context.getBean(SecurityProperties.class),
                context.getBean(GlobalExceptionHandler.class), fixedTokenApi())
                .doFilter(request, response, (servletRequest, servletResponse) -> chainInvoked.set(true));

        assertThat(chainInvoked.get()).as("令牌有效时必须继续过滤链").isTrue();
        assertThat(request.getAttribute("login_user_id")).isEqualTo(91L);
        assertThat(request.getAttribute("login_user_type")).isEqualTo(UserTypeEnum.ADMIN.getValue());
    }

    /**
     * 令牌校验失败时不得写入请求属性。
     * 若失败路径也留下用户信息，访问日志会把无效请求记到某个真实用户名下。
     */
    @Test
    void requestAttributesStayEmptyAfterTokenRejected() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/protected/login-only");
        request.addHeader("Authorization", "Bearer forged-" + UUID.randomUUID());
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean chainInvoked = new AtomicBoolean();

        new TokenAuthenticationFilter(context.getBean(SecurityProperties.class),
                context.getBean(GlobalExceptionHandler.class), fixedTokenApi())
                .doFilter(request, response, (servletRequest, servletResponse) -> chainInvoked.set(true));

        assertThat(request.getAttribute("login_user_id")).isNull();
        assertThat(request.getAttribute("login_user_type")).isNull();
    }

    /**
     * 用户类型不符时过滤器必须中断链路并写出错误响应体。
     * 若链路继续，受保护接口会在没有身份的情况下被执行。
     */
    @Test
    void userTypeMismatchStopsChainAndWritesErrorResponse() throws Exception {
        String token = issueToken(92L, UserTypeEnum.MEMBER, LocalDateTime.now().plusMinutes(10), Map.of());
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/protected/login-only");
        request.setServletPath("/admin-api/protected/login-only");
        request.addHeader("Authorization", "Bearer " + token);
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean chainInvoked = new AtomicBoolean();

        new TokenAuthenticationFilter(context.getBean(SecurityProperties.class),
                context.getBean(GlobalExceptionHandler.class), fixedTokenApi())
                .doFilter(request, response, (servletRequest, servletResponse) -> chainInvoked.set(true));

        assertThat(chainInvoked.get()).as("用户类型不符时必须中断过滤链").isFalse();
        JsonNode body = JsonUtils.parseObject(response.getContentAsString(), JsonNode.class);
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(403);
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    /** 令牌校验抛出运行时异常时必须中断链路并返回错误响应，且不留下上下文。 */
    @Test
    void unexpectedTokenApiFailureStopsChainWithErrorResponse() throws Exception {
        String token = issueToken(93L, UserTypeEnum.ADMIN, LocalDateTime.now().plusMinutes(10), Map.of());
        tokenApi.failingTokens.add(token);
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/protected/login-only");
        request.setServletPath("/admin-api/protected/login-only");
        request.addHeader("Authorization", "Bearer " + token);
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean chainInvoked = new AtomicBoolean();

        new TokenAuthenticationFilter(context.getBean(SecurityProperties.class),
                context.getBean(GlobalExceptionHandler.class), fixedTokenApi())
                .doFilter(request, response, (servletRequest, servletResponse) -> chainInvoked.set(true));

        assertThat(chainInvoked.get()).as("令牌校验异常时必须中断过滤链").isFalse();
        JsonNode body = JsonUtils.parseObject(response.getContentAsString(), JsonNode.class);
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isNotEqualTo(0);
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    /**
     * JVM 级故障必须继续向上抛出。
     * 若过滤器把 Error 也吞成鉴权响应，进程级问题会被伪装成普通的未授权。
     */
    @Test
    void jvmErrorFromTokenApiMustPropagate() {
        String token = issueToken(94L, UserTypeEnum.ADMIN, LocalDateTime.now().plusMinutes(10), Map.of());
        tokenApi.errorTokens.add(token);
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/protected/login-only");
        request.setServletPath("/admin-api/protected/login-only");
        request.addHeader("Authorization", "Bearer " + token);

        TokenAuthenticationFilter filter = new TokenAuthenticationFilter(
                context.getBean(SecurityProperties.class), context.getBean(GlobalExceptionHandler.class),
                fixedTokenApi());
        assertThatThrownBy(() -> filter.doFilter(request, new MockHttpServletResponse(),
                (servletRequest, servletResponse) -> {
                })).isInstanceOf(StackOverflowError.class);
    }

    /** 构造始终返回内存令牌仓储的 ObjectProvider，避免在用例中重复匿名实现。 */
    private ObjectProvider<OAuth2TokenCommonApi> fixedTokenApi() {
        return new ObjectProvider<>() {

            /** 返回测试令牌仓储。 */
            @Override
            public OAuth2TokenCommonApi getObject() {
                return tokenApi;
            }

            /** 无额外参数，忽略传入值。 */
            @Override
            public OAuth2TokenCommonApi getObject(Object... args) {
                return tokenApi;
            }

            /** 测试令牌仓储始终存在。 */
            @Override
            public OAuth2TokenCommonApi getIfAvailable() {
                return tokenApi;
            }

            /** 测试令牌仓储始终唯一。 */
            @Override
            public OAuth2TokenCommonApi getIfUnique() {
                return tokenApi;
            }
        };
    }
}
