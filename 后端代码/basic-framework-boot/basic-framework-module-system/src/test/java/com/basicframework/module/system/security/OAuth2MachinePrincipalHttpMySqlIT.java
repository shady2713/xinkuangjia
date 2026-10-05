package com.basicframework.module.system.security;

import cn.hutool.extra.spring.SpringUtil;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.basicframework.framework.common.api.config.ConfigApi;
import com.basicframework.framework.common.biz.infra.logger.ApiErrorLogCommonApi;
import com.basicframework.framework.common.biz.system.oauth2.OAuth2TokenCommonApi;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.framework.security.config.BasicFrameworkSecurityAutoConfiguration;
import com.basicframework.framework.security.config.BasicFrameworkWebSecurityConfigurerAdapter;
import com.basicframework.framework.security.core.service.SecurityFrameworkService;
import com.basicframework.framework.security.core.service.SecurityFrameworkServiceImpl;
import com.basicframework.framework.web.config.WebProperties;
import com.basicframework.framework.web.core.handler.GlobalExceptionHandler;
import com.basicframework.framework.web.core.util.WebFrameworkUtils;
import com.basicframework.module.system.api.oauth2.OAuth2TokenApiImpl;
import com.basicframework.module.system.api.permission.PermissionApi;
import com.basicframework.module.system.api.permission.PermissionApiImpl;
import com.basicframework.module.system.api.sms.SmsCodeApi;
import com.basicframework.module.system.api.sms.SmsCodeApiImpl;
import com.basicframework.module.system.controller.admin.auth.AuthController;
import com.basicframework.module.system.controller.admin.oauth2.OAuth2UserController;
import com.basicframework.module.system.controller.admin.permission.RoleController;
import com.basicframework.module.system.controller.admin.user.UserProfileController;
import com.basicframework.module.system.controller.open.oauth2.OAuth2OpenController;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2ClientDO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2RefreshTokenDO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.dal.mysql.logger.LoginLogMapper;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2AccessTokenMapper;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2ClientMapper;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2RefreshTokenMapper;
import com.basicframework.module.system.dal.mysql.dept.UserPostMapper;
import com.basicframework.module.system.dal.mysql.permission.RoleMapper;
import com.basicframework.module.system.dal.mysql.permission.RoleMenuMapper;
import com.basicframework.module.system.dal.mysql.permission.UserRoleMapper;
import com.basicframework.module.system.dal.mysql.user.AdminUserMapper;
import com.basicframework.module.system.dal.redis.oauth2.OAuth2AccessTokenRedisDAO;
import com.basicframework.module.system.dal.redis.sms.SmsSendRedisDAO;
import com.basicframework.module.system.dal.redis.sms.SmsVerificationRedisDAO;
import com.basicframework.module.system.dal.mysql.sms.SmsCodeMapper;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.oauth2.OAuth2GrantTypeEnum;
import com.basicframework.module.system.enums.oauth2.OAuth2ClientConstants;
import com.basicframework.module.system.enums.oauth2.OAuth2MachineToken;
import com.basicframework.module.system.framework.auth.config.AdminAuthenticationProperties;
import com.basicframework.module.system.framework.security.config.SecurityConfiguration;
import com.basicframework.module.system.framework.sms.config.SmsCodeProperties;
import com.basicframework.module.system.service.auth.AdminAuthService;
import com.basicframework.module.system.service.auth.AdminAuthServiceImpl;
import com.basicframework.module.system.service.dept.DeptService;
import com.basicframework.module.system.service.dept.PostService;
import com.basicframework.module.system.service.logger.LoginLogService;
import com.basicframework.module.system.service.logger.LoginLogServiceImpl;
import com.basicframework.module.system.service.oauth2.OAuth2ClientService;
import com.basicframework.module.system.service.oauth2.OAuth2ClientServiceImpl;
import com.basicframework.module.system.service.oauth2.OAuth2GrantService;
import com.basicframework.module.system.service.oauth2.OAuth2GrantServiceImpl;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import com.basicframework.module.system.service.oauth2.OAuth2TokenServiceImpl;
import com.basicframework.module.system.service.permission.MenuService;
import com.basicframework.module.system.service.permission.PermissionService;
import com.basicframework.module.system.service.permission.PermissionServiceImpl;
import com.basicframework.module.system.service.permission.RoleService;
import com.basicframework.module.system.service.permission.RoleServiceImpl;
import com.basicframework.module.system.service.sms.SmsCodeService;
import com.basicframework.module.system.service.sms.SmsCodeServiceImpl;
import com.basicframework.module.system.service.sms.SmsSendService;
import com.basicframework.module.system.service.user.AdminUserService;
import com.basicframework.module.system.service.user.AdminUserServiceImpl;
import com.anji.captcha.service.CaptchaService;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Validator;
import jakarta.servlet.Filter;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.mybatis.spring.mapper.MapperFactoryBean;
import org.redisson.Redisson;
import org.redisson.api.RedissonClient;
import org.redisson.config.Config;
import org.redisson.spring.data.connection.RedissonConnectionFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.cache.concurrent.ConcurrentMapCacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.MapPropertySource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import org.springframework.web.servlet.config.annotation.PathMatchConfigurer;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 用独立 MySQL、真实 Mapper、生产 Spring Security 过滤链和生产 Controller 验证
 * OAuth2 client_credentials 机器主体（userId=0、userType=ADMIN）的真实越权边界。
 *
 * <p>机器主体不是管理端用户：system 模块不声明任何机器 API 面，安全链对 {@code /admin-api/**}
 * 统一执行真实用户判定，机器令牌一律按无权限拒绝。OAuth2 用户接口按认证上下文里的登录用户编号
 * 读取资料，机器主体的占位编号 0 在 system_users 中没有对应账号，放行只会让请求在控制器内对空用户
 * 解引用；该接口因此要求真实用户，并继续用 {@code @ss.hasScope('user.read')} 限定授权范围。
 * 本类断言“机器令牌在管理端入口返回 403”，而不是依赖数据权限或账号状态。</p>
 *
 * <p>边界：本上下文不装配生产数据权限拦截器。生产数据权限只为 {@code system_users} 与
 * {@code system_dept} 登记部门/用户列规则，约束的是真实用户的可见行范围，不能用它证明机器主体
 * 被拒绝；此处拒绝发生在认证与授权层，控制器与 Mapper 都不会被调用。</p>
 *
 * <p>显式执行本集成入口时必须注入环回测试 MySQL 与 Redis；缺失环境直接失败。
 * 数据库仅以随机 bf_machine_ 前缀创建和删除，不连接业务库。</p>
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class OAuth2MachinePrincipalHttpMySqlIT {

    /** 供静态 @Configuration 装配读取的环境资源。 */
    private static DataSource dataSource;
    private static OAuth2AccessTokenRedisDAO tokenCache;
    private static StringRedisTemplate redisTemplate;

    private final String schema = "bf_machine_" + UUID.randomUUID().toString().replace("-", "");

    private AnnotationConfigWebApplicationContext context;
    private RedissonClient redisClient;
    private MockMvc mvc;
    private JdbcTemplate jdbc;
    private AdminUserMapper userMapper;
    private OAuth2AccessTokenMapper accessMapper;
    private RoleMapper roleMapper;
    private PasswordEncoder encoder;
    private String adminUrl;
    private String databaseUser;
    private String databasePassword;
    private String clientId;
    private String clientSecret;
    private String defaultClientSecret;
    private String userPassword;
    private AdminUserDO user;
    private boolean schemaCreated;

    /** 建立独立库、真实安全链和真实 Controller，并复现生产 /admin-api 前缀规则。 */
    @BeforeAll
    void createEnvironment() throws Exception {
        adminUrl = requiredEnvironment("AUTH_TEST_MYSQL_URL");
        if (!adminUrl.matches("jdbc:mysql://(?:127\\.0\\.0\\.1|localhost):[0-9]+/(?:\\?.*)?")) {
            throw new IllegalArgumentException("AUTH_TEST_MYSQL_URL 必须是环回测试服务且不得包含数据库名");
        }
        databaseUser = requiredEnvironment("AUTH_TEST_MYSQL_USERNAME");
        databasePassword = requiredEnvironment("AUTH_TEST_MYSQL_PASSWORD");
        try (Connection connection = DriverManager.getConnection(adminUrl, databaseUser, databasePassword);
             Statement statement = connection.createStatement()) {
            statement.execute("CREATE DATABASE `" + schema + "` CHARACTER SET utf8mb4");
            schemaCreated = true;
        }
        String[] urlParts = adminUrl.split("\\?", 2);
        String url = urlParts[0] + schema + (urlParts.length == 2 ? "?" + urlParts[1] : "");
        dataSource = new DriverManagerDataSource(url, databaseUser, databasePassword);
        jdbc = new JdbcTemplate(dataSource);
        String ddl = Files.readString(findSchemaSource());
        for (String table : List.of("system_users", "system_oauth2_client", "system_oauth2_access_token",
                "system_oauth2_refresh_token", "system_login_log", "system_role", "system_user_role",
                "system_role_menu")) {
            Matcher matcher = Pattern.compile("CREATE TABLE `" + table + "`[\\s\\S]*?;").matcher(ddl);
            assertThat(matcher.find()).as("生产 DDL 中必须存在 %s", table).isTrue();
            jdbc.execute(matcher.group());
        }

        Config redis = new Config();
        redis.useSingleServer().setAddress("redis://127.0.0.1:"
                        + Integer.parseInt(requiredEnvironment("BF_TEST_REDIS_PORT")))
                .setPassword(requiredEnvironment("BF_TEST_REDIS_PASSWORD"))
                .setConnectionMinimumIdleSize(1).setConnectionPoolSize(4);
        redisClient = Redisson.create(redis);
        RedissonConnectionFactory redisConnection = new RedissonConnectionFactory(redisClient);
        redisConnection.afterPropertiesSet();
        redisTemplate = new StringRedisTemplate(redisConnection);
        redisTemplate.afterPropertiesSet();
        String pong = redisTemplate.execute(connection -> connection.ping(), true);
        assertThat(pong).isEqualTo("PONG");
        tokenCache = new OAuth2AccessTokenRedisDAO();
        ReflectionTestUtils.setField(tokenCache, "stringRedisTemplate", redisTemplate);

        context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("machine-auth",
                Map.of("basic-framework.captcha.enable", "false",
                        "basic-framework.web.admin-ui.url", "http://localhost:5175",
                        // 与 Spring Boot 默认一致：使用类代理，生产实现的 getSelf() 才能按具体类型自省。
                        "spring.aop.proxy-target-class", "true")));
        context.register(TransactionConfiguration.class, MvcConfiguration.class, WebSecurityTestConfiguration.class,
                ClassProxyingConfiguration.class,
                BasicFrameworkSecurityAutoConfiguration.class, BasicFrameworkWebSecurityConfigurerAdapter.class,
                SecurityConfiguration.class,
                DataLayerConfiguration.class, ServiceLayerConfiguration.class, WebLayerConfiguration.class,
                ControllerLayerConfiguration.class);
        context.refresh();

        userMapper = context.getBean(AdminUserMapper.class);
        accessMapper = context.getBean(OAuth2AccessTokenMapper.class);
        roleMapper = context.getBean(RoleMapper.class);
        encoder = context.getBean(PasswordEncoder.class);

        // springSecurityFilterChain 是生产 FilterChainProxy，对每个请求执行真实授权判定。
        Filter securityFilterChain = context.getBean("springSecurityFilterChain", Filter.class);
        mvc = MockMvcBuilders.webAppContextSetup(context).addFilters(securityFilterChain).build();
    }

    /** 每例使用随机客户端、账号、角色和口令，隔离用例之间的令牌与数据。 */
    @BeforeEach
    void resetFixture() {
        for (String table : List.of("system_oauth2_access_token", "system_oauth2_refresh_token",
                "system_oauth2_client", "system_login_log", "system_role", "system_user_role", "system_users")) {
            jdbc.update("DELETE FROM " + table);
        }
        String random = UUID.randomUUID().toString().replace("-", "");
        clientId = "machineclient" + random.substring(0, 12);
        clientSecret = UUID.randomUUID().toString();
        OAuth2ClientDO client = new OAuth2ClientDO();
        client.setClientId(clientId);
        client.setSecret(encoder.encode(clientSecret));
        client.setName("机器主体测试客户端");
        client.setLogo("");
        client.setStatus(CommonStatusEnum.ENABLE.getStatus());
        client.setAccessTokenValiditySeconds(600);
        client.setRefreshTokenValiditySeconds(1200);
        client.setRedirectUris(List.of("https://example.invalid/callback"));
        client.setAuthorizedGrantTypes(List.of(OAuth2GrantTypeEnum.CLIENT_CREDENTIALS.getGrantType()));
        client.setScopes(List.of("user.read"));
        OAuth2ClientMapper clientMapper = context.getBean(OAuth2ClientMapper.class);
        clientMapper.insert(client);
        // 生产初始化 SQL 内置 default 客户端，登录与刷新必须依赖它。
        OAuth2ClientDO defaultClient = new OAuth2ClientDO();
        defaultClient.setClientId(OAuth2ClientConstants.CLIENT_ID_DEFAULT);
        defaultClientSecret = UUID.randomUUID().toString();
        defaultClient.setSecret(encoder.encode(defaultClientSecret));
        defaultClient.setName("默认客户端");
        defaultClient.setLogo("");
        defaultClient.setStatus(CommonStatusEnum.ENABLE.getStatus());
        defaultClient.setAccessTokenValiditySeconds(1800);
        defaultClient.setRefreshTokenValiditySeconds(2592000);
        defaultClient.setRedirectUris(List.of("https://example.invalid/callback"));
        // 与生产种子一致：default 客户端不再拥有 client_credentials，真实用户登录与刷新仍可用。
        defaultClient.setAuthorizedGrantTypes(List.of(OAuth2GrantTypeEnum.PASSWORD.getGrantType(),
                OAuth2GrantTypeEnum.AUTHORIZATION_CODE.getGrantType(),
                OAuth2GrantTypeEnum.IMPLICIT.getGrantType(),
                OAuth2GrantTypeEnum.REFRESH_TOKEN.getGrantType()));
        defaultClient.setScopes(List.of("user.read"));
        clientMapper.insert(defaultClient);

        userPassword = UUID.randomUUID().toString();
        user = AdminUserDO.builder().username("machineuser" + random.substring(0, 12)).nickname("真实管理员")
                .userType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType())
                .status(CommonStatusEnum.ENABLE.getStatus())
                .password(encoder.encode(userPassword)).build();
        userMapper.insert(user);

        RoleDO role = new RoleDO();
        role.setName("机密角色" + random.substring(0, 6));
        role.setCode("secretrole" + random.substring(0, 6));
        role.setRoleType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        role.setSort(1);
        role.setStatus(CommonStatusEnum.ENABLE.getStatus());
        role.setType(2);
        roleMapper.insert(role);
    }

    /** 关闭上下文并删除随机库，异常路径同样不遗留测试资源。 */
    @AfterAll
    void closeEnvironment() throws Exception {
        try {
            if (context != null) {
                context.close();
            }
        } finally {
            try {
                if (redisClient != null) {
                    redisClient.shutdown();
                }
            } finally {
                if (schemaCreated) {
                    try (Connection connection = DriverManager.getConnection(adminUrl, databaseUser, databasePassword);
                         Statement statement = connection.createStatement()) {
                        statement.execute("DROP DATABASE `" + schema + "`");
                    }
                }
            }
        }
    }

    /** 缺少 client_id 时公开端点必须拒绝，不签发任何令牌。 */
    @Test
    void openTokenRejectsMissingClientId() throws Exception {
        JsonNode body = postToken(Map.of("grant_type", "client_credentials", "scope", "user.read"));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(400);
        assertThat(accessMapper.selectCount(null)).isZero();
    }

    /** 空白 client_secret 必须被拒绝，空密钥不构成凭据。 */
    @Test
    void openTokenRejectsBlankSecret() throws Exception {
        JsonNode body = postToken(Map.of("grant_type", "client_credentials", "client_id", clientId,
                "client_secret", "   ", "scope", "user.read"));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(400);
        assertThat(accessMapper.selectCount(null)).isZero();
    }

    /** 错误密钥必须被拒绝，不能签发机器令牌。 */
    @Test
    void openTokenRejectsWrongSecret() throws Exception {
        JsonNode body = postToken(Map.of("grant_type", "client_credentials", "client_id", clientId,
                "client_secret", UUID.randomUUID().toString(), "scope", "user.read"));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isNotEqualTo(0);
        assertThat(accessMapper.selectCount(null)).isZero();
    }

    /** 畸形 Basic 头不得被当作凭据，回落到表单参数并按缺失拒绝。 */
    @Test
    void openTokenRejectsMalformedBasicHeader() throws Exception {
        MockHttpServletRequestBuilder request = MockMvcRequestBuilders.post("/system/oauth2/token")
                .header("Authorization", "Basic not-a-valid-base64-credential")
                .param("grant_type", "client_credentials")
                .param("scope", "user.read");
        JsonNode body = readBody(mvc.perform(request).andExpect(status().isOk()).andReturn());
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isNotEqualTo(0);
        assertThat(accessMapper.selectCount(null)).isZero();
    }

    /** 正确 Basic 头与表单凭据等价，必须签发同一机器主体。 */
    @Test
    void openTokenAcceptsBasicHeader() throws Exception {
        String basic = java.util.Base64.getEncoder().encodeToString(
                (clientId + ":" + clientSecret).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        MockHttpServletRequestBuilder request = MockMvcRequestBuilders.post("/system/oauth2/token")
                .header("Authorization", "Basic " + basic)
                .param("grant_type", "client_credentials")
                .param("scope", "user.read");
        JsonNode body = readBody(mvc.perform(request).andExpect(status().isOk()).andReturn());
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(0);
        assertThat(accessMapper.selectByAccessToken(body.get("data").get("accessToken").asText()).getUserId())
                .isZero();
    }

    /** 非 client_credentials 授权类型必须被拒绝。 */
    @Test
    void openTokenRejectsOtherGrantType() throws Exception {
        JsonNode body = postToken(Map.of("grant_type", "password", "client_id", clientId,
                "client_secret", clientSecret, "scope", "user.read"));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(400);
        assertThat(accessMapper.selectCount(null)).isZero();
    }

    /**
     * 空白 scope 必须按参数错误拒绝，不能签发授权范围不明的机器令牌。
     *
     * <p>拆分后的范围集合是签发与后续鉴权的唯一依据：允许空范围会得到一张不绑定任何权限、
     * 却又真实有效的令牌，调用方拿到的是“凭据可用但权限语义未定义”的状态。</p>
     */
    @Test
    void openTokenRejectsBlankScope() throws Exception {
        JsonNode body = postToken(Map.of("grant_type", "client_credentials", "client_id", clientId,
                "client_secret", clientSecret, "scope", "   "));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(400);
        assertThat(accessMapper.selectCount(null)).isZero();
    }

    /** 超出客户端授权范围的 scope 必须被拒绝。 */
    @Test
    void openTokenRejectsScopeBeyondGrant() throws Exception {
        JsonNode body = postToken(Map.of("grant_type", "client_credentials", "client_id", clientId,
                "client_secret", clientSecret, "scope", "user.write"));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isNotEqualTo(0);
        assertThat(accessMapper.selectCount(null)).isZero();
    }

    /**
     * 正常签发的机器令牌必须是 userId=0，且不得获得任何可用的刷新令牌：
     * 占位主体没有可绑定的真实用户，签发刷新令牌会产生不受账号禁用约束的长期凭据。
     */
    @Test
    void openTokenIssuesMachinePrincipalWithoutRefreshToken() throws Exception {
        JsonNode body = postToken(Map.of("grant_type", "client_credentials", "client_id", clientId,
                "client_secret", clientSecret, "scope", "user.read"));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(0);
        OAuth2AccessTokenDO stored = accessMapper.selectByAccessToken(body.get("data").get("accessToken").asText());
        assertThat(stored).isNotNull();
        assertThat(stored.getUserId()).isZero();
        assertThat(stored.getUserType()).isEqualTo(UserTypeEnum.ADMIN.getValue());
        // 响应中不出现刷新令牌；数据库刷新表不得存在该机器主体的刷新会话。
        assertThat(body.get("data").get("refreshToken").isNull()).isTrue();
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM system_oauth2_refresh_token WHERE user_id = 0", Long.class)).isZero();
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM system_oauth2_refresh_token WHERE refresh_token = ?",
                Long.class, stored.getRefreshToken())).isZero();
    }

    /**
     * 核心验证：机器令牌访问只要求登录的后台读入口必须被按无权限拒绝，且不返回任何管理数据。
     *
     * <p>{@code /system/role/list-all-simple} 没有权限表达式，机器令牌曾以此为管理端用户读取真实
     * 角色数据。这里断言拒绝码、拒绝响应体不含数据，并说明拒绝来自认证授权层。</p>
     */
    @Test
    void machineTokenDeniedOnAuthenticatedOnlyAdminEndpoint() throws Exception {
        MvcResult result = mvc.perform(MockMvcRequestBuilders.get("/admin-api/system/role/list-all-simple")
                        .header("Authorization", "Bearer " + machineToken()))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode body = readBody(result);
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(403);
        assertThat(body.get("data")).as("拒绝响应不得携带角色数据，实际=%s", body).isNull();
    }

    /** 只要求登录的写入口必须同样对机器令牌拒绝，不能在控制器或服务层才失败。 */
    @Test
    void machineTokenDeniedOnAuthenticatedOnlyWriteEndpoint() throws Exception {
        MvcResult result = mvc.perform(MockMvcRequestBuilders.put("/admin-api/system/user/profile/update")
                        .header("Authorization", "Bearer " + machineToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(JsonUtils.toJsonString(Map.of("nickname", "机器主体写入"))))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode body = readBody(result);
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(403);
        assertThat(body.get("data")).as("拒绝响应不得携带数据，实际=%s", body).isNull();
    }

    /**
     * 核心验证：机器令牌用正确方法 GET 访问 OAuth2 用户接口必须被安全链按无权限拒绝。
     *
     * <p>该接口按认证上下文中的登录用户编号读取资料，机器主体占位编号 0 在 system_users 中没有
     * 对应记录；把它当作机器接口放行，请求会进入控制器并对空用户解引用，得到系统异常而不是用户资料。
     * 因此该路径必须要求真实用户：拒绝码为 403，响应体不携带任何用户字段。</p>
     */
    @Test
    void machineTokenDeniedOnOAuth2UserInfoEndpoint() throws Exception {
        MvcResult result = mvc.perform(MockMvcRequestBuilders.get("/admin-api/system/oauth2/user/get")
                        .header("Authorization", "Bearer " + machineToken()))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode body = readBody(result);
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(403);
        assertNoPayload(body);
    }

    /** 机器令牌不得靠其他 HTTP 方法绕过该路径的授权判定，未映射的方法同样在安全链被拒绝。 */
    @Test
    void machineTokenDeniedOnOAuth2UserInfoUnsupportedMethod() throws Exception {
        MvcResult machineResult = mvc.perform(MockMvcRequestBuilders.post("/admin-api/system/oauth2/user/get")
                        .header("Authorization", "Bearer " + machineToken()))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(readBody(machineResult).get("code").asInt())
                .as("机器主体在任何方法上都不得通过该路径，真实响应=%s", readBody(machineResult))
                .isEqualTo(403);

        // 伪造凭据必须仍在认证层被拒绝，说明上面的 403 不是“整条路径不可达”造成的。
        MvcResult forgedResult = mvc.perform(MockMvcRequestBuilders.post("/admin-api/system/oauth2/user/get")
                        .header("Authorization", "Bearer " + UUID.randomUUID().toString()))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(readBody(forgedResult).get("code").asInt())
                .as("无效凭据不得通过该路径，真实响应=%s", readBody(forgedResult))
                .isEqualTo(401);
    }

    /** 伪造凭据用正确方法访问该路径必须返回未授权，作为机器令牌 403 的对照。 */
    @Test
    void oauth2UserInfoEndpointRejectsForgedToken() throws Exception {
        MvcResult result = mvc.perform(MockMvcRequestBuilders.get("/admin-api/system/oauth2/user/get")
                        .header("Authorization", "Bearer " + UUID.randomUUID().toString()))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(readBody(result).get("code").asInt()).as("真实响应=%s", readBody(result)).isEqualTo(401);
    }

    /**
     * 正例：带 user.read 范围的真实用户令牌必须用真实 GET 读到自己的资料。
     *
     * <p>这是原缺陷真正缺失的验证：既有用例只用不存在的 POST 得到 405，从未执行 GET 业务分支。
     * 当前 HTTP 只开放 client_credentials 授权，带范围的用户令牌由生产授权服务签发，因此这里调用真实
     * {@code OAuth2GrantService#grantPassword} 走 password 授权取得令牌，再经过真实过滤链读取自己的
     * 编号、账号与昵称。</p>
     */
    @Test
    void realUserScopedTokenReadsOAuth2UserInfo() throws Exception {
        OAuth2AccessTokenDO issued = context.getBean(OAuth2GrantService.class).grantPassword(
                user.getUsername(), userPassword, OAuth2ClientConstants.CLIENT_ID_DEFAULT, List.of("user.read"));
        assertThat(issued.getUserId()).as("password 授权必须签发真实用户令牌").isEqualTo(user.getId());

        MvcResult result = mvc.perform(MockMvcRequestBuilders.get("/admin-api/system/oauth2/user/get")
                        .header("Authorization", "Bearer " + issued.getAccessToken()))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode body = readBody(result);
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isZero();
        assertThat(body.get("data").get("id").asLong()).isEqualTo(user.getId());
        assertThat(body.get("data").get("username").asText()).isEqualTo(user.getUsername());
        assertThat(body.get("data").get("nickname").asText()).isEqualTo("真实管理员");
    }

    /**
     * 授权范围仍是该接口的准入条件：管理端登录令牌没有 user.read 范围，必须同样按无权限拒绝。
     *
     * <p>修复机器面不能把接口放宽成“登录即可读”，否则第三方授权范围语义失效。</p>
     */
    @Test
    void realUserTokenWithoutScopeDeniedOnOAuth2UserInfoEndpoint() throws Exception {
        String accessToken = loginAsRealUser().get("data").get("accessToken").asText();
        MvcResult result = mvc.perform(MockMvcRequestBuilders.get("/admin-api/system/oauth2/user/get")
                        .header("Authorization", "Bearer " + accessToken))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode body = readBody(result);
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(403);
        assertNoPayload(body);
    }

    /** 真实用户令牌在该路径上使用错误方法仍按正常路由返回 405，说明路径对真实用户保持可达。 */
    @Test
    void realUserTokenReachesOAuth2UserInfoPath() throws Exception {
        String accessToken = loginAsRealUser().get("data").get("accessToken").asText();
        MvcResult result = mvc.perform(MockMvcRequestBuilders.post("/admin-api/system/oauth2/user/get")
                        .header("Authorization", "Bearer " + accessToken))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(readBody(result).get("code").asInt()).as("真实响应=%s", readBody(result)).isEqualTo(405);
    }

    /** 依赖真实用户的接口必须对机器主体拒绝，不能返回空数据后仍被视为已授权访问。 */
    @Test
    void machineTokenDeniedOnPermissionInfoEndpoint() throws Exception {
        MvcResult result = mvc.perform(MockMvcRequestBuilders.get("/admin-api/system/auth/get-permission-info")
                        .header("Authorization", "Bearer " + machineToken()))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode body = readBody(result);
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(403);
        assertThat(body.get("data")).as("拒绝响应不得携带数据，实际=%s", body).isNull();
    }

    /** 有 @PreAuthorize 权限要求的接口必须对机器主体拒绝。 */
    @Test
    void machineTokenDeniedOnPreAuthorizeEndpoint() throws Exception {
        MvcResult result = mvc.perform(MockMvcRequestBuilders.get("/admin-api/system/role/page")
                        .header("Authorization", "Bearer " + machineToken())
                        .param("pageNo", "1").param("pageSize", "10"))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(readBody(result).get("code").asInt()).as("真实响应=%s", readBody(result)).isEqualTo(403);
    }

    /** 无令牌访问受保护后台接口必须返回未授权，说明机器令牌的拒绝不是因为链路失效。 */
    @Test
    void protectedEndpointRejectsAnonymous() throws Exception {
        MvcResult result = mvc.perform(MockMvcRequestBuilders.get("/admin-api/system/role/list-all-simple"))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(readBody(result).get("code").asInt()).as("真实响应=%s", readBody(result)).isEqualTo(401);
    }

    /** 伪造令牌不得通过令牌校验。 */
    @Test
    void protectedEndpointRejectsForgedToken() throws Exception {
        MvcResult result = mvc.perform(MockMvcRequestBuilders.get("/admin-api/system/role/list-all-simple")
                        .header("Authorization", "Bearer " + UUID.randomUUID().toString()))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(readBody(result).get("code").asInt()).as("真实响应=%s", readBody(result)).isEqualTo(401);
    }

    /**
     * 机器主体的隔离与真实账号状态无关：真实用户被禁用前后，机器令牌在管理读入口都必须被拒绝。
     *
     * <p>占位主体没有可禁用的账号行，因此不能靠账号状态或会话撤销兜底；这里用禁用真实用户作为对照，
     * 证明拒绝来自主体类型判定而不是某次账号校验的副作用。</p>
     */
    @Test
    void machineTokenDeniedRegardlessOfRealUserStatus() throws Exception {
        String token = machineToken();
        userMapper.updateById(AdminUserDO.builder().id(user.getId())
                .status(CommonStatusEnum.DISABLE.getStatus()).build());
        MvcResult result = mvc.perform(MockMvcRequestBuilders.get("/admin-api/system/role/list-all-simple")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode body = readBody(result);
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(403);
        assertThat(body.get("data")).as("拒绝响应不得携带数据，实际=%s", body).isNull();
    }

    /** 用未过期且客户端匹配的旧版零号刷新会话验证机器守卫，避免客户端错配造成假通过。 */
    @Test
    void legacyDefaultMachineRefreshTokenRejected() throws Exception {
        OAuth2AccessTokenDO legacy = legacyDefaultRefreshSession(0L, UUID.randomUUID().toString().replace("-", ""));
        assertRejectedRefreshPreservesSession(legacy, "机器主体不支持刷新令牌");
    }

    /** 机器边界为所有非正数；负数旧会话同样不能通过匿名 default 刷新入口续期。 */
    @Test
    void legacyNegativeDefaultMachineRefreshTokenRejected() throws Exception {
        OAuth2AccessTokenDO legacy = legacyDefaultRefreshSession(-1L, UUID.randomUUID().toString().replace("-", ""));
        assertRejectedRefreshPreservesSession(legacy, "机器主体不支持刷新令牌");
    }

    /** 用正数启用账号构造哨兵同值的历史脏记录，证明哨兵拒绝独立于机器主体和客户端校验。 */
    @Test
    void machineSentinelRejectedEvenWithRealUserRefreshRow() throws Exception {
        OAuth2AccessTokenDO legacy = legacyDefaultRefreshSession(user.getId(),
                OAuth2MachineToken.MACHINE_NO_REFRESH_TOKEN);
        assertRejectedRefreshPreservesSession(legacy, "无效的刷新令牌");
    }

    /**
     * 两枚机器令牌共享哨兵；真实退出只撤销目标令牌，另一枚必须仍被识别为有效机器主体。
     *
     * <p>用管理读入口的两种拒绝码区分凭据状态：403 表示凭据有效但主体是机器（被隔离），
     * 401 表示凭据已失效。这样既不读取任何管理数据，也不依赖机器主体可用的业务接口。</p>
     */
    @Test
    void revokingOneMachineTokenPreservesOtherToken() throws Exception {
        String revoked = machineToken();
        String retained = machineToken();
        assertThat(revoked.equals(retained)).as("两次签发必须得到不同的访问凭据").isFalse();
        assertThat(accessMapper.selectByAccessToken(revoked).getRefreshToken())
                .isEqualTo(OAuth2MachineToken.MACHINE_NO_REFRESH_TOKEN);
        assertThat(accessMapper.selectByAccessToken(retained).getRefreshToken())
                .isEqualTo(OAuth2MachineToken.MACHINE_NO_REFRESH_TOKEN);

        // 先证明两枚凭据都能通过令牌校验，避免把原本无效的令牌误当成撤销成功。
        assertThat(machinePrincipalStatus(revoked)).as("第一枚令牌必须是有效机器主体").isEqualTo(403);
        assertThat(machinePrincipalStatus(retained)).as("第二枚令牌必须是有效机器主体").isEqualTo(403);

        MvcResult logout = mvc.perform(MockMvcRequestBuilders.post("/admin-api/system/auth/logout")
                        .header("Authorization", "Bearer " + revoked))
                .andExpect(status().isOk()).andReturn();
        assertThat(readBody(logout).get("code").asInt()).isZero();
        assertThat(machinePrincipalStatus(revoked)).as("已登出的机器令牌必须按未授权处理").isEqualTo(401);
        assertThat(machinePrincipalStatus(retained)).as("另一枚机器会话必须保持有效").isEqualTo(403);
        assertThat(accessMapper.selectByAccessToken(revoked)).isNull();
        assertThat(accessMapper.selectByAccessToken(retained)).isNotNull();
        assertThat(accessMapper.selectCount(null)).isEqualTo(1L);
        assertThat(context.getBean(OAuth2RefreshTokenMapper.class).selectCount(null)).isZero();
    }

    /**
     * default 客户端已收回 client_credentials，用它申请机器令牌必须被拒绝且不签发任何令牌。
     */
    @Test
    void defaultClientRejectsClientCredentialsGrant() throws Exception {
        JsonNode body = postToken(Map.of("grant_type", "client_credentials",
                "client_id", OAuth2ClientConstants.CLIENT_ID_DEFAULT,
                "client_secret", defaultClientSecret, "scope", "user.read"));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isNotEqualTo(0);
        assertThat(accessMapper.selectCount(null)).isZero();
    }

    /**
     * 收回 default 客户端的机器主体授权不影响其他客户端继续使用 client_credentials。
     */
    @Test
    void otherClientKeepsClientCredentialsGrant() throws Exception {
        JsonNode body = postToken(Map.of("grant_type", "client_credentials", "client_id", clientId,
                "client_secret", clientSecret, "scope", "user.read"));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(0);
        assertThat(accessMapper.selectByAccessToken(body.get("data").get("accessToken").asText()).getUserId())
                .isZero();
    }

    /** 正例：真实用户登录并刷新令牌必须继续成功。 */
    @Test
    void realUserLoginAndRefreshStillSucceed() throws Exception {
        JsonNode loginBody = loginAsRealUser();
        String accessToken = loginBody.get("data").get("accessToken").asText();
        String refreshToken = loginBody.get("data").get("refreshToken").asText();
        assertThat(accessMapper.selectByAccessToken(accessToken).getUserId()).isEqualTo(user.getId());

        // 真实令牌同样可以通过只要求登录的后台接口。
        MvcResult list = mvc.perform(MockMvcRequestBuilders.get("/admin-api/system/role/list-all-simple")
                        .header("Authorization", "Bearer " + accessToken))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(readBody(list).get("code").asInt()).as("真实响应=%s", readBody(list)).isEqualTo(0);

        MvcResult refreshed = mvc.perform(MockMvcRequestBuilders.post("/admin-api/system/auth/refresh-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(JsonUtils.toJsonString(Map.of("refreshToken", refreshToken))))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode refreshedBody = readBody(refreshed);
        assertThat(refreshedBody.get("code").asInt()).isEqualTo(0);
        assertThat(accessMapper.selectByAccessToken(refreshedBody.get("data").get("accessToken").asText()).getUserId())
                .isEqualTo(user.getId());
    }

    /** 真实用户被禁用后其令牌必须立即失效，作为机器令牌行为的对照。 */
    @Test
    void realUserTokenInvalidatedAfterDisablingUser() throws Exception {
        String accessToken = loginAsRealUser().get("data").get("accessToken").asText();
        userMapper.updateById(AdminUserDO.builder().id(user.getId())
                .status(CommonStatusEnum.DISABLE.getStatus()).build());
        MvcResult result = mvc.perform(MockMvcRequestBuilders.get("/admin-api/system/role/list-all-simple")
                        .header("Authorization", "Bearer " + accessToken))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(readBody(result).get("code").asInt()).as("真实响应=%s", readBody(result)).isEqualTo(401);
    }

    /**
     * 模拟升级前或历史脏数据的 default 刷新会话，绕过当前签发守卫以保护存量凭据边界。
     *
     * @param userId 会话主体，零和负数表示机器，正数用于隔离哨兵校验
     * @param refreshToken 指定刷新凭据，允许机器哨兵以模拟历史同值记录
     * @return 与未过期刷新记录关联的已落库访问令牌
     */
    private OAuth2AccessTokenDO legacyDefaultRefreshSession(Long userId, String refreshToken) {
        OAuth2RefreshTokenDO refresh = new OAuth2RefreshTokenDO();
        refresh.setRefreshToken(refreshToken);
        refresh.setUserId(userId);
        refresh.setUserType(UserTypeEnum.ADMIN.getValue());
        refresh.setClientId(OAuth2ClientConstants.CLIENT_ID_DEFAULT);
        refresh.setScopes(List.of("user.read"));
        refresh.setExpiresTime(LocalDateTime.now().plusHours(1));
        context.getBean(OAuth2RefreshTokenMapper.class).insert(refresh);
        OAuth2AccessTokenDO access = new OAuth2AccessTokenDO();
        access.setAccessToken(UUID.randomUUID().toString().replace("-", ""));
        access.setUserId(userId);
        access.setUserType(UserTypeEnum.ADMIN.getValue());
        access.setUserInfo(Map.of());
        access.setClientId(OAuth2ClientConstants.CLIENT_ID_DEFAULT);
        access.setScopes(refresh.getScopes());
        access.setRefreshToken(refreshToken);
        access.setExpiresTime(LocalDateTime.now().plusMinutes(10));
        accessMapper.insert(access);
        return access;
    }

    /**
     * 匿名调用固定 default 的刷新接口，断言按目标原因拒绝且原访问与刷新会话均未被改写。
     *
     * @param legacy 真实落库的旧访问会话，其刷新记录必须客户端匹配且未过期
     * @param message 预期拒绝原因，用于排除客户端错配等假阳性
     * @throws Exception HTTP 测试执行或响应解析失败时抛出
     */
    private void assertRejectedRefreshPreservesSession(OAuth2AccessTokenDO legacy, String message) throws Exception {
        OAuth2RefreshTokenMapper refreshMapper = context.getBean(OAuth2RefreshTokenMapper.class);
        OAuth2RefreshTokenDO refresh = refreshMapper.selectByRefreshToken(legacy.getRefreshToken());
        assertThat(refresh.getUserId()).isEqualTo(legacy.getUserId());
        assertThat(refresh.getUserType()).isEqualTo(UserTypeEnum.ADMIN.getValue());
        assertThat(refresh.getClientId()).isEqualTo(OAuth2ClientConstants.CLIENT_ID_DEFAULT);
        assertThat(refresh.getExpiresTime()).isAfter(LocalDateTime.now());
        MvcResult result = mvc.perform(MockMvcRequestBuilders.post("/admin-api/system/auth/refresh-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(JsonUtils.toJsonString(Map.of("refreshToken", legacy.getRefreshToken()))))
                .andExpect(status().isOk()).andReturn();
        JsonNode body = readBody(result);
        assertThat(body.get("code").asInt()).isEqualTo(400);
        assertThat(body.get("msg").asText()).isEqualTo(message);
        assertThat(accessMapper.selectByAccessToken(legacy.getAccessToken())).isNotNull();
        assertThat(accessMapper.selectCount(null)).isEqualTo(1L);
        assertThat(refreshMapper.selectByRefreshToken(legacy.getRefreshToken())).isNotNull();
        assertThat(refreshMapper.selectCount(null)).isEqualTo(1L);
    }

    /** 通过公开端点取得一个机器令牌，用例之间不共享令牌值。 */
    private String machineToken() throws Exception {
        JsonNode body = postToken(Map.of("grant_type", "client_credentials", "client_id", clientId,
                "client_secret", clientSecret, "scope", "user.read"));
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(0);
        return body.get("data").get("accessToken").asText();
    }

    /**
     * 读取管理读入口对指定令牌返回的业务码，用于区分凭据状态。
     *
     * <p>401 表示令牌不存在或已失效；403 表示令牌有效但主体是机器，被安全链按无权限隔离。
     * 该入口本身没有权限表达式，因此这里的 403 只能来自主体类型判定。</p>
     *
     * @param token 待探测的访问令牌
     * @return 真实响应中的业务码
     * @throws Exception HTTP 测试执行或响应解析失败时抛出
     */
    private int machinePrincipalStatus(String token) throws Exception {
        MvcResult result = mvc.perform(MockMvcRequestBuilders.get("/admin-api/system/role/list-all-simple")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        return readBody(result).get("code").asInt();
    }

    /** 通过公开登录接口取得真实用户令牌。 */
    private JsonNode loginAsRealUser() throws Exception {
        MvcResult result = mvc.perform(MockMvcRequestBuilders.post("/admin-api/system/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(JsonUtils.toJsonString(Map.of("username", user.getUsername(), "password", userPassword))))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode body = readBody(result);
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isEqualTo(0);
        return body;
    }

    /** 以表单参数调用公开令牌端点，返回真实响应体。 */
    private JsonNode postToken(Map<String, String> params) throws Exception {
        MockHttpServletRequestBuilder request = MockMvcRequestBuilders.post("/system/oauth2/token");
        params.forEach(request::param);
        return readBody(mvc.perform(request).andExpect(status().isOk()).andReturn());
    }

    /** 解析真实响应体，避免断言依赖日志输出。 */
    private static JsonNode readBody(MvcResult result) throws Exception {
        return JsonUtils.parseObject(result.getResponse().getContentAsString(), JsonNode.class);
    }

    /**
     * 断言拒绝响应不携带任何数据载荷。
     *
     * <p>安全链拒绝由 {@code ServletUtils} 直写响应体，序列化省略 {@code data} 字段；
     * 方法级 {@code @PreAuthorize} 拒绝经全局异常处理器与 MVC 消息转换器返回，序列化为显式
     * {@code null}。两种形态都不得携带数据，因此这里同时接受字段缺失与显式 null，只拒绝有值载荷。</p>
     *
     * @param body 真实响应体
     */
    private static void assertNoPayload(JsonNode body) {
        JsonNode data = body.get("data");
        assertThat(data == null || data.isNull()).as("拒绝响应不得携带数据，实际=%s", body).isTrue();
    }

    /** 保留生产事务代理，令牌签发与校验走真实数据库。 */
    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement
    static class TransactionConfiguration {

        /** 真实事务管理器，令牌签发与撤销的 @Transactional 生效。 */
        @Bean
        PlatformTransactionManager platformTransactionManager() {
            return new DataSourceTransactionManager(dataSource);
        }

        /** 使用实际 MyBatis Plus 和填充器生成 Mapper SQL，不用内存替身模拟。 */
        @Bean
        SqlSessionFactory sqlSessionFactory() {
            try {
                MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
                factory.setDataSource(dataSource);
                MybatisConfiguration configuration = new MybatisConfiguration();
                configuration.setMapUnderscoreToCamelCase(true);
                factory.setConfiguration(configuration);
                GlobalConfig config = new GlobalConfig();
                config.setDbConfig(new GlobalConfig.DbConfig().setIdType(IdType.AUTO));
                config.setMetaObjectHandler(new DefaultDBFieldHandler());
                factory.setGlobalConfig(config);
                return factory.getObject();
            } catch (Exception exception) {
                throw new IllegalStateException("测试 Mapper 初始化失败", exception);
            }
        }
    }

    /** 复现生产 WebMvc 装配：只有 controller.admin 下的 RestController 带 /admin-api 前缀。 */
    @Configuration(proxyBeanMethods = false)
    @EnableWebMvc
    static class MvcConfiguration implements WebMvcConfigurer {

        /** 与 BasicFrameworkWebAutoConfiguration 一致地声明管理后台前缀。 */
        @Override
        public void configurePathMatch(PathMatchConfigurer configurer) {
            AntPathMatcher matcher = new AntPathMatcher(".");
            configurer.addPathPrefix("/admin-api",
                    clazz -> clazz.isAnnotationPresent(RestController.class)
                            && matcher.match("**.controller.admin.**", clazz.getPackage().getName()));
        }
    }

    /** 补齐 Spring Boot WebSecurity 自动配置在生产中提供的开关。 */
    @Configuration(proxyBeanMethods = false)
    @EnableWebSecurity
    static class WebSecurityTestConfiguration {
    }

    /**
     * Spring Boot 默认 proxy-target-class=true；装配切片里没有 Boot 自动配置，
     * 这里显式恢复类代理，否则 PermissionServiceImpl 会被 JDK 代理，
     * 生产实现的 getSelf() 将无法按具体类型自省。
     */
    @Configuration(proxyBeanMethods = false)
    static class ClassProxyingConfiguration {

        /** 强制自动代理器使用类代理。 */
        @Bean
        static org.springframework.beans.factory.config.BeanFactoryPostProcessor classProxyingEnforcer() {
            return (org.springframework.beans.factory.config.BeanFactoryPostProcessor) beanFactory ->
                    org.springframework.aop.config.AopConfigUtils.forceAutoProxyCreatorToUseClassProxying(
                            (org.springframework.beans.factory.support.BeanDefinitionRegistry) beanFactory);
        }
    }

    /** 装配真实生产 Mapper，令牌、角色、权限查询全部落到真实 MySQL。 */
    @Configuration(proxyBeanMethods = false)
    static class DataLayerConfiguration {

        /** 为指定生产 Mapper 创建真实代理。 */
        private static <T> T mapper(SqlSessionFactory factory, Class<T> type) {
            try {
                MapperFactoryBean<T> beanFactory = new MapperFactoryBean<>(type);
                beanFactory.setSqlSessionFactory(factory);
                beanFactory.afterPropertiesSet();
                return beanFactory.getObject();
            } catch (Exception exception) {
                throw new IllegalStateException("测试 Mapper 创建失败", exception);
            }
        }

        /** 用户 Mapper。 */
        @Bean
        AdminUserMapper adminUserMapper(SqlSessionFactory factory) {
            return mapper(factory, AdminUserMapper.class);
        }

        /** 访问令牌 Mapper。 */
        @Bean
        OAuth2AccessTokenMapper oauth2AccessTokenMapper(SqlSessionFactory factory) {
            return mapper(factory, OAuth2AccessTokenMapper.class);
        }

        /** 刷新令牌 Mapper。 */
        @Bean
        OAuth2RefreshTokenMapper oauth2RefreshTokenMapper(SqlSessionFactory factory) {
            return mapper(factory, OAuth2RefreshTokenMapper.class);
        }

        /** OAuth2 客户端 Mapper。 */
        @Bean
        OAuth2ClientMapper oauth2ClientMapper(SqlSessionFactory factory) {
            return mapper(factory, OAuth2ClientMapper.class);
        }

        /** 登录日志 Mapper。 */
        @Bean
        LoginLogMapper loginLogMapper(SqlSessionFactory factory) {
            return mapper(factory, LoginLogMapper.class);
        }

        /** 角色 Mapper。 */
        @Bean
        RoleMapper roleMapper(SqlSessionFactory factory) {
            return mapper(factory, RoleMapper.class);
        }

        /** 用户角色关联 Mapper。 */
        @Bean
        UserRoleMapper userRoleMapper(SqlSessionFactory factory) {
            return mapper(factory, UserRoleMapper.class);
        }

        /** 角色菜单关联 Mapper。 */
        @Bean
        RoleMenuMapper roleMenuMapper(SqlSessionFactory factory) {
            return mapper(factory, RoleMenuMapper.class);
        }

        /** 短信验证码 Mapper 只用于满足装配，不参与本组断言。 */
        @Bean
        SmsCodeMapper smsCodeMapper() {
            return mock(SmsCodeMapper.class);
        }

        /** 用户岗位关联 Mapper 只用于满足装配，不参与本组断言。 */
        @Bean
        UserPostMapper userPostMapper() {
            return mock(UserPostMapper.class);
        }
    }

    /** 装配生产 Service，令牌签发、校验、权限判定保持真实实现。 */
    @Configuration(proxyBeanMethods = false)
    static class ServiceLayerConfiguration {


        /** hutool 上下文持有者，供生产实现的 getSelf() 解析自身代理。 */
        @Bean
        SpringUtil springUtil() {
            return new SpringUtil();
        }

        /** 生产客户端缓存管理器；本组不启用缓存注解，客户端配置直接读库。 */
        @Bean
        ConcurrentMapCacheManager cacheManager() {
            return new ConcurrentMapCacheManager();
        }

        /** 配置中心替身，避免装配时回退共享凭据。 */
        @Bean
        ConfigApi configApi() {
            return mock(ConfigApi.class);
        }

        /** 认证参数。 */
        @Bean
        AdminAuthenticationProperties adminAuthenticationProperties() {
            return new AdminAuthenticationProperties();
        }

        /** 短信参数；补齐必填项，避免属性绑定校验在装配期失败。 */
        @Bean
        SmsCodeProperties smsCodeProperties() {
            SmsCodeProperties properties = new SmsCodeProperties();
            properties.setExpireTimes(java.time.Duration.ofMinutes(10));
            properties.setSendFrequency(java.time.Duration.ofMinutes(1));
            properties.setSendMaximumQuantityPerDay(10);
            return properties;
        }

        /** 令牌缓存访问真实 Redis。 */
        @Bean
        OAuth2AccessTokenRedisDAO oauth2AccessTokenRedisDAO() {
            return tokenCache;
        }

        /** Redis 模板，连接隔离测试实例。 */
        @Bean
        StringRedisTemplate stringRedisTemplate() {
            return redisTemplate;
        }

        /** 部门服务只作为装配依赖，不参与本组断言。 */
        @Bean
        DeptService deptService() {
            return mock(DeptService.class);
        }

        /** 岗位服务只作为装配依赖，不参与本组断言。 */
        @Bean
        PostService postService() {
            return mock(PostService.class);
        }

        /** 菜单服务只作为装配依赖，不参与本组断言。 */
        @Bean
        MenuService menuService() {
            return mock(MenuService.class);
        }

        /** 短信发送只作为装配依赖，不参与本组断言。 */
        @Bean
        SmsSendService smsSendService() {
            return mock(SmsSendService.class);
        }

        /** 验证码服务在本组关闭校验，只为满足生产实现的装配依赖。 */
        @Bean
        CaptchaService captchaService() {
            return mock(CaptchaService.class);
        }

        /** 短信限流 DAO 只作为装配依赖，不参与本组断言。 */
        @Bean
        SmsVerificationRedisDAO smsVerificationRedisDAO() {
            return mock(SmsVerificationRedisDAO.class);
        }

        /** 短信发送限流 DAO 只作为装配依赖，不参与本组断言。 */
        @Bean
        SmsSendRedisDAO smsSendRedisDAO() {
            return mock(SmsSendRedisDAO.class);
        }

        /** 真实 OAuth2 客户端校验，负责密钥、授权方式和 scope 判定。 */
        @Bean
        OAuth2ClientServiceImpl oauth2ClientService(OAuth2ClientMapper mapper, PasswordEncoder passwordEncoder,
                                                ConcurrentMapCacheManager cacheManager) {
            OAuth2ClientServiceImpl service = new OAuth2ClientServiceImpl();
            wire(service, "oauth2ClientMapper", mapper);
            wire(service, "passwordEncoder", passwordEncoder);
            return wire(service, "cacheManager", cacheManager);
        }

        /** 真实用户服务，保留对权限和令牌服务的延迟依赖。 */
        @Bean
        AdminUserService adminUserService(AdminUserMapper mapper, PasswordEncoder passwordEncoder,
                                          ConfigApi configApi, DeptService deptService, PostService postService,
                                          AdminAuthenticationProperties properties,
                                          ObjectProvider<PermissionService> permissionService,
                                          ObjectProvider<OAuth2TokenService> tokenService) {
            AdminUserServiceImpl service = new AdminUserServiceImpl();
            wire(service, "userMapper", mapper);
            wire(service, "passwordEncoder", passwordEncoder);
            wire(service, "configApi", configApi);
            wire(service, "deptService", deptService);
            wire(service, "postService", postService);
            wire(service, "authenticationProperties", properties);
            wire(service, "permissionServiceProvider", permissionService);
            return wire(service, "oauth2TokenServiceProvider", tokenService);
        }

        /** 真实角色服务。 */
        @Bean
        RoleServiceImpl roleService(RoleMapper mapper, UserRoleMapper userRoleMapper,
                                ObjectProvider<PermissionService> permissionService) {
            RoleServiceImpl service = new RoleServiceImpl();
            wire(service, "roleMapper", mapper);
            wire(service, "userRoleMapper", userRoleMapper);
            return wire(service, "permissionServiceProvider", permissionService);
        }

        /** 真实权限服务，hasAnyPermissions 的角色来源是真实数据库。 */
        @Bean
        PermissionServiceImpl permissionService(RoleMenuMapper roleMenuMapper, UserRoleMapper userRoleMapper,
                                            RoleService roleService, MenuService menuService,
                                            DeptService deptService, AdminUserService userService) {
            PermissionServiceImpl service = new PermissionServiceImpl();
            wire(service, "roleMenuMapper", roleMenuMapper);
            wire(service, "userRoleMapper", userRoleMapper);
            wire(service, "roleService", roleService);
            wire(service, "menuService", menuService);
            wire(service, "deptService", deptService);
            return wire(service, "userService", userService);
        }

        /** 真实令牌服务，签发与校验都落真实 MySQL。 */
        @Bean
        OAuth2TokenService oauth2TokenService(AdminUserMapper adminUserMapper, AdminUserService adminUserService,
                                              OAuth2AccessTokenMapper accessMapper, OAuth2RefreshTokenMapper refreshMapper,
                                              OAuth2AccessTokenRedisDAO cache, OAuth2ClientService clientService) {
            OAuth2TokenServiceImpl service = new OAuth2TokenServiceImpl();
            wire(service, "adminUserMapper", adminUserMapper);
            wire(service, "adminUserService", adminUserService);
            wire(service, "oauth2AccessTokenMapper", accessMapper);
            wire(service, "oauth2RefreshTokenMapper", refreshMapper);
            wire(service, "oauth2AccessTokenRedisDAO", cache);
            return wire(service, "oauth2ClientService", clientService);
        }

        /** 真实短信服务，仅用于登录装配。 */
        @Bean
        SmsCodeService smsCodeService(SmsCodeProperties properties, SmsCodeMapper mapper,
                                      SmsSendService sendService, SmsSendRedisDAO sendRedisDAO,
                                      SmsVerificationRedisDAO verificationRedisDAO) {
            SmsCodeServiceImpl service = new SmsCodeServiceImpl();
            wire(service, "smsCodeProperties", properties);
            wire(service, "smsCodeMapper", mapper);
            wire(service, "smsSendService", sendService);
            wire(service, "smsSendRedisDAO", sendRedisDAO);
            return wire(service, "smsVerificationRedisDAO", verificationRedisDAO);
        }

        /** 真实短信 API。 */
        @Bean
        SmsCodeApi smsCodeApi(SmsCodeService service) {
            return wire(new SmsCodeApiImpl(), "smsCodeService", service);
        }

        /** 真实登录日志服务。 */
        @Bean
        LoginLogService loginLogService(LoginLogMapper mapper) {
            return wire(new LoginLogServiceImpl(), "loginLogMapper", mapper);
        }

        /** 真实后台认证服务，登录与刷新走生产实现。 */
        @Bean
        AdminAuthService adminAuthService(AdminUserService userService, OAuth2TokenService tokenService,
                                          LoginLogService loginLogService, SmsCodeApi smsCodeApi,
                                          AdminAuthenticationProperties properties, Validator validator,
                                          CaptchaService captchaService) {
            AdminAuthServiceImpl service = new AdminAuthServiceImpl();
            wire(service, "validator", validator);
            wire(service, "captchaService", captchaService);
            wire(service, "userService", userService);
            wire(service, "oauth2TokenService", tokenService);
            wire(service, "loginLogService", loginLogService);
            wire(service, "smsCodeApi", smsCodeApi);
            wire(service, "authenticationProperties", properties);
            return wire(service, "captchaEnable", false);
        }

        /** 真实授权服务，client_credentials 由此签发机器主体。 */
        @Bean
        OAuth2GrantService oauth2GrantService(AdminAuthService authService, OAuth2TokenService tokenService) {
            OAuth2GrantServiceImpl service = new OAuth2GrantServiceImpl();
            wire(service, "adminAuthService", authService);
            return wire(service, "oauth2TokenService", tokenService);
        }

        /** 真实权限 API，供 @PreAuthorize 的 ss Bean 调用。 */
        @Bean
        PermissionApi permissionApi(PermissionService permissionService) {
            return wire(new PermissionApiImpl(), "permissionService", permissionService);
        }

        /** 真实令牌 API，供 TokenAuthenticationFilter 校验令牌。 */
        @Bean
        OAuth2TokenCommonApi oauth2TokenCommonApi(OAuth2TokenService tokenService) {
            return wire(new OAuth2TokenApiImpl(), "oauth2TokenService", tokenService);
        }
    }

    /** 装配真实 Web 与安全链组件，TokenAuthenticationFilter 走生产自动配置。 */
    @Configuration(proxyBeanMethods = false)
    static class WebLayerConfiguration {

        /** 生产 Web 前缀配置，驱动用户类型识别和 /admin-api 路径前缀。 */
        @Bean
        WebProperties webProperties() {
            return new WebProperties();
        }

        /** 初始化静态请求工具持有的前缀配置。 */
        @Bean
        WebFrameworkUtils webFrameworkUtils(WebProperties properties) {
            return new WebFrameworkUtils(properties);
        }

        /** 生产全局异常处理，错误响应体与生产一致。 */
        @Bean
        GlobalExceptionHandler globalExceptionHandler() {
            return new GlobalExceptionHandler("machine-auth-test", mock(ApiErrorLogCommonApi.class));
        }

        /** 真实 JSR-303 校验器，供登录入参校验使用。 */
        @Bean
        Validator validator() {
            LocalValidatorFactoryBean factory = new LocalValidatorFactoryBean();
            factory.afterPropertiesSet();
            return factory;
        }

        /**
         * 显式声明 ss Bean，行为与生产 SecurityFrameworkServiceImpl 一致。
         *
         * <p>机器 API 面的放行规则由生产 {@code SecurityConfiguration} 提供，这里不再放置任何替身，
         * 保证测试断言的就是生产装配。</p>
         */
        @Bean("ss")
        SecurityFrameworkService securityFrameworkService(PermissionApi permissionApi) {
            return new SecurityFrameworkServiceImpl(permissionApi);
        }
    }

    /** 装配生产 Controller，服务依赖以真实实现注入。 */
    @Configuration(proxyBeanMethods = false)
    static class ControllerLayerConfiguration {

        /** 公开令牌端点，位于 controller.open 包，按生产规则不加 /admin-api 前缀。 */
        @Bean
        OAuth2OpenController oauth2OpenController(OAuth2ClientService clientService, OAuth2GrantService grantService) {
            OAuth2OpenController controller = new OAuth2OpenController();
            wire(controller, "oauth2ClientService", clientService);
            return wire(controller, "oauth2GrantService", grantService);
        }

        /** 角色接口，同时提供一个无权限表达式和一个有权限表达式的入口用于对照。 */
        @Bean
        RoleController roleController(RoleService roleService, AdminUserService userService) {
            RoleController controller = new RoleController();
            wire(controller, "roleService", roleService);
            return wire(controller, "userService", userService);
        }

        /** 个人资料接口，提供只要求登录的写入口用于证明机器主体不能写入管理数据。 */
        @Bean
        UserProfileController userProfileController(AdminUserService userService, RoleService roleService,
                                                   PermissionService permissionService, DeptService deptService,
                                                   PostService postService) {
            UserProfileController controller = new UserProfileController();
            wire(controller, "userService", userService);
            wire(controller, "roleService", roleService);
            wire(controller, "permissionService", permissionService);
            wire(controller, "deptService", deptService);
            return wire(controller, "postService", postService);
        }

        /**
         * 第三方客户端范围接口，作为模块显式声明的机器 API 面参与安全链判定。
         *
         * <p>本用例只用不存在的 POST 方法探测安全链是否放行，不调用其业务逻辑，
         * 因此部门与岗位服务只作为装配依赖注入。</p>
         */
        @Bean
        OAuth2UserController oauth2UserController(AdminUserService userService, DeptService deptService,
                                                 PostService postService) {
            OAuth2UserController controller = new OAuth2UserController();
            wire(controller, "userService", userService);
            wire(controller, "deptService", deptService);
            return wire(controller, "postService", postService);
        }

        /** 认证接口，用于真实用户登录与刷新正例。 */
        @Bean
        AuthController authController(AdminAuthService authService, AdminUserService userService,
                                      RoleService roleService, MenuService menuService,
                                      PermissionService permissionService) {
            AuthController controller = new AuthController();
            wire(controller, "authService", authService);
            wire(controller, "userService", userService);
            wire(controller, "roleService", roleService);
            wire(controller, "menuService", menuService);
            return wire(controller, "permissionService", permissionService);
        }
    }

    /** 从测试专用环境读取必要连接参数，缺失时直接失败。 */
    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("必须提供测试环境变量 " + name);
        }
        return value;
    }

    /** 向上定位仓库内的生产 DDL，避免测试副本与真实表结构脱节。 */
    private static Path findSchemaSource() {
        Path directory = Path.of("").toAbsolutePath();
        while (directory != null) {
            Path candidate = directory.resolve("数据库文件/basic_framework.sql");
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
            directory = directory.getParent();
        }
        throw new IllegalStateException("未找到生产初始化 SQL");
    }

    /** 注入生产实例的必要边界。 */
    private static <T> T wire(T target, String field, Object value) {
        ReflectionTestUtils.setField(target, field, value);
        return target;
    }
}
