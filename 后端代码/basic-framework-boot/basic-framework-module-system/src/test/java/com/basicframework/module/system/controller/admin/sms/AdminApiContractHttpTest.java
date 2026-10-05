package com.basicframework.module.system.controller.admin.sms;

import com.basicframework.framework.common.biz.infra.logger.ApiErrorLogCommonApi;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.jackson.config.BasicFrameworkJacksonAutoConfiguration;
import com.basicframework.framework.web.core.handler.GlobalExceptionHandler;
import com.basicframework.module.system.controller.admin.permission.RoleController;
import com.basicframework.module.system.controller.admin.sms.vo.channel.SmsChannelPageReqVO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.dal.dataobject.sms.SmsChannelDO;
import com.basicframework.module.system.service.permission.RoleService;
import com.basicframework.module.system.service.sms.SmsChannelService;
import com.basicframework.module.system.service.user.AdminUserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.validation.Validator;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 用真实 Spring MVC、真实方法级鉴权、真实统一异常处理与真实 Jackson 规则验证管理端接口契约。
 *
 * <p>本用例覆盖合同面而不是业务流程：分页与详情响应必须经过 {@code CommonResult<PageResult<T>>}
 * 的真实序列化（毫秒时间戳、字段名与空值形态），越权请求必须按统一错误体拒绝且在进入业务层之前
 * 中断，非法分页参数必须在参数校验阶段被拦下，只读下拉端点不得要求业务权限。Service 用替身隔离，
 * 使断言只落在 Controller、鉴权、校验、异常转换与序列化这些契约环节。</p>
 *
 * <p>安全过滤链与令牌签发由 {@code OAuth2MachinePrincipalHttpMySqlIT} 与机器主体用例覆盖；
 * 这里不引入过滤链，未认证语义由权限判定替身拒绝表达。</p>
 *
 * @author DeepSeek
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AdminApiContractHttpTest {

    /** 短信渠道业务服务替身；被拒绝的请求不允许出现任何交互。 */
    private static SmsChannelService channelService;

    /** 角色业务服务替身；用于核对第二个资源的越权拒绝。 */
    private static RoleService roleService;

    /** 角色关联的用户服务替身；本用例不进入该分支。 */
    private static AdminUserService userService;

    /** 生产统一异常处理器依赖的错误日志 API 替身。 */
    private static ApiErrorLogCommonApi apiErrorLogApi;

    /** 生产 MVC + 生产方法级鉴权 + 生产异常处理 + 生产序列化规则的 MockMvc。 */
    private static MockMvc mvc;

    /** 真实 Web 上下文，关闭时释放 MVC 资源。 */
    private static AnnotationConfigWebApplicationContext context;

    /** 权限判定替身，用于逐端点放行或拒绝。 */
    private static PermissionGate permissionGate;

    /** 复用真实响应的解析器，断言只依赖真实 JSON 文本。 */
    private static final ObjectMapper READER = new ObjectMapper();

    /** 建立真实 MVC 容器、生产异常处理与生产序列化规则。 */
    @BeforeAll
    static void createEnvironment() {
        channelService = mock(SmsChannelService.class);
        roleService = mock(RoleService.class);
        userService = mock(AdminUserService.class);
        apiErrorLogApi = mock(ApiErrorLogCommonApi.class);
        context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.register(WebContractConfiguration.class);
        context.refresh();
        permissionGate = context.getBean(PermissionGate.class);
        mvc = MockMvcBuilders.webAppContextSetup(context).build();
    }

    /** 关闭上下文，避免 MVC 与线程上下文在用例之间泄漏。 */
    @AfterAll
    static void closeEnvironment() {
        if (context != null) {
            context.close();
        }
    }

    /** 每例复位替身与权限记录，避免“未被调用”类断言被上一例污染。 */
    @BeforeEach
    void resetFixture() {
        reset(channelService, roleService, userService, apiErrorLogApi);
        permissionGate.reset();
    }

    /**
     * 分页响应必须按真实序列化输出统一包装、分页字段与毫秒时间戳，且不含密钥字段。
     *
     * <p>前端按下标读取 {@code data.list} 与 {@code data.total}，时间列依赖毫秒时间戳；
     * 密钥一旦出现在列表响应里，所有拥有查询权限的账号都能读到第三方服务凭据。</p>
     *
     * @throws Exception HTTP 请求执行或响应解析失败时抛出
     */
    @Test
    void pageResponseKeepsPaginationShapeAndHidesSecret() throws Exception {
        SmsChannelDO channel = new SmsChannelDO();
        channel.setId(7L);
        channel.setSignature("示例签名");
        channel.setCode("ALIYUN");
        channel.setStatus(1);
        channel.setApiKey("DUMMY-access-key");
        channel.setApiSecret("DUMMY-access-secret");
        channel.setCreateTime(LocalDateTime.of(2024, 1, 2, 3, 4, 5));
        when(channelService.getSmsChannelPage(any(SmsChannelPageReqVO.class)))
                .thenReturn(new PageResult<>(List.of(channel), 1L));

        MvcResult result = mvc.perform(get("/system/sms-channel/page")
                        .param("pageNo", "1").param("pageSize", "10"))
                .andReturn();

        JsonNode body = readBody(result);
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isZero();
        assertThat(body.get("msg").asText()).isEmpty();
        JsonNode data = body.get("data");
        assertThat(data.get("total").isNumber()).as("总量必须是数字").isTrue();
        assertThat(data.get("total").asLong()).isEqualTo(1L);
        assertThat(data.get("list").isArray()).isTrue();
        JsonNode row = data.get("list").get(0);
        assertThat(row.get("id").asLong()).isEqualTo(7L);
        assertThat(row.get("signature").asText()).isEqualTo("示例签名");
        assertThat(row.get("apiKey").asText()).isEqualTo("DUMMY-access-key");
        long expectedMillis = LocalDateTime.of(2024, 1, 2, 3, 4, 5)
                .atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli();
        assertThat(row.get("createTime").isNumber()).as("时间必须是毫秒时间戳").isTrue();
        assertThat(row.get("createTime").asLong()).isEqualTo(expectedMillis);
        assertThat(row.has("apiSecret")).as("响应不得包含短信 API 密钥").isFalse();
        assertThat(result.getResponse().getContentAsString()).doesNotContain("DUMMY-access-secret");
    }

    /**
     * 详情响应同样不得输出密钥，且必须保留调用方依赖的非秘密字段。
     *
     * @throws Exception HTTP 请求执行或响应解析失败时抛出
     */
    @Test
    void detailResponseHidesSecretAndKeepsVisibleFields() throws Exception {
        SmsChannelDO channel = new SmsChannelDO();
        channel.setId(9L);
        channel.setSignature("详情签名");
        channel.setCode("TENCENT");
        channel.setStatus(1);
        channel.setApiKey("DUMMY-detail-key");
        channel.setApiSecret("DUMMY-detail-secret");
        channel.setCallbackUrl("https://example.invalid/sms/callback");
        when(channelService.getSmsChannel(9L)).thenReturn(channel);

        MvcResult result = mvc.perform(get("/system/sms-channel/get").param("id", "9")).andReturn();

        JsonNode data = readBody(result).get("data");
        assertThat(data.get("callbackUrl").asText()).isEqualTo("https://example.invalid/sms/callback");
        assertThat(data.has("apiSecret")).as("响应不得包含短信 API 密钥").isFalse();
        assertThat(result.getResponse().getContentAsString()).doesNotContain("DUMMY-detail-secret");
    }

    /**
     * 越权查询必须按统一错误体拒绝，且不得触达业务层。
     *
     * <p>只靠前端隐藏按钮不能阻止直接构造请求；这里同时锁定响应体与“业务层零交互”。</p>
     *
     * @throws Exception HTTP 请求执行或响应解析失败时抛出
     */
    @Test
    void deniedPermissionRejectsQueryBeforeService() throws Exception {
        permissionGate.deny("system:sms-channel:query");

        MvcResult result = mvc.perform(get("/system/sms-channel/page")
                        .param("pageNo", "1").param("pageSize", "10"))
                .andReturn();

        JsonNode body = readBody(result);
        assertThat(result.getResponse().getStatus()).as("统一错误体承载拒绝结果").isEqualTo(200);
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(403);
        assertThat(body.get("data").isNull()).isTrue();
        verifyNoInteractions(channelService);
    }

    /**
     * 第二个资源的越权写入同样被拒绝，证明契约不是单个 Controller 的特例。
     *
     * @throws Exception HTTP 请求执行失败时抛出
     */
    @Test
    void deniedPermissionRejectsRoleCreate() throws Exception {
        permissionGate.deny("system:role:create");

        MvcResult result = mvc.perform(post("/system/role/create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"示例角色\",\"code\":\"demo_role\",\"sort\":1,\"status\":1}"))
                .andReturn();

        assertThat(readBody(result).get("code").asInt()).isEqualTo(403);
        verifyNoInteractions(roleService);
    }

    /**
     * 非法分页参数必须在参数校验阶段被拦下，不能进入业务层后再报错。
     *
     * @throws Exception HTTP 请求执行失败时抛出
     */
    @Test
    void invalidPaginationIsRejectedBeforeService() throws Exception {
        MvcResult result = mvc.perform(get("/system/sms-channel/page")
                        .param("pageNo", "0").param("pageSize", "500"))
                .andReturn();

        JsonNode body = readBody(result);
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(400);
        assertThat(body.get("msg").asText()).isNotEmpty();
        verifyNoInteractions(channelService);
    }

    /**
     * 只读下拉端点不要求业务权限，但必须记录“没有请求任何权限串”这一事实。
     *
     * <p>该端点由安全链要求真实用户身份，属于登记在册的授权方式；若它开始要求权限码，
     * 权限判定替身会记录到请求，用例即失败。</p>
     *
     * @throws Exception HTTP 请求执行或响应解析失败时抛出
     */
    @Test
    void simpleListEndpointNeedsNoBusinessPermission() throws Exception {
        SmsChannelDO channel = new SmsChannelDO();
        channel.setId(3L);
        channel.setSignature("下拉签名");
        channel.setCode("ALIYUN");
        when(channelService.getSmsChannelList()).thenReturn(new ArrayList<>(List.of(channel)));

        MvcResult result = mvc.perform(get("/system/sms-channel/list-all-simple")).andReturn();

        JsonNode body = readBody(result);
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isZero();
        assertThat(body.get("data").get(0).get("signature").asText()).isEqualTo("下拉签名");
        assertThat(permissionGate.requestedPermissions()).as("下拉端点不声明业务权限码").isEmpty();
    }

    /**
     * 已授权请求必须真实调用业务层并记录被请求的权限串。
     *
     * <p>放行断言与拒绝断言成对存在，避免“整条链路失效”被当成隔离成功。</p>
     *
     * @throws Exception HTTP 请求执行失败时抛出
     */
    @Test
    void authorizedQueryReachesServiceWithDeclaredPermission() throws Exception {
        when(channelService.getSmsChannelPage(any(SmsChannelPageReqVO.class)))
                .thenReturn(new PageResult<>(List.of(), 0L));

        MvcResult result = mvc.perform(get("/system/sms-channel/page")
                        .param("pageNo", "1").param("pageSize", "10"))
                .andReturn();

        assertThat(readBody(result).get("code").asInt()).isZero();
        verify(channelService).getSmsChannelPage(any(SmsChannelPageReqVO.class));
        assertThat(permissionGate.requestedPermissions()).containsExactly("system:sms-channel:query");
    }

    /**
     * 删除接口缺少必填编号时由参数校验拒绝，不能退化成删除全部或空操作。
     *
     * @throws Exception HTTP 请求执行失败时抛出
     */
    @Test
    void deleteWithoutIdentifierIsRejected() throws Exception {
        MvcResult result = mvc.perform(
                org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/system/sms-channel/delete"))
                .andReturn();

        JsonNode body = readBody(result);
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(400);
        verify(channelService, never()).deleteSmsChannel(any());
    }

    /**
     * 解析真实响应体，避免断言依赖日志输出。
     *
     * @param result MockMvc 执行结果
     * @return 解析后的 JSON 响应体
     * @throws Exception 响应体读取或 JSON 解析失败时抛出
     */
    private static JsonNode readBody(MvcResult result) throws Exception {
        return READER.readTree(result.getResponse().getContentAsString());
    }

    /**
     * 真实 MVC、真实校验、真实方法级鉴权、生产统一异常处理与生产序列化规则的最小装配。
     *
     * <p>不引入 Security 过滤链：拒绝语义由方法级 {@code @PreAuthorize} 与生产
     * {@link GlobalExceptionHandler} 共同表达，两者都是线上真实生效的实现。</p>
     */
    @Configuration(proxyBeanMethods = false)
    @EnableWebMvc
    @EnableMethodSecurity
    static class WebContractConfiguration {

        /**
         * 使用真实 Bean Validation，非法请求才会被真正拦下。
         *
         * @return MVC 校验器
         */
        @Bean
        public Validator mvcValidator() {
            return new LocalValidatorFactoryBean();
        }

        /**
         * {@code @ss} 表达式引用的权限判定替身。
         *
         * @return 可编程权限判定器
         */
        @Bean
        public PermissionGate ss() {
            return new PermissionGate();
        }

        /**
         * 生产统一异常处理器，负责把鉴权失败与参数错误转换成统一响应体。
         *
         * @return 生产异常处理器实例
         */
        @Bean
        public GlobalExceptionHandler globalExceptionHandler() {
            return new GlobalExceptionHandler("basic-framework-test", apiErrorLogApi);
        }

        /**
         * 让 MVC 使用与生产自动配置同源的 Jackson 规则构造响应。
         *
         * @return 替换默认 JSON 转换器的配置器
         */
        @Bean
        public WebMvcConfigurer contractJacksonConfigurer() {
            return new WebMvcConfigurer() {

                /**
                 * 用生产时间与数值规则构造的映射器替换默认 JSON 转换器。
                 *
                 * @param converters 当前 MVC 消息转换器列表
                 */
                @Override
                public void extendMessageConverters(List<HttpMessageConverter<?>> converters) {
                    BasicFrameworkJacksonAutoConfiguration jackson =
                            new BasicFrameworkJacksonAutoConfiguration();
                    Jackson2ObjectMapperBuilder builder = Jackson2ObjectMapperBuilder.json();
                    jackson.ldtEpochMillisCustomizer().customize(builder);
                    builder.modulesToInstall(jackson.timestampSupportModuleBean());
                    builder.featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
                    converters.removeIf(MappingJackson2HttpMessageConverter.class::isInstance);
                    converters.add(0, new MappingJackson2HttpMessageConverter(builder.build()));
                }
            };
        }

        /**
         * 按 {@code @Resource} 的字段名注册短信渠道服务替身。
         *
         * @return 短信渠道服务替身
         */
        @Bean
        public SmsChannelService smsChannelService() {
            return channelService;
        }

        /**
         * 按 {@code @Resource} 的字段名注册角色服务替身。
         *
         * @return 角色服务替身
         */
        @Bean
        public RoleService roleService() {
            return roleService;
        }

        /**
         * 按 {@code @Resource} 的字段名注册用户服务替身。
         *
         * @return 用户服务替身
         */
        @Bean
        public AdminUserService adminUserService() {
            return userService;
        }

        /**
         * 注册被测短信渠道 Controller，走生产按名注入装配。
         *
         * @return 真实 Controller 实例
         */
        @Bean
        public SmsChannelController smsChannelController() {
            return new SmsChannelController();
        }

        /**
         * 注册被测角色 Controller，走生产按名注入装配。
         *
         * @return 真实 Controller 实例
         */
        @Bean
        public RoleController roleController() {
            return new RoleController();
        }
    }

    /**
     * 可编程的权限判定替身。
     *
     * <p>保留生产 {@code @ss.hasPermission(String)} 的调用契约，只把“当前用户有哪些权限”
     * 换成测试可控的开关，并记录每次被请求的权限串用于逐端点断言。</p>
     */
    static class PermissionGate {

        /** 被显式拒绝的权限串；为空表示全部放行。 */
        private String denied;

        /** 按调用顺序记录被请求的权限串。 */
        private final List<String> requested = new ArrayList<>();

        /**
         * 判定当前请求是否具备该权限。
         *
         * @param permission 端点声明的权限串
         * @return 是否放行
         */
        public boolean hasPermission(String permission) {
            requested.add(permission);
            return !permission.equals(denied);
        }

        /**
         * 拒绝指定权限。
         *
         * @param permission 需要拒绝的权限串
         */
        void deny(String permission) {
            this.denied = permission;
        }

        /**
         * 读取按顺序记录的权限请求。
         *
         * @return 被请求的权限串列表
         */
        List<String> requestedPermissions() {
            return List.copyOf(requested);
        }

        /** 复位开关与记录。 */
        void reset() {
            this.denied = null;
            this.requested.clear();
        }
    }
}
