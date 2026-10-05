package com.basicframework.module.system.service.auth;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.api.config.ConfigApi;
import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.module.system.api.sms.SmsCodeApi;
import com.basicframework.module.system.api.sms.SmsCodeApiImpl;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeUseReqDTO;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeSendReqDTO;
import com.basicframework.module.system.dal.dataobject.sms.SmsCodeDO;
import com.basicframework.module.system.dal.mysql.sms.SmsCodeMapper;
import com.basicframework.module.system.dal.redis.sms.SmsVerificationRedisDAO;
import com.basicframework.module.system.dal.redis.sms.SmsSendRedisDAO;
import com.basicframework.module.system.framework.sms.config.SmsCodeProperties;
import com.basicframework.module.system.enums.sms.SmsSceneEnum;
import com.basicframework.module.system.service.sms.SmsCodeService;
import com.basicframework.module.system.service.sms.SmsCodeServiceImpl;
import com.basicframework.module.system.service.sms.SmsSendService;
import com.basicframework.module.system.controller.admin.auth.vo.AuthLoginReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthLoginRespVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthResetPasswordReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthSmsLoginReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthRegisterReqVO;
import com.basicframework.module.system.controller.admin.user.vo.profile.UserProfileUpdatePasswordReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2ClientDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.dal.mysql.logger.LoginLogMapper;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2AccessTokenMapper;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2RefreshTokenMapper;
import com.basicframework.module.system.dal.mysql.user.AdminUserMapper;
import com.basicframework.module.system.dal.redis.oauth2.OAuth2AccessTokenRedisDAO;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.oauth2.OAuth2ClientConstants;
import com.basicframework.module.system.framework.auth.config.AdminAuthenticationProperties;
import com.basicframework.module.system.service.logger.LoginLogService;
import com.basicframework.module.system.service.logger.LoginLogServiceImpl;
import com.basicframework.module.system.service.oauth2.OAuth2ClientService;
import com.basicframework.module.system.service.oauth2.OAuth2GrantService;
import com.basicframework.module.system.service.oauth2.OAuth2GrantServiceImpl;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import com.basicframework.module.system.service.oauth2.OAuth2TokenServiceImpl;
import com.basicframework.module.system.service.user.AdminUserService;
import com.basicframework.module.system.service.user.AdminUserServiceImpl;
import com.basicframework.module.system.service.dept.DeptService;
import com.basicframework.module.system.service.dept.PostService;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mybatis.spring.mapper.MapperFactoryBean;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.AnnotationConfigUtils;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.MapPropertySource;
import org.redisson.Redisson;
import org.redisson.api.RedissonClient;
import org.redisson.config.Config;
import org.redisson.spring.data.connection.RedissonConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.LocalDate;
import java.security.SecureRandom;
import java.util.HashSet;
import java.util.Set;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;
import cn.hutool.crypto.digest.DigestUtil;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.when;
import static com.basicframework.module.system.enums.ErrorCodeConstants.*;

/**
 * 使用独立 MySQL 数据库、真实 Mapper 和 Spring 事务验证会话撤销与认证竞争。
 *
 * <p>显式执行本集成入口时必须注入测试专用 MySQL 和 Redis；缺失环境直接失败。
 * 数据库仅在环回测试服务中以随机 bf_auth_ 前缀创建和删除，不连接业务库。</p>
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AuthenticationSessionMySqlIT {

    private final String schema = "bf_auth_" + UUID.randomUUID().toString().replace("-", "");
    private final List<String> ownedCacheTokens = new ArrayList<>();
    private final Set<String> ownedBudgetKeys = new HashSet<>();
    private AnnotationConfigApplicationContext context;
    private RedissonClient redisClient;
    private OAuth2AccessTokenRedisDAO cache;
    private StringRedisTemplate redisTemplate;
    private SmsVerificationRedisDAO smsLimits;
    private SmsSendRedisDAO smsSendLimits;
    private SmsSendService smsSender;
    private final ConcurrentLinkedQueue<String> deliveredCodes = new ConcurrentLinkedQueue<>();
    private SmsCodeProperties smsProperties;
    private SmsCodeService smsCodes;
    private SmsCodeMapper smsMapper;
    private String clientIp;
    private PasswordEncoder encoder;
    private AdminUserService users;
    private AdminAuthService auth;
    private OAuth2TokenService tokens;
    private OAuth2GrantService grants;
    private AdminUserMapper userMapper;
    private OAuth2AccessTokenMapper accessMapper;
    private OAuth2RefreshTokenMapper refreshMapper;
    private JdbcTemplate jdbc;
    private TransactionTemplate transaction;
    private String adminUrl;
    private String databaseUser;
    private String databasePassword;
    private String oldPassword;
    private String newPassword;
    private AdminUserDO user;
    private boolean schemaCreated;

    /** 建立完全独立的测试资源，复用生产 DDL、数据填充器和事务代理。 */
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
        DriverManagerDataSource dataSource = new DriverManagerDataSource(url, databaseUser, databasePassword);
        jdbc = new JdbcTemplate(dataSource);
        String ddl = Files.readString(findSchemaSource());
        for (String table : List.of("system_users", "system_oauth2_access_token",
                "system_oauth2_refresh_token", "system_login_log", "system_sms_code", "system_user_role")) {
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
        String ping = redisTemplate.execute(connection -> connection.ping(), true);
        assertThat(ping).isEqualTo("PONG");
        cache = spy(new OAuth2AccessTokenRedisDAO());
        ReflectionTestUtils.setField(cache, "stringRedisTemplate", redisTemplate);
        smsLimits = spy(wire(new SmsVerificationRedisDAO(), "stringRedisTemplate", redisTemplate));
        smsSendLimits = spy(wire(new SmsSendRedisDAO(), "stringRedisTemplate", redisTemplate));
        smsSender = mock(SmsSendService.class);
        smsProperties = new SmsCodeProperties();
        smsProperties.setExpireTimes(Duration.ofMinutes(10));
        smsProperties.setSendFrequency(Duration.ofMinutes(1));
        smsProperties.setSendMaximumQuantityPerDay(10);
        encoder = spy(new BCryptPasswordEncoder(4));

        context = new AnnotationConfigApplicationContext();
        context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("auth-integration",
                Map.of("basic-framework.captcha.enable", "false")));
        // 本切片显式装配依赖；保留真实事务代理，不扫描无关业务的资源注入链。
        context.removeBeanDefinition(AnnotationConfigUtils.COMMON_ANNOTATION_PROCESSOR_BEAN_NAME);
        context.register(TransactionConfiguration.class);
        context.registerBean(DataSource.class, () -> dataSource);
        context.registerBean(PlatformTransactionManager.class, () -> new DataSourceTransactionManager(dataSource));
        context.registerBean(SqlSessionFactory.class, () -> createSqlSessionFactory(dataSource));
        registerMapper(AdminUserMapper.class);
        registerMapper(OAuth2AccessTokenMapper.class);
        registerMapper(OAuth2RefreshTokenMapper.class);
        registerMapper(LoginLogMapper.class);
        registerMapper(SmsCodeMapper.class);
        context.registerBean(AdminAuthenticationProperties.class, AdminAuthenticationProperties::new);
        context.registerBean(PasswordEncoder.class, () -> encoder);
        context.registerBean(ConfigApi.class, () -> mock(ConfigApi.class));
        context.registerBean(OAuth2AccessTokenRedisDAO.class, () -> cache);
        context.registerBean(OAuth2ClientService.class, this::clientService);
        context.registerBean(SmsCodeService.class, () -> {
            SmsCodeServiceImpl service = new SmsCodeServiceImpl();
            wire(service, "smsCodeProperties", smsProperties);
            wire(service, "smsCodeMapper", context.getBean(SmsCodeMapper.class));
            wire(service, "smsSendService", smsSender);
            wire(service, "smsSendRedisDAO", smsSendLimits);
            return wire(service, "smsVerificationRedisDAO", smsLimits);
        });
        context.registerBean(SmsCodeApi.class, () -> wire(new SmsCodeApiImpl(), "smsCodeService",
                context.getBean(SmsCodeService.class)));
        context.registerBean(LoginLogService.class, () -> wire(new LoginLogServiceImpl(),
                "loginLogMapper", context.getBean(LoginLogMapper.class)));
        context.registerBean(AdminUserService.class, () -> {
            AdminUserServiceImpl service = new AdminUserServiceImpl();
            wire(service, "userMapper", context.getBean(AdminUserMapper.class));
            wire(service, "passwordEncoder", encoder);
            wire(service, "configApi", context.getBean(ConfigApi.class));
            wire(service, "deptService", mock(DeptService.class));
            wire(service, "postService", mock(PostService.class));
            wire(service, "authenticationProperties", context.getBean(AdminAuthenticationProperties.class));
            ObjectProvider<OAuth2TokenService> provider = context.getBeanProvider(OAuth2TokenService.class);
            return wire(service, "oauth2TokenServiceProvider", provider);
        });
        context.registerBean(OAuth2TokenService.class, () -> {
            OAuth2TokenServiceImpl service = new OAuth2TokenServiceImpl();
            wire(service, "adminUserMapper", context.getBean(AdminUserMapper.class));
            wire(service, "adminUserService", context.getBean(AdminUserService.class));
            wire(service, "oauth2AccessTokenMapper", context.getBean(OAuth2AccessTokenMapper.class));
            wire(service, "oauth2RefreshTokenMapper", context.getBean(OAuth2RefreshTokenMapper.class));
            wire(service, "oauth2AccessTokenRedisDAO", cache);
            return wire(service, "oauth2ClientService", context.getBean(OAuth2ClientService.class));
        });
        context.registerBean(AdminAuthService.class, () -> {
            AdminAuthServiceImpl service = new AdminAuthServiceImpl();
            wire(service, "userService", context.getBean(AdminUserService.class));
            wire(service, "oauth2TokenService", context.getBean(OAuth2TokenService.class));
            wire(service, "loginLogService", context.getBean(LoginLogService.class));
            wire(service, "smsCodeApi", context.getBean(SmsCodeApi.class));
            wire(service, "authenticationProperties", context.getBean(AdminAuthenticationProperties.class));
            return wire(service, "captchaEnable", false);
        });
        context.registerBean(OAuth2GrantService.class, () -> {
            OAuth2GrantServiceImpl service = new OAuth2GrantServiceImpl();
            wire(service, "adminAuthService", context.getBean(AdminAuthService.class));
            return wire(service, "oauth2TokenService", context.getBean(OAuth2TokenService.class));
        });
        context.refresh();
        users = context.getBean(AdminUserService.class);
        auth = context.getBean(AdminAuthService.class);
        tokens = context.getBean(OAuth2TokenService.class);
        grants = context.getBean(OAuth2GrantService.class);
        smsCodes = context.getBean(SmsCodeService.class);
        smsMapper = context.getBean(SmsCodeMapper.class);
        userMapper = context.getBean(AdminUserMapper.class);
        accessMapper = context.getBean(OAuth2AccessTokenMapper.class);
        refreshMapper = context.getBean(OAuth2RefreshTokenMapper.class);
        transaction = new TransactionTemplate(context.getBean(PlatformTransactionManager.class));
    }

    /** 每例使用新账号与随机测试口令，不复用业务账号或固定凭据。 */
    @BeforeEach
    void createUser() {
        reset(cache, encoder, smsLimits, smsSendLimits, smsSender, refreshMapper);
        deliveredCodes.clear();
        doAnswer(invocation -> {
            Map<String, Object> parameters = invocation.getArgument(4);
            deliveredCodes.add((String) parameters.get("code"));
            return 1L;
        }).when(smsSender).sendSingleSms(anyString(), any(), any(), anyString(), any());
        context.getBean(AdminAuthenticationProperties.class).setRegistrationEnabled(false);
        reset(context.getBean(ConfigApi.class));
        smsProperties.setVerificationMaximumFailures(5);
        smsProperties.setVerificationMaximumPerMobile(10);
        smsProperties.setVerificationMaximumPerIp(50);
        smsProperties.setSendFrequency(Duration.ofMinutes(1));
        smsProperties.setSendMaximumQuantityPerDay(10);
        smsProperties.setSendMaximumPerIp(50);
        for (String table : List.of("system_oauth2_access_token", "system_oauth2_refresh_token",
                "system_login_log", "system_users", "system_sms_code", "system_user_role")) {
            jdbc.update("DELETE FROM " + table);
        }
        oldPassword = UUID.randomUUID().toString().replace("-", "");
        newPassword = UUID.randomUUID().toString().replace("-", "");
        String random = UUID.randomUUID().toString().replace("-", "");
        clientIp = "2001:db8:" + random.substring(0, 4) + ":" + random.substring(4, 8) + "::" + random.substring(8, 12);
        user = AdminUserDO.builder().username("test_" + random.substring(0, 16)).nickname("会话测试")
                .userType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()).status(CommonStatusEnum.ENABLE.getStatus())
                .mobile("13" + (100_000_000 + new SecureRandom().nextInt(900_000_000)))
                .password(encoder.encode(oldPassword)).build();
        userMapper.insert(user);
        ownBudget(user.getMobile(), clientIp, null);
    }

    /** 验证三种改密入口都撤销全部客户端会话和孤立刷新令牌。 */
    @ParameterizedTest
    @EnumSource(PasswordChange.class)
    void passwordChangesRevokeAllSessionsAndOrphanRefresh(PasswordChange change) {
        OAuth2AccessTokenDO first = issue();
        OAuth2AccessTokenDO otherClient = tokens.createAccessToken(user.getId(), UserTypeEnum.ADMIN.getValue(), "test-client-other", null);
        OAuth2AccessTokenDO orphan = issue();
        AdminUserDO otherUser = AdminUserDO.builder().username("other_" + UUID.randomUUID().toString().substring(0, 12))
                .nickname("其他账号").userType(user.getUserType()).status(CommonStatusEnum.ENABLE.getStatus())
                .password(encoder.encode(UUID.randomUUID().toString())).build();
        userMapper.insert(otherUser);
        OAuth2AccessTokenDO unaffected = tokens.createAccessToken(otherUser.getId(), UserTypeEnum.ADMIN.getValue(),
                OAuth2ClientConstants.CLIENT_ID_DEFAULT, null);
        accessMapper.deleteById(orphan.getId());
        changePassword(change);
        assertThat(users.isPasswordMatch(newPassword, userMapper.selectById(user.getId()).getPassword())).isTrue();
        assertRevoked(first);
        assertRevoked(otherClient);
        assertThatThrownBy(() -> tokens.refreshAccessToken(orphan.getRefreshToken(), orphan.getClientId()))
                .isInstanceOf(ServiceException.class);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_oauth2_refresh_token WHERE deleted = 0 AND user_id = ?",
                Long.class, user.getId()))
                .isZero();
        assertThat(tokens.checkAccessToken(unaffected.getAccessToken()).getUserId()).isEqualTo(otherUser.getId());
    }

    /**
     * 短信找回后必须能用同一个密码摘要重新登录。
     *
     * <p>前端登录、个人改密、管理员重置与短信找回都只提交 MD5 摘要，服务端按摘要直接
     * 使用 BCrypt 存储。找回入口一旦改写摘要来源（例如再摘要一次原密码），存储值与登录
     * 提交值就不同源，用户会带着“已重置成功”的提示被永久挡在密码登录之外；本用例把
     * 找回成功、旧会话与旧摘要失效、新摘要可登录三件事放在同一条链上验证。</p>
     */
    @Test
    void recoveryDigestIsAcceptedByPasswordLogin() {
        OAuth2AccessTokenDO session = issue();
        SmsCodeDO code = createSms(SmsSceneEnum.ADMIN_MEMBER_RESET_PASSWORD.getScene());
        withHttpRequest(() -> {
            auth.resetPassword(AuthResetPasswordReqVO.builder()
                    .mobile(user.getMobile()).code(code.getCode()).password(newPassword).build());
            return null;
        });

        assertRevoked(session);
        // 失败审计同样要求连接信息，两种登录都在真实 HTTP 上下文内提交。
        assertError(() -> withHttpRequest(() -> loginWith(oldPassword)), AUTH_LOGIN_BAD_CREDENTIALS.getCode());
        AuthLoginRespVO response = withHttpRequest(() -> loginWith(newPassword));
        assertThat(response.getAccessToken()).isNotBlank();
        assertThat(tokens.checkAccessToken(response.getAccessToken()).getUserId()).isEqualTo(user.getId());
    }

    /** 按普通账号密码入口提交密码摘要，返回携带新会话的登录结果。 */
    private AuthLoginRespVO loginWith(String passwordDigest) {
        AuthLoginReqVO request = new AuthLoginReqVO();
        request.setUsername(user.getUsername());
        request.setPassword(passwordDigest);
        return auth.login(request);
    }

    /** 撤销 SQL 失败时三种入口自己的事务回滚密码及已执行的访问令牌删除。 */
    @ParameterizedTest
    @EnumSource(PasswordChange.class)
    void revocationFailureRollsBackPasswordAndSessionWrites(PasswordChange change) {
        OAuth2AccessTokenDO session = issue();
        doThrow(new IllegalStateException("controlled-revocation-failure")).when(refreshMapper)
                .deleteByUserIdAndUserType(user.getId(), UserTypeEnum.ADMIN.getValue());
        assertThatThrownBy(() -> changePassword(change)).isInstanceOf(IllegalStateException.class);
        assertThat(users.isPasswordMatch(oldPassword, userMapper.selectById(user.getId()).getPassword())).isTrue();
        assertThat(tokens.checkAccessToken(session.getAccessToken())).isNotNull();
        assertThat(tokens.refreshAccessToken(session.getRefreshToken(), session.getClientId())).isNotNull();
    }

    /** Redis 清理失败且旧值真实残留时，数据库撤销仍拒绝认证和刷新。 */
    @Test
    void leftoverRedisValueCannotRestoreRevokedIdentity() {
        OAuth2AccessTokenDO session = issue();
        cache.set(session);
        ownedCacheTokens.add(session.getAccessToken());
        doThrow(new IllegalStateException("controlled-cache-failure")).when(cache).deleteList(anyCollection());
        changePassword(PasswordChange.ADMIN);
        assertThat(cache.get(session.getAccessToken())).isNotNull();
        assertRevoked(session);
    }

    /** 外层事务回滚时密码与所有会话共同恢复，提交后清理回调不得提前执行。 */
    @Test
    void rollbackKeepsPasswordAndSessionsTogether() {
        OAuth2AccessTokenDO session = issue();
        cache.set(session);
        ownedCacheTokens.add(session.getAccessToken());
        assertThatThrownBy(() -> transaction.executeWithoutResult(status -> {
            changePassword(PasswordChange.ADMIN);
            throw new IllegalStateException("controlled-rollback");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(users.isPasswordMatch(oldPassword, userMapper.selectById(user.getId()).getPassword())).isTrue();
        assertThat(tokens.checkAccessToken(session.getAccessToken())).isNotNull();
        assertThat(cache.get(session.getAccessToken())).isNotNull();
        assertThat(tokens.refreshAccessToken(session.getRefreshToken(), session.getClientId())).isNotNull();
    }

    /** 改密先持锁时，已定位旧刷新记录的并发请求必须在锁后重读并拒绝。 */
    @Test
    void passwordChangeWinningLockRejectsConcurrentRefresh() throws Exception {
        OAuth2AccessTokenDO session = issue();
        CountDownLatch changed = new CountDownLatch(1);
        CountDownLatch commit = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<?> resetPassword = executor.submit(() -> transaction.executeWithoutResult(status -> {
                changePassword(PasswordChange.ADMIN);
                changed.countDown();
                awaitLatch(commit);
            }));
            awaitLatch(changed);
            Future<?> refresh = executor.submit(() -> tokens.refreshAccessToken(session.getRefreshToken(), session.getClientId()));
            awaitDatabaseLockWait();
            commit.countDown();
            resetPassword.get(15, TimeUnit.SECONDS);
            assertThatThrownBy(() -> refresh.get(15, TimeUnit.SECONDS)).hasCauseInstanceOf(ServiceException.class);
            assertRevoked(session);
        } finally {
            commit.countDown();
            closeExecutor(executor);
        }
    }

    /** 刷新先提交时，随后改密必须同时撤销刷新刚生成的访问令牌。 */
    @Test
    void refreshWinningLockIsRevokedByFollowingPasswordChange() throws Exception {
        OAuth2AccessTokenDO session = issue();
        CountDownLatch refreshed = new CountDownLatch(1);
        CountDownLatch commit = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<OAuth2AccessTokenDO> refresh = executor.submit(() -> transaction.execute(status -> {
                OAuth2AccessTokenDO result = tokens.refreshAccessToken(session.getRefreshToken(), session.getClientId());
                refreshed.countDown();
                awaitLatch(commit);
                return result;
            }));
            awaitLatch(refreshed);
            Future<?> resetPassword = executor.submit(() -> changePassword(PasswordChange.ADMIN));
            awaitDatabaseLockWait();
            commit.countDown();
            OAuth2AccessTokenDO replacement = refresh.get(15, TimeUnit.SECONDS);
            resetPassword.get(15, TimeUnit.SECONDS);
            assertRevoked(replacement);
        } finally {
            commit.countDown();
            closeExecutor(executor);
        }
    }

    /** 普通与 OAuth 密码入口在旧密码已验证后仍持锁，改密最终撤销此次签发。 */
    @ParameterizedTest
    @EnumSource(PasswordLogin.class)
    void validatedOldPasswordCannotIssueAfterPasswordChange(PasswordLogin login) throws Exception {
        if (login == PasswordLogin.SUPER) {
            user.setUserType(AdminPlatformTypeEnum.SUPER_ADMIN.getType());
            userMapper.updateById(user);
        }
        CountDownLatch validated = new CountDownLatch(1);
        CountDownLatch sign = new CountDownLatch(1);
        AtomicBoolean firstMatch = new AtomicBoolean(true);
        doAnswer(invocation -> {
            boolean matches = (boolean) invocation.callRealMethod();
            if (matches && firstMatch.compareAndSet(true, false)) {
                validated.countDown();
                awaitLatch(sign);
            }
            return matches;
        }).when(encoder).matches(any(CharSequence.class), anyString());
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<String> issued = executor.submit(() -> login(login));
            awaitLatch(validated);
            Future<?> resetPassword = executor.submit(() -> changePassword(PasswordChange.ADMIN));
            awaitDatabaseLockWait();
            sign.countDown();
            String value = issued.get(15, TimeUnit.SECONDS);
            resetPassword.get(15, TimeUnit.SECONDS);
            assertThatThrownBy(() -> tokens.checkAccessToken(value)).isInstanceOf(ServiceException.class);
        } finally {
            sign.countDown();
            closeExecutor(executor);
        }
    }

    /** 登录先读到旧快照但改密先持锁时，锁后的新密码必须使旧密码验证失败并留下失败审计。 */
    @Test
    void passwordChangeBeforeCredentialCheckRejectsOldSnapshot() throws Exception {
        CountDownLatch changed = new CountDownLatch(1);
        CountDownLatch commit = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<?> resetPassword = executor.submit(() -> transaction.executeWithoutResult(status -> {
                changePassword(PasswordChange.ADMIN);
                changed.countDown();
                awaitLatch(commit);
            }));
            awaitLatch(changed);
            Future<String> login = executor.submit(() -> login(PasswordLogin.NORMAL));
            awaitDatabaseLockWait();
            commit.countDown();
            resetPassword.get(15, TimeUnit.SECONDS);
            assertThatThrownBy(() -> login.get(15, TimeUnit.SECONDS)).hasCauseInstanceOf(ServiceException.class);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_oauth2_access_token WHERE deleted = 0", Long.class))
                    .isZero();
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_login_log WHERE result = 10", Long.class))
                    .isEqualTo(1L);
        } finally {
            commit.countDown();
            closeExecutor(executor);
        }
    }

    /** 没有外层事务的单独密码验证被拒绝，防止未来调用方提前释放认证锁。 */
    @Test
    void authenticateRequiresEnclosingTransaction() {
        assertThatThrownBy(() -> auth.authenticate(user.getUsername(), oldPassword))
                .isInstanceOf(org.springframework.transaction.IllegalTransactionStateException.class);
    }

    /** 单个验证码的错误预算不随登录数据库事务回滚恢复，耗尽后正确值也不能消费。 */
    @Test
    void smsFailureBudgetSurvivesDatabaseRollback() {
        SmsCodeDO code = createSms(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        for (int attempt = 0; attempt < 5; attempt++) {
            assertThatThrownBy(() -> transaction.executeWithoutResult(status ->
                    smsCodes.useSmsCode(smsRequest(code, "not-a-code")))).isInstanceOf(ServiceException.class);
        }
        assertError(() -> smsCodes.useSmsCode(smsRequest(code, code.getCode())), SMS_CODE_ATTEMPTS_EXHAUSTED.getCode());
        assertThat(smsMapper.selectById(code.getId()).getUsed()).isFalse();
    }

    /** 新验证码发出后旧验证码不再匹配，已消费重放也计入请求预算。 */
    @Test
    void smsRejectsOldChallengeAndReplay() {
        SmsCodeDO oldCode = createSms(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        SmsCodeDO current = createSms(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        if (current.getCode().equals(oldCode.getCode())) {
            current.setCode(String.format("%06d", (Integer.parseInt(oldCode.getCode()) + 1) % 1_000_000));
            smsMapper.updateById(current);
        }
        assertError(() -> smsCodes.useSmsCode(smsRequest(oldCode, oldCode.getCode())), SMS_CODE_NOT_FOUND.getCode());
        assertThat(smsMapper.updateUsedIfUnused(oldCode.getId(), LocalDateTime.now(), clientIp,
                LocalDateTime.now().minus(smsProperties.getExpireTimes()))).isZero();
        smsCodes.useSmsCode(smsRequest(current, current.getCode()));
        assertError(() -> smsCodes.useSmsCode(smsRequest(current, current.getCode())), SMS_CODE_USED.getCode());
        assertThat(smsMapper.selectById(oldCode.getId()).getUsed()).isFalse();
        assertThat(redisTemplate.opsForValue().get("sms_verify:{budget}:mobile:" + DigestUtil.sha256Hex(user.getMobile())))
                .isEqualTo("3");
    }

    /** 超期码被拒绝并计入请求预算，消费条件也不能写入已过期记录。 */
    @Test
    void expiredSmsCannotBeConsumed() {
        SmsCodeDO code = createSms(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        code.setCreateTime(LocalDateTime.now().minus(smsProperties.getExpireTimes()).minusSeconds(1));
        smsMapper.updateById(code);
        assertError(() -> smsCodes.useSmsCode(smsRequest(code, code.getCode())), SMS_CODE_EXPIRED.getCode());
        assertThat(smsMapper.updateUsedIfUnused(code.getId(), LocalDateTime.now(), clientIp,
                LocalDateTime.now().minus(smsProperties.getExpireTimes()))).isZero();
    }

    /** 手机预算不能通过变化 IP 绕过，IP 预算不能通过变化手机绕过。 */
    @Test
    void smsLimitsApplyToMobileAndIpIndependently() {
        smsProperties.setVerificationMaximumPerMobile(2);
        smsProperties.setVerificationMaximumPerIp(2);
        String otherIp = "192.0.2." + new SecureRandom().nextInt(256);
        String otherMobile = "15" + (100_000_000 + new SecureRandom().nextInt(900_000_000));
        ownBudget(user.getMobile(), otherIp, null);
        ownBudget(otherMobile, clientIp, null);
        assertThat(smsLimits.allowRequest(user.getMobile(), clientIp, smsProperties)).isTrue();
        assertThat(smsLimits.allowRequest(user.getMobile(), otherIp, smsProperties)).isTrue();
        assertThat(smsLimits.allowRequest(user.getMobile(), otherIp, smsProperties)).isFalse();
        assertThat(smsLimits.allowRequest(otherMobile, clientIp, smsProperties)).isTrue();
        assertThat(smsLimits.allowRequest(otherMobile, clientIp, smsProperties)).isFalse();
    }

    /** 两个场景同时读到无历史记录后竞争真实 Redis，只有一个写库和发送，生成验证码仍可正常消费。 */
    @Test
    void concurrentSmsSendingHasOneWinnerAndUsableCode() throws Exception {
        CyclicBarrier bothReadHistory = new CyclicBarrier(2);
        doAnswer(invocation -> {
            bothReadHistory.await(5, TimeUnit.SECONDS);
            return invocation.callRealMethod();
        }).when(smsSendLimits).reserve(anyString(), anyString(), any(), any(), any(Integer.class));
        ownSendBudget(user.getMobile(), clientIp);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            List<Future<Boolean>> results = List.of(
                    executor.submit(() -> attemptSend(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene())),
                    executor.submit(() -> attemptSend(SmsSceneEnum.ADMIN_MEMBER_RESET_PASSWORD.getScene())));
            int successful = 0;
            for (Future<Boolean> result : results) {
                successful += result.get(10, TimeUnit.SECONDS) ? 1 : 0;
            }
            assertThat(successful).isEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_sms_code", Integer.class)).isEqualTo(1);
            SmsCodeDO code = smsMapper.selectLastByMobile(user.getMobile(), null, null);
            assertThat(code.getTodayIndex()).isEqualTo(1);
            assertThat(code.getCreateIp()).isEqualTo(clientIp);
            assertThat(deliveredCodes).containsExactly(code.getCode());
            ownBudget(user.getMobile(), clientIp, code.getId());
            smsCodes.useSmsCode(smsRequest(code, code.getCode()));
            assertThat(smsMapper.selectById(code.getId()).getUsed()).isTrue();
        } finally {
            executor.shutdownNow();
            assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    /** 真实 Redis 间隔过期后允许再次发送，日额度仍持续生效且新验证码替代旧挑战。 */
    @Test
    void smsSendingAllowsNextWindowAndEnforcesDailyQuota() {
        smsProperties.setSendFrequency(Duration.ofMillis(20));
        smsProperties.setSendMaximumQuantityPerDay(2);
        SmsCodeSendReqDTO request = sendRequest(user.getMobile(), SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        smsCodes.sendSmsCode(request);
        SmsCodeDO first = smsMapper.selectLastByMobile(user.getMobile(), null, null);
        await().atMost(Duration.ofSeconds(3)).until(() -> !redisTemplate.hasKey(sendIntervalKey(user.getMobile()))
                && first.getCreateTime().plus(smsProperties.getSendFrequency()).isBefore(LocalDateTime.now()));
        smsCodes.sendSmsCode(request);
        SmsCodeDO second = smsMapper.selectLastByMobile(user.getMobile(), null, null);
        assertThat(second.getTodayIndex()).isEqualTo(2);
        assertThat(deliveredCodes).hasSize(2);
        assertThat(second.getId()).isGreaterThan(first.getId());
        await().atMost(Duration.ofSeconds(3)).until(() -> !redisTemplate.hasKey(sendIntervalKey(user.getMobile()))
                && second.getCreateTime().plus(smsProperties.getSendFrequency()).isBefore(LocalDateTime.now()));
        assertError(() -> smsCodes.sendSmsCode(request), SMS_CODE_EXCEED_SEND_MAXIMUM_QUANTITY_PER_DAY.getCode());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_sms_code", Integer.class)).isEqualTo(2);
    }

    /** Redis 无历史额度时，数据库已发送记录仍是间隔与日上限的保守下限。 */
    @Test
    void smsSendingColdCacheHonorsPersistedLimits() {
        SmsCodeDO persisted = createSms(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        SmsCodeSendReqDTO request = sendRequest(user.getMobile(), persisted.getScene());
        assertError(() -> smsCodes.sendSmsCode(request), SMS_CODE_SEND_TOO_FAST.getCode());
        smsProperties.setSendFrequency(Duration.ofMillis(1));
        persisted.setCreateTime(LocalDate.now().atStartOfDay());
        persisted.setTodayIndex(smsProperties.getSendMaximumQuantityPerDay());
        smsMapper.updateById(persisted);
        assertError(() -> smsCodes.sendSmsCode(request), SMS_CODE_EXCEED_SEND_MAXIMUM_QUANTITY_PER_DAY.getCode());
        assertThat(deliveredCodes).isEmpty();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_sms_code", Integer.class)).isEqualTo(1);
    }

    /** 供应商错误引发真实数据库事务回滚后，额度预约仍保留以阻断不确定结果的重复发送。 */
    @Test
    void failedSmsDeliveryDoesNotRefundReservation() {
        SmsCodeSendReqDTO request = sendRequest(user.getMobile(), SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        doThrow(new IllegalStateException("controlled-delivery-failure")).when(smsSender)
                .sendSingleSms(anyString(), any(), any(), anyString(), any());
        assertThatThrownBy(() -> transaction.executeWithoutResult(status -> smsCodes.sendSmsCode(request)))
                .isInstanceOf(IllegalStateException.class);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_sms_code", Integer.class)).isZero();
        assertError(() -> smsCodes.sendSmsCode(request), SMS_CODE_SEND_TOO_FAST.getCode());
        assertThat(redisTemplate.opsForValue().get(sendIntervalKey(user.getMobile()))).isEqualTo("1");
    }

    /** 发送预算不可用时失败关闭，数据库和短信供应商均不得收到新验证码。 */
    @Test
    void unavailableSmsSendBudgetDoesNotIssueCode() {
        doThrow(new IllegalStateException("controlled-budget-failure")).when(smsSendLimits)
                .reserve(anyString(), anyString(), any(), any(), any(Integer.class));
        assertThatThrownBy(() -> smsCodes.sendSmsCode(sendRequest(user.getMobile(), SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene())))
                .isInstanceOf(IllegalStateException.class);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_sms_code", Integer.class)).isZero();
        assertThat(deliveredCodes).isEmpty();
    }

    /** 同一 IP 更换手机号仍共用发送预算，因间隔被拒绝的请求也计入窗口。 */
    @Test
    void smsSendingIpBudgetCountsRejectedRequestsAcrossMobiles() {
        smsProperties.setSendMaximumPerIp(2);
        SmsCodeSendReqDTO request = sendRequest(user.getMobile(), SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        smsCodes.sendSmsCode(request);
        assertError(() -> smsCodes.sendSmsCode(request), SMS_CODE_SEND_TOO_FAST.getCode());
        String otherMobile = "15" + user.getMobile().substring(2);
        assertError(() -> smsCodes.sendSmsCode(sendRequest(otherMobile, request.getScene())), SMS_CODE_SEND_TOO_FAST.getCode());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_sms_code", Integer.class)).isEqualTo(1);
        assertThat(deliveredCodes).hasSize(1);
    }

    /** 构造可信服务端发送 DTO，并登记本例实际占用的预算键。 */
    private SmsCodeSendReqDTO sendRequest(String mobile, int scene) {
        ownSendBudget(mobile, clientIp);
        SmsCodeSendReqDTO request = new SmsCodeSendReqDTO();
        request.setMobile(mobile);
        request.setScene(scene);
        request.setCreateIp(clientIp);
        return request;
    }

    /** 只清理本例手机号/IP 和相邻日期拥有的发送键，不扫描共享 Redis。 */
    private void ownSendBudget(String mobile, String ip) {
        ownedBudgetKeys.add(sendIntervalKey(mobile));
        ownedBudgetKeys.add("sms_send:{budget}:ip:" + DigestUtil.sha256Hex(ip));
        for (int days = -1; days <= 1; days++) {
            ownedBudgetKeys.add("sms_send:{budget}:daily:" + DigestUtil.sha256Hex(mobile) + ":" + LocalDate.now().plusDays(days));
        }
    }

    /** 返回本例手机号的间隔键，用于等待真实过期与检查故障保留。 */
    private String sendIntervalKey(String mobile) {
        return "sms_send:{budget}:interval:" + DigestUtil.sha256Hex(mobile);
    }

    /** 并发发送仅将明确的频率拒绝视为败者，其他失败继续上抛使测试失败。 */
    private boolean attemptSend(int scene) {
        SmsCodeSendReqDTO request = new SmsCodeSendReqDTO();
        request.setMobile(user.getMobile());
        request.setScene(scene);
        request.setCreateIp(clientIp);
        try {
            smsCodes.sendSmsCode(request);
            return true;
        } catch (ServiceException exception) {
            assertThat(exception.getCode()).isEqualTo(SMS_CODE_SEND_TOO_FAST.getCode());
            return false;
        }
    }

    /** 两个请求在真实 Redis 校验成功后同时消费，数据库只允许其中一个成功。 */
    @Test
    void concurrentSmsConsumptionHasOneWinner() throws Exception {
        SmsCodeDO code = createSms(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        CyclicBarrier compared = new CyclicBarrier(2);
        doAnswer(invocation -> {
            Object result = invocation.callRealMethod();
            compared.await(10, TimeUnit.SECONDS);
            return result;
        }).when(smsLimits).checkFailureBudget(anyString(), any(Long.class), any(Boolean.class),
                any(Long.class), any(Integer.class));
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            List<Future<Boolean>> results = List.of(executor.submit(() -> consumeSms(code)), executor.submit(() -> consumeSms(code)));
            int winners = 0;
            for (Future<Boolean> result : results) {
                if (result.get(15, TimeUnit.SECONDS)) {
                    winners++;
                }
            }
            assertThat(winners).isEqualTo(1);
            assertThat(smsMapper.selectById(code.getId()).getUsed()).isTrue();
        } finally {
            closeExecutor(executor);
        }
    }

    /** 预算存储不可用时拒绝验证，不能降级为无限尝试。 */
    @Test
    void smsLimitFailureDoesNotConsumeChallenge() {
        SmsCodeDO code = createSms(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        doThrow(new IllegalStateException("controlled-budget-failure")).when(smsLimits)
                .allowRequest(anyString(), anyString(), any(SmsCodeProperties.class));
        assertThatThrownBy(() -> smsCodes.useSmsCode(smsRequest(code, code.getCode())))
                .isInstanceOf(IllegalStateException.class);
        assertThat(smsMapper.selectById(code.getId()).getUsed()).isFalse();
    }

    /** 短信入口只允许业务管理平台的启用账号，禁用或超管账号不得消费挑战或签发。 */
    @Test
    void smsLoginRejectsDisabledAndOtherPlatformUsers() {
        SmsCodeDO code = createSms(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        user.setStatus(CommonStatusEnum.DISABLE.getStatus());
        userMapper.updateById(user);
        assertThatThrownBy(() -> withHttpRequest(() -> auth.smsLogin(AuthSmsLoginReqVO.builder()
                .mobile(user.getMobile()).code(code.getCode()).build()))).isInstanceOf(ServiceException.class);
        user.setStatus(CommonStatusEnum.ENABLE.getStatus());
        user.setUserType(AdminPlatformTypeEnum.SUPER_ADMIN.getType());
        userMapper.updateById(user);
        assertThatThrownBy(() -> withHttpRequest(() -> auth.smsLogin(AuthSmsLoginReqVO.builder()
                .mobile(user.getMobile()).code(code.getCode()).build()))).isInstanceOf(ServiceException.class);
        assertThat(smsMapper.selectById(code.getId()).getUsed()).isFalse();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_oauth2_access_token WHERE deleted = 0", Long.class)).isZero();
    }

    /** 不受信任的转发头不能改变 IP 预算身份，IPv6 连接地址在真实表中完整保留。 */
    @Test
    void smsAuthenticationUsesPeerAddressAndPreservesIpv6() {
        SmsCodeDO code = createSms(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        withHttpRequest(() -> {
            MockHttpServletRequest request = (MockHttpServletRequest)
                    ((ServletRequestAttributes) RequestContextHolder.currentRequestAttributes()).getRequest();
            request.addHeader("X-Forwarded-For", "198.51.100.88");
            request.addHeader("X-Real-IP", "198.51.100.89");
            AuthLoginRespVO response = auth.smsLogin(AuthSmsLoginReqVO.builder()
                    .mobile(user.getMobile()).code(code.getCode()).build());
            assertThat(tokens.checkAccessToken(response.getAccessToken())).isNotNull();
            return null;
        });
        SmsCodeDO stored = smsMapper.selectById(code.getId());
        assertThat(stored.getCreateIp()).isEqualTo(clientIp);
        assertThat(stored.getUsedIp()).isEqualTo(clientIp);
        assertThat(redisTemplate.opsForValue().get("sms_verify:{budget}:ip:" + DigestUtil.sha256Hex(clientIp))).isEqualTo("1");
    }

    /** 显式开放注册后，匿名输入中的高权限字段不能决定平台、状态或角色。 */
    @Test
    void registrationNeverAcceptsPrivilegedIdentityFields() {
        context.getBean(AdminAuthenticationProperties.class).setRegistrationEnabled(true);
        when(context.getBean(ConfigApi.class).getConfigValueByKey("system.user.register-enabled")).thenReturn("true");
        String name = "reg_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        AuthRegisterReqVO request = JsonUtils.parseObject(JsonUtils.toJsonString(Map.of(
                "username", name, "password", newPassword, "nickname", "注册测试",
                "userType", "super_admin", "roleIds", List.of(1L), "id", user.getId())), AuthRegisterReqVO.class);
        AuthLoginRespVO response = withHttpRequest(() -> auth.register(request));
        AdminUserDO registered = userMapper.selectById(response.getUserId());
        assertThat(registered.getId()).isNotEqualTo(user.getId());
        assertThat(registered.getUserType()).isEqualTo(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        assertThat(registered.getStatus()).isEqualTo(CommonStatusEnum.ENABLE.getStatus());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_user_role WHERE user_id = ? AND deleted = 0",
                Long.class, registered.getId())).isZero();
        assertThat(tokens.checkAccessToken(response.getAccessToken()).getUserId()).isEqualTo(registered.getId());
    }

    /** 部署开关不能绕过数据库注册开关，两处显式开放之前不能插入用户。 */
    @Test
    void registrationRequiresDatabaseOptInAsWell() {
        context.getBean(AdminAuthenticationProperties.class).setRegistrationEnabled(true);
        when(context.getBean(ConfigApi.class).getConfigValueByKey("system.user.register-enabled")).thenReturn("false");
        AuthRegisterReqVO request = new AuthRegisterReqVO();
        request.setUsername("disabled-registration");
        request.setNickname("注册关闭测试");
        request.setPassword(newPassword);
        assertError(() -> withHttpRequest(() -> auth.register(request)), USER_REGISTER_DISABLED.getCode());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_users", Long.class)).isEqualTo(1L);
    }

    /** 用户禁用后，不等待异步缓存清理就拒绝旧访问令牌和刷新。 */
    @Test
    void disabledUserCannotReusePreviouslyIssuedSession() {
        OAuth2AccessTokenDO session = issue();
        user.setStatus(CommonStatusEnum.DISABLE.getStatus());
        userMapper.updateById(user);
        assertRevoked(session);
    }

    /** 在每例结束后清理本例拥有的 Redis 键，故障注入不影响清理。 */
    @AfterEach
    void clearOwnedCache() {
        if (cache != null) {
            reset(cache);
            if (!ownedCacheTokens.isEmpty()) {
                cache.deleteList(ownedCacheTokens);
                ownedCacheTokens.clear();
            }
        }
        if (redisTemplate != null && !ownedBudgetKeys.isEmpty()) {
            redisTemplate.delete(ownedBudgetKeys);
            ownedBudgetKeys.clear();
        }
    }

    /** 即使初始化或测试失败，也关闭连接设施并删除唯一拥有的临时数据库。 */
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

    /** 从测试专用环境读取必要连接参数，避免自动回退个人开发配置。 */
    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("必须提供测试环境变量 " + name);
        }
        return value;
    }

    /** 向上定位仓库内的生产 DDL，避免维护与真实表结构脱节的测试副本。 */
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

    /** 使用实际 MyBatis Plus 和填充器生成 Mapper SQL，不用内存替身模拟行锁。 */
    private SqlSessionFactory createSqlSessionFactory(DataSource dataSource) {
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

    /** 为指定生产 Mapper 注册真实代理，避免扫描无关模块和自动配置。 */
    private <T> void registerMapper(Class<T> mapperType) {
        context.registerBean(mapperType, () -> {
            try {
                MapperFactoryBean<T> factory = new MapperFactoryBean<>(mapperType);
                factory.setSqlSessionFactory(context.getBean(SqlSessionFactory.class));
                factory.afterPropertiesSet();
                T mapper = factory.getObject();
                return mapperType.equals(OAuth2RefreshTokenMapper.class) ? spy(mapper) : mapper;
            } catch (Exception exception) {
                throw new IllegalStateException("测试 Mapper 创建失败", exception);
            }
        });
    }

    /** 只替代 OAuth 客户端配置边界，令牌写入、校验和撤销保持真实。 */
    private OAuth2ClientService clientService() {
        OAuth2ClientDO client = new OAuth2ClientDO();
        client.setClientId(OAuth2ClientConstants.CLIENT_ID_DEFAULT);
        client.setAccessTokenValiditySeconds(600);
        client.setRefreshTokenValiditySeconds(1200);
        OAuth2ClientService service = mock(OAuth2ClientService.class);
        when(service.validOAuthClientFromCache(OAuth2ClientConstants.CLIENT_ID_DEFAULT)).thenReturn(client);
        OAuth2ClientDO other = new OAuth2ClientDO();
        other.setClientId("test-client-other");
        other.setAccessTokenValiditySeconds(600);
        other.setRefreshTokenValiditySeconds(1200);
        when(service.validOAuthClientFromCache("test-client-other")).thenReturn(other);
        return service;
    }

    /** 注入生产实例的必要边界；Spring 随后为真实方法建立事务代理。 */
    private static <T> T wire(T target, String field, Object value) {
        ReflectionTestUtils.setField(target, field, value);
        return target;
    }

    /** 创建需要验证的真实访问和刷新会话。 */
    private OAuth2AccessTokenDO issue() {
        return tokens.createAccessToken(user.getId(), UserTypeEnum.ADMIN.getValue(), OAuth2ClientConstants.CLIENT_ID_DEFAULT, null);
    }

    /** 从外部代理调用三种实际密码更新入口，不直接调用实现绕过事务。 */
    private void changePassword(PasswordChange change) {
        switch (change) {
            case PROFILE -> {
                UserProfileUpdatePasswordReqVO request = new UserProfileUpdatePasswordReqVO();
                request.setOldPassword(oldPassword);
                request.setNewPassword(newPassword);
                users.updateUserPassword(user.getId(), request);
            }
            case ADMIN -> users.updateUserPassword(user.getId(), newPassword, user.getUserType());
            case RECOVERY -> {
                SmsCodeDO code = createSms(SmsSceneEnum.ADMIN_MEMBER_RESET_PASSWORD.getScene());
                withHttpRequest(() -> {
                    auth.resetPassword(AuthResetPasswordReqVO.builder()
                            .mobile(user.getMobile()).code(code.getCode()).password(newPassword).build());
                    return null;
                });
            }
        }
    }

    /** 从实际普通登录或 OAuth 密码授权入口返回签发值。 */
    private String login(PasswordLogin login) {
        return withHttpRequest(() -> {
            if (login == PasswordLogin.OAUTH) {
                return grants.grantPassword(user.getUsername(), oldPassword, OAuth2ClientConstants.CLIENT_ID_DEFAULT, null)
                        .getAccessToken();
            }
            AuthLoginReqVO request = new AuthLoginReqVO();
            request.setUsername(user.getUsername());
            request.setPassword(oldPassword);
            AuthLoginRespVO response = login == PasswordLogin.SUPER ? auth.superAdminLogin(request) : auth.login(request);
            return response.getAccessToken();
        });
    }

    /** 绑定本线程独有的 HTTP 连接信息并恢复原上下文，支持真实短信及审计消费方。 */
    private <T> T withHttpRequest(Supplier<T> action) {
        MockHttpServletRequest httpRequest = new MockHttpServletRequest();
        httpRequest.setRemoteAddr(clientIp);
        httpRequest.addHeader("User-Agent", "authentication-integration-test");
        ServletRequestAttributes attributes = new ServletRequestAttributes(httpRequest);
        RequestAttributes previous = RequestContextHolder.getRequestAttributes();
        RequestContextHolder.setRequestAttributes(attributes);
        try {
            return action.get();
        } finally {
            RequestContextHolder.setRequestAttributes(previous);
            attributes.requestCompleted();
        }
    }

    /** 创建测试独有的真实短信挑战，避免调用付费短信供应商。 */
    private SmsCodeDO createSms(int scene) {
        SmsCodeDO code = SmsCodeDO.builder().mobile(user.getMobile()).scene(scene).createIp(clientIp)
                .code(String.format("%06d", new SecureRandom().nextInt(1_000_000)))
                .todayIndex(1).used(false).build();
        smsMapper.insert(code);
        ownBudget(code.getMobile(), clientIp, code.getId());
        return code;
    }

    /** 记录本测试真正拥有的 Redis 预算键，清理时不扫描或删除其他测试命名空间。 */
    private void ownBudget(String mobile, String ip, Long codeId) {
        String prefix = "sms_verify:{budget}:";
        ownedBudgetKeys.add(prefix + "mobile:" + DigestUtil.sha256Hex(mobile));
        ownedBudgetKeys.add(prefix + "ip:" + DigestUtil.sha256Hex(ip));
        if (codeId != null) {
            ownedBudgetKeys.add(prefix + "failure:" + DigestUtil.sha256Hex(mobile) + ":" + codeId);
        }
    }

    /** 构造由测试服务端注入可信 IP 的验证码消费请求。 */
    private SmsCodeUseReqDTO smsRequest(SmsCodeDO code, String supplied) {
        SmsCodeUseReqDTO request = new SmsCodeUseReqDTO();
        request.setMobile(code.getMobile());
        request.setScene(code.getScene());
        request.setCode(supplied);
        request.setUsedIp(clientIp);
        return request;
    }

    /** 返回竞争结果，只把预期的已消费冲突计作失败者。 */
    private boolean consumeSms(SmsCodeDO code) {
        try {
            smsCodes.useSmsCode(smsRequest(code, code.getCode()));
            return true;
        } catch (ServiceException exception) {
            assertThat(exception.getCode()).isEqualTo(SMS_CODE_USED.getCode());
            return false;
        }
    }

    /** 按稳定业务错误码断言失败，不以任意异常代替目标保护行为。 */
    private static void assertError(Runnable operation, int expectedCode) {
        assertThatThrownBy(operation::run).isInstanceOfSatisfying(ServiceException.class,
                exception -> assertThat(exception.getCode()).isEqualTo(expectedCode));
    }

    /** 独立验证访问与刷新两个可观察入口均拒绝被撤销会话。 */
    private void assertRevoked(OAuth2AccessTokenDO session) {
        assertThatThrownBy(() -> tokens.checkAccessToken(session.getAccessToken())).isInstanceOf(ServiceException.class);
        assertThatThrownBy(() -> tokens.refreshAccessToken(session.getRefreshToken(), session.getClientId()))
                .isInstanceOf(ServiceException.class);
    }

    /** 由 MySQL 锁等待视图证明两个操作确实竞争同一测试数据库的行锁。 */
    private void awaitDatabaseLockWait() {
        await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM performance_schema.data_lock_waits waits "
                        + "JOIN performance_schema.data_locks locks ON waits.REQUESTING_ENGINE_LOCK_ID = locks.ENGINE_LOCK_ID "
                        + "AND waits.ENGINE = locks.ENGINE WHERE locks.OBJECT_SCHEMA = ?", Long.class, schema)).isPositive());
    }

    /** 等待已知同步点，到期保留明确失败且恢复中断标志。 */
    private static void awaitLatch(CountDownLatch latch) {
        try {
            if (!latch.await(15, TimeUnit.SECONDS)) {
                throw new IllegalStateException("认证竞争测试同步点超时");
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("认证竞争测试被中断", exception);
        }
    }

    /** 等待自有线程真实终止，不把 shutdown 请求当成清理完成。 */
    private static void closeExecutor(ExecutorService executor) throws InterruptedException {
        executor.shutdownNow();
        assertThat(executor.awaitTermination(15, TimeUnit.SECONDS)).as("认证测试线程已退出").isTrue();
    }

    /** 三个面向用户的密码更新用例。 */
    private enum PasswordChange {
        /** 用户提交旧密码修改个人密码。 */
        PROFILE,
        /** 管理员跨会话重置目标用户密码。 */
        ADMIN,
        /** 用户凭短信验证码找回密码。 */
        RECOVERY
    }

    /** 实际存在的两类密码认证入口。 */
    private enum PasswordLogin {
        /** 普通管理平台账号密码登录。 */
        NORMAL,
        /** OAuth 客户端的密码授权。 */
        OAUTH,
        /** 超级管理平台的密码登录。 */
        SUPER
    }

    /** 启用与生产相同的声明式事务代理，其他基础设施由测试明确提供。 */
    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement(proxyTargetClass = true)
    static class TransactionConfiguration {
    }
}
