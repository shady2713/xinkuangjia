package com.basicframework.module.infra.framework.security.config;

import com.basicframework.framework.security.config.AuthorizeRequestsCustomizer;
import com.basicframework.framework.web.config.WebProperties;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.MapPropertySource;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.annotation.web.configurers.AuthorizeHttpRequestsConfigurer;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/**
 * 运行期验证 infra 模块「匿名白名单大幅收窄」这一本地契约在真实安全链上的放行与拒绝边界。
 *
 * <p>被测对象是生产 {@link SecurityConfiguration} 注册的
 * {@code infraAuthorizeRequestsCustomizer}。用例把该自定义器放进一条**真实的
 * {@link HttpSecurity} 过滤链**（{@code @EnableWebSecurity} + 真实 {@code AuthorizationFilter} +
 * 真实路径匹配），再用真实 {@link MockMvc} 请求逐条打过去，观察放行（处理器返回 200）与拒绝
 * （认证入口点返回 401）两种运行期结果。因此断言锁的是「哪些路径匿名可达」，而不是源码里的
 * {@code requestMatchers(...)} 字面量。</p>
 *
 * <p>路径必须真实存在对应处理器，否则放行与「未匹配到处理器」的 404 无法区分，探针会失去区分力。
 * 因此本类为每条被探测路径注册了真实处理器。</p>
 *
 * <p>判别性由同文件内的**上游白名单变体** {@link UpstreamWhitelistCustomizer} 提供：它按上游
 * 形状注册 {@code /actuator/**}、{@code /v3/api-docs/**}、{@code /druid/**}、{@code /swagger-ui}
 * 系列与按编号取文件的路径（{@code /admin-api/infra/file} + 单字符段 + {@code /get/**}）。
 * 同一探针对变体给出 200、对生产给出 401，且对
 * 变体执行与生产相同的断言会失败。若生产白名单被改回上游形状，本类对生产的断言立即失败。</p>
 *
 * @author 契约与出口方向执行代理
 */
class SecurityConfigurationAnonymousWhitelistRuntimeTest {

    /** 本地契约放行的路径：健康检查本体与子路径，上游的 actuator 通配也覆盖这两条。 */
    private static final List<String> SHARED_PERMITTED_PATHS = List.of(
            "/actuator/health", "/actuator/health/liveness");

    /** 本地契约新增的匿名面：按完整路径取文件，上游不放行。 */
    private static final String LOCAL_ONLY_PERMITTED_PATH = "/admin-api/infra/file/content/123";

    /** 上游「按配置编号取文件」路径形状，本地收窄后必须拒绝。 */
    private static final String UPSTREAM_FILE_GET_PATH = "/admin-api/infra/file/9/get/report.csv";

    /** 上游放行、本地收窄后必须拒绝的路径。 */
    private static final List<String> UPSTREAM_ONLY_PATHS = List.of(
            "/actuator", "/actuator/info", "/v3/api-docs", "/v3/api-docs/swagger-config",
            "/webjars/js/springfox.js", "/swagger-ui.html", "/swagger-ui/index.html",
            "/druid/login.html", UPSTREAM_FILE_GET_PATH);

    /** 完全不在白名单里的管理端接口，用来证明探测路径本身不是特例。 */
    private static final String UNLISTED_ADMIN_PATH = "/admin-api/system/dict-type/page";

    /** 装配生产白名单的 MockMvc，探针读数以此为准。 */
    private MockMvc productionMvc;

    /** 装配上游白名单变体的 MockMvc，仅用于负对照。 */
    private MockMvc variantMvc;

    /** 持有上下文字段，关闭时释放过滤器链资源。 */
    private final List<AnnotationConfigWebApplicationContext> contexts = new ArrayList<>();

    /**
     * 为两条链分别建立真实 Spring 上下文；本类不共享安全上下文状态。
     *
     * @throws Exception 上下文或过滤器链创建失败
     */
    @BeforeEach
    void setUp() throws Exception {
        productionMvc = mvcFor(true);
        variantMvc = mvcFor(false);
    }

    /** 关闭两条链的上下文，避免过滤器资源残留到同 JVM 的其他用例。 */
    @AfterEach
    void tearDown() {
        contexts.forEach(AnnotationConfigWebApplicationContext::close);
        contexts.clear();
    }

    /**
     * 本地白名单放行的三条路径匿名可达，证明收窄没有把必需的匿名入口一起关掉。
     *
     * <p>三条路径覆盖两种规则形状：精确路径与子路径通配，外加一条新增的管理端匿名面。</p>
     */
    @Test
    void locallyPermittedPathsAreReachableAnonymously() throws Exception {
        for (String path : SHARED_PERMITTED_PATHS) {
            assertThat(statusOf(productionMvc, path))
                    .as("本地契约要求匿名放行：%s", path).isEqualTo(HttpStatus.OK.value());
        }
        assertThat(statusOf(productionMvc, LOCAL_ONLY_PERMITTED_PATH))
                .as("本地契约要求匿名放行：%s", LOCAL_ONLY_PERMITTED_PATH)
                .isEqualTo(HttpStatus.OK.value());
    }

    /**
     * 上游放行、本地收窄的九条路径匿名必须被拒绝。
     *
     * <p>这是「白名单大幅收窄」在运行期的核心读数：每条路径都有真实处理器，若放行则会返回 200，
     * 因此 401 只能来自安全链的拒绝判定。</p>
     */
    @Test
    void upstreamOnlyPathsAreRejectedAnonymously() throws Exception {
        for (String path : UPSTREAM_ONLY_PATHS) {
            assertThat(statusOf(productionMvc, path))
                    .as("本地契约要求拒绝上游放行的路径：%s", path).isEqualTo(HttpStatus.UNAUTHORIZED.value());
        }
    }

    /** 两条链都拒绝的普通管理端接口，作为探针有效性的对照：探针不是「一律拒绝」。 */
    @Test
    void unlistedAdminPathIsRejectedOnBothChains() throws Exception {
        assertThat(statusOf(productionMvc, UNLISTED_ADMIN_PATH))
                .isEqualTo(HttpStatus.UNAUTHORIZED.value());
        assertThat(statusOf(variantMvc, UNLISTED_ADMIN_PATH))
                .as("上游白名单同样不包含该路径，探针对两者读数一致")
                .isEqualTo(HttpStatus.UNAUTHORIZED.value());
    }

    /**
     * 同一探针作用到上游白名单变体时读数必须相反，且对变体执行生产断言会失败。
     *
     * <p>这证明上面的拒绝断言确实由本地白名单内容决定，而不是探针实现恒定返回 401。</p>
     */
    @Test
    void upstreamWhitelistVariantFlipsTheVerdictSoTheAssertionDiscriminates() throws Exception {
        assertThat(statusOf(variantMvc, "/actuator/info"))
                .as("上游白名单放行 actuator info，本地收窄后拒绝")
                .isEqualTo(HttpStatus.OK.value());
        assertThat(statusOf(variantMvc, UPSTREAM_FILE_GET_PATH))
                .as("上游白名单放行按编号取文件，本地只放行按 content 取文件")
                .isEqualTo(HttpStatus.OK.value());
        assertThatThrownBy(() -> assertThat(statusOf(variantMvc, "/actuator/info"))
                .isEqualTo(HttpStatus.UNAUTHORIZED.value()))
                .as("同一断言作用在契约违反变体上必须失败")
                .isInstanceOf(AssertionError.class);
    }

    /**
     * 两侧读数必须逐条落在真实边界上：收窄不是纯子集，而是与上游互有出入的一组放行路径。
     *
     * <p>实测读数分三类：上游放行、本地拒绝（{@link #UPSTREAM_ONLY_PATHS} 全部）；两侧都放行
     * （健康检查，因为上游用 {@code /actuator/**} 覆盖）；本地放行、上游拒绝（按 content 取文件，
     * 上游只放行按编号取文件）。把这三类都固定下来，避免把「收窄」误解成「单纯取子集」而导致
     * 忽略本地新增的匿名面。</p>
     */
    @Test
    void productionAndVariantDifferExactlyOnTheNarrowingBoundary() throws Exception {
        for (String path : UPSTREAM_ONLY_PATHS) {
            assertThat(statusOf(productionMvc, path))
                    .as("上游放行、本地收窄：%s", path)
                    .isEqualTo(HttpStatus.UNAUTHORIZED.value());
            assertThat(statusOf(variantMvc, path))
                    .as("上游放行、本地收窄：%s", path)
                    .isEqualTo(HttpStatus.OK.value());
        }
        for (String path : SHARED_PERMITTED_PATHS) {
            assertThat(statusOf(productionMvc, path))
                    .as("两侧都放行：%s", path)
                    .isEqualTo(HttpStatus.OK.value());
            assertThat(statusOf(variantMvc, path))
                    .as("两侧都放行：%s", path)
                    .isEqualTo(HttpStatus.OK.value());
        }
        assertThat(statusOf(productionMvc, LOCAL_ONLY_PERMITTED_PATH))
                .as("本地新增匿名面：按 content 取文件")
                .isEqualTo(HttpStatus.OK.value());
        assertThat(statusOf(variantMvc, LOCAL_ONLY_PERMITTED_PATH))
                .as("上游只放行按编号取文件，不放行按 content 取文件")
                .isEqualTo(HttpStatus.UNAUTHORIZED.value());
    }

    /**
     * 装配一条真实安全链并返回可直接发起请求的 {@link MockMvc}。
     *
     * @param production 为真时装配生产 {@link SecurityConfiguration}，否则装配上游白名单变体
     * @return 带真实 Spring Security 过滤链的 MockMvc
     * @throws Exception 上下文或过滤器链创建失败
     */
    private MockMvc mvcFor(boolean production) throws Exception {
        AnnotationConfigWebApplicationContext context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("cbclass-security",
                Map.of("basic-framework.web.admin-ui.url", "http://localhost:5175")));
        context.register(MvcConfiguration.class, WebSecurityTestConfiguration.class, ChainConfiguration.class,
                ProbeController.class);
        if (production) {
            context.register(SecurityConfiguration.class);
        } else {
            context.register(UpstreamWhitelistConfiguration.class);
        }
        context.refresh();
        contexts.add(context);
        return MockMvcBuilders.webAppContextSetup(context)
                .addFilters(context.getBean("springSecurityFilterChain", jakarta.servlet.Filter.class))
                .build();
    }

    /**
     * 发起一次真实匿名 GET 请求并返回状态码。
     *
     * @param mvc 目标链
     * @param path 请求路径，必须存在真实处理器
     * @return 真实响应状态码
     * @throws Exception 请求执行失败
     */
    private static int statusOf(MockMvc mvc, String path) throws Exception {
        MockHttpServletRequestBuilder builder = get(path);
        MvcResult result = mvc.perform(builder).andReturn();
        return result.getResponse().getStatus();
    }

    /** 探针路径必须真实存在，否则放行与 404 无法区分。 */
    @RestController
    static class ProbeController {

        /**
         * 健康检查本体。
         *
         * @return 固定文本
         */
        @GetMapping("/actuator/health")
        public String health() {
            return "health";
        }

        /**
         * 健康检查子路径。
         *
         * @return 固定文本
         */
        @GetMapping("/actuator/health/liveness")
        public String liveness() {
            return "liveness";
        }

        /**
         * actuator 根路径，上游放行、本地收窄。
         *
         * @return 固定文本
         */
        @GetMapping("/actuator")
        public String actuatorRoot() {
            return "actuator";
        }

        /**
         * actuator info 端点，上游放行、本地收窄。
         *
         * @return 固定文本
         */
        @GetMapping("/actuator/info")
        public String actuatorInfo() {
            return "info";
        }

        /**
         * OpenAPI 文档根路径，上游放行、本地收窄。
         *
         * @return 固定文本
         */
        @GetMapping("/v3/api-docs")
        public String apiDocsRoot() {
            return "api-docs";
        }

        /**
         * OpenAPI 分组文档，上游放行、本地收窄。
         *
         * @return 固定文本
         */
        @GetMapping("/v3/api-docs/swagger-config")
        public String swaggerConfig() {
            return "swagger-config";
        }

        /**
         * 静态资源，上游放行、本地收窄。
         *
         * @return 固定文本
         */
        @GetMapping("/webjars/js/springfox.js")
        public String webjar() {
            return "webjar";
        }

        /**
         * 文档页面，上游放行、本地收窄。
         *
         * @return 固定文本
         */
        @GetMapping("/swagger-ui.html")
        public String swaggerUiHtml() {
            return "swagger-ui-html";
        }

        /**
         * 文档静态页，上游放行、本地收窄。
         *
         * @return 固定文本
         */
        @GetMapping("/swagger-ui/index.html")
        public String swaggerUiIndex() {
            return "swagger-ui-index";
        }

        /**
         * Druid 监控页，上游放行、本地收窄。
         *
         * @return 固定文本
         */
        @GetMapping("/druid/login.html")
        public String druidLogin() {
            return "druid-login";
        }

        /**
         * 按完整路径取文件内容，本地放行。
         *
         * @param id 文件编号
         * @return 固定文本
         */
        @GetMapping("/admin-api/infra/file/content/{id}")
        public String fileContent(String id) {
            return "content-" + id;
        }

        /**
         * 按配置编号取文件，上游放行、本地收窄。
         *
         * @param configId 文件配置编号
         * @param name 文件名
         * @return 固定文本
         */
        @GetMapping("/admin-api/infra/file/{configId}/get/{name}")
        public String fileGet(String configId, String name) {
            return "get-" + configId + "-" + name;
        }

        /**
         * 普通管理端接口，两侧都不放行。
         *
         * @return 固定文本
         */
        @GetMapping("/admin-api/system/dict-type/page")
        public String dictTypePage() {
            return "dict-type-page";
        }

    }

    /** 生产 Web 前缀配置，驱动 buildAdminApi 使用真实前缀组合路径。 */
    @Configuration(proxyBeanMethods = false)
    static class ChainConfiguration {

        /** 暴露 WebProperties，上游变体也需要它组合管理端前缀。 */
        @Bean
        WebProperties webProperties() {
            return new WebProperties();
        }

        /**
         * 装配一条真实安全链：应用所选白名单自定义器，其余请求一律要求认证。
         *
         * <p>生产链还包含令牌过滤器、机器主体兜底等更靠后的规则；本切片只取与白名单收窄直接相关的
         * 那一段规则，因此把「应用自定义器 + 兜底要求认证」原样保留，其余规则不在被测范围内。</p>
         *
         * @param http Spring Security 构建器
         * @param customizers 白名单自定义器集合
         * @return 安全过滤器链
         * @throws Exception 过滤器链创建失败
         */
        @Bean
        SecurityFilterChain securityFilterChain(
                HttpSecurity http, org.springframework.beans.factory.ObjectProvider<AuthorizeRequestsCustomizer>
                        customizers) throws Exception {
            http.csrf(AbstractHttpConfigurer::disable)
                    .authorizeHttpRequests(c -> customizers.orderedStream().forEach(customizer -> customizer.customize(c)))
                    .authorizeHttpRequests(c -> c.anyRequest().authenticated())
                    .exceptionHandling(c -> c.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)));
            return http.build();
        }

    }

    /** 契约违反变体：按上游形状注册放行集合。 */
    @Configuration(proxyBeanMethods = false)
    static class UpstreamWhitelistConfiguration {

        /** 上游形状的白名单自定义器，仅用于负对照。 */
        @Bean
        AuthorizeRequestsCustomizer upstreamWhitelistCustomizer() {
            return new AuthorizeRequestsCustomizer() {

                /**
                 * 按上游形状放行文档、静态资源、actuator、Druid 与按编号取文件。
                 *
                 * @param registry Spring Security 请求匹配注册器
                 */
                @Override
                public void customize(
                        AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry registry) {
                    registry.requestMatchers("/v3/api-docs/**", "/webjars/**", "/swagger-ui.html", "/swagger-ui/**",
                                    "/actuator", "/actuator/**", "/druid/**").permitAll();
                    registry.requestMatchers(buildAdminApi("/infra/file/*/get/**")).permitAll();
                }

            };
        }

    }

    /** 补齐真实 MVC 装配，路径匹配依赖它。 */
    @Configuration(proxyBeanMethods = false)
    @EnableWebMvc
    static class MvcConfiguration {
    }

    /** 开启 Web 安全支持，真实 HttpSecurity 由它提供。 */
    @Configuration(proxyBeanMethods = false)
    @EnableWebSecurity
    static class WebSecurityTestConfiguration {
    }

}