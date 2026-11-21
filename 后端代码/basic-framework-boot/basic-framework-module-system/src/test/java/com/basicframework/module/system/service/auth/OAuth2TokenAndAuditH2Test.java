package com.basicframework.module.system.service.auth;

import com.anji.captcha.service.CaptchaService;
import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.core.toolkit.GlobalConfigUtils;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.DataPermissionInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.basicframework.framework.common.biz.system.permission.PermissionCommonApi;
import com.basicframework.framework.common.biz.system.permission.dto.DeptDataPermissionRespDTO;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.framework.datapermission.core.aop.DataPermissionAnnotationAdvisor;
import com.basicframework.framework.datapermission.core.aop.DataPermissionContextHolder;
import com.basicframework.framework.datapermission.core.db.DataPermissionRuleHandler;
import com.basicframework.framework.datapermission.core.rule.DataPermissionRuleFactoryImpl;
import com.basicframework.framework.datapermission.core.rule.dept.DeptDataPermissionRule;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.framework.mybatis.core.util.MyBatisUtils;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.basicframework.module.system.api.sms.SmsCodeApi;
import com.basicframework.module.system.controller.admin.auth.vo.AuthResetPasswordReqVO;
import com.basicframework.module.system.controller.admin.oauth2.vo.token.OAuth2AccessTokenPageReqVO;
import com.basicframework.module.system.dal.dataobject.logger.LoginLogDO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.dal.mysql.dept.DeptMapper;
import com.basicframework.module.system.dal.mysql.logger.LoginLogMapper;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2AccessTokenMapper;
import com.basicframework.module.system.dal.mysql.user.AdminUserMapper;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.logger.LoginLogTypeEnum;
import com.basicframework.module.system.enums.logger.LoginResultEnum;
import com.basicframework.module.system.framework.datapermission.config.DataPermissionConfiguration;
import com.basicframework.module.system.framework.security.audit.SecurityAuditService;
import com.basicframework.module.system.framework.security.login.LoginFailureLockService;
import com.basicframework.module.system.framework.security.login.SmsLoginFailureLockService;
import com.basicframework.module.system.service.logger.LoginLogService;
import com.basicframework.module.system.service.logger.LoginLogServiceImpl;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import com.basicframework.module.system.service.permission.PermissionService;
import com.basicframework.module.system.service.user.AdminUserService;
import com.basicframework.module.system.service.user.AdminUserServiceImpl;
import jakarta.validation.Validator;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSessionFactory;
import org.h2.Driver;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.SqlSessionTemplate;
import org.mybatis.spring.transaction.SpringManagedTransactionFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.SimpleDriverDataSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;
import org.springframework.validation.beanvalidation.MethodValidationPostProcessor;
import org.springframework.web.context.request.RequestContextHolder;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.when;

/**
 * 基于 H2 MySQL 兼容模式的真实 SQL 与 Spring 事务边界集成测试。
 * 验证可选状态查询、令牌分页平台与部门数据权限 SQL 下推，以及重置密码失败审计的独立事务提交。
 *
 * @author shady2713
 */
@SpringJUnitConfig(OAuth2TokenAndAuditH2Test.TestConfig.class)
class OAuth2TokenAndAuditH2Test {

    @Autowired private DataSource dataSource;
    @Autowired private AdminUserMapper adminUserMapper;
    @Autowired private OAuth2AccessTokenMapper oauth2AccessTokenMapper;
    @Autowired private LoginLogMapper loginLogMapper;
    @Autowired private AdminAuthService adminAuthService;
    @Autowired private PermissionCommonApi permissionCommonApi;
    @Autowired private AdminUserService adminUserService;
    @Autowired private SmsCodeApi smsCodeApi;
    @Autowired private SecurityAuditService securityAuditService;

    /** 每个用例前清空测试表与 Mock 状态。 */
    @BeforeEach
    void setUp() throws Exception {
        clearContexts();
        reset(permissionCommonApi, adminUserService, smsCodeApi);
        try (Connection conn = dataSource.getConnection(); Statement stmt = conn.createStatement()) {
            for (String table : List.of("system_login_log", "system_oauth2_access_token", "system_users", "system_dept")) {
                stmt.execute("DELETE FROM " + table);
            }
        }
    }

    /** 每个用例后清理安全、数据权限和请求上下文。 */
    @AfterEach
    void clearContexts() {
        SecurityContextHolder.clearContext();
        DataPermissionContextHolder.clear();
        RequestContextHolder.resetRequestAttributes();
    }

    /** 验证 status 为 null 时查询全部启用/停用状态且保留历史空平台类型兼容语义。 */
    @Test
    void selectListByStatusAndUserTypeShouldSupportNullStatus() {
        insertUser("biz_on", "13800000001", 10L, CommonStatusEnum.ENABLE.getStatus(), "business_admin");
        insertUser("biz_off", "13800000002", 10L, CommonStatusEnum.DISABLE.getStatus(), "business_admin");
        insertUser("legacy_null", "13800000003", 10L, CommonStatusEnum.DISABLE.getStatus(), null);
        insertUser("legacy_empty", "13800000004", 10L, CommonStatusEnum.ENABLE.getStatus(), "");
        insertUser("super_on", "13800000005", 10L, CommonStatusEnum.ENABLE.getStatus(), "super_admin");
        List<AdminUserDO> users = adminUserMapper.selectListByStatusAndUserType(
                null, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        assertThat(users).extracting(AdminUserDO::getUsername)
                .containsExactlyInAnyOrder("biz_on", "biz_off", "legacy_null", "legacy_empty");
    }

    /** 验证令牌分页在数据库端按平台类型和 {@code system_users} 部门数据权限联合过滤。 */
    @Test
    void selectPageByPlatformShouldFilterPlatformAndDeptInSql() {
        AdminUserDO d10 = insertUser("u10", "13800000010", 10L, 0, "business_admin");
        AdminUserDO d20 = insertUser("u20", "13800000020", 20L, 0, "business_admin");
        AdminUserDO sup = insertUser("usup", "13800000030", 10L, 0, "super_admin");
        insertToken(d10.getId(), UserTypeEnum.ADMIN.getValue(), "tok-d10", LocalDateTime.now().plusMinutes(30));
        insertToken(d10.getId(), UserTypeEnum.ADMIN.getValue(), "tok-exp", LocalDateTime.now().minusMinutes(5));
        insertToken(d10.getId(), UserTypeEnum.MEMBER.getValue(), "tok-mem", LocalDateTime.now().plusMinutes(30));
        insertToken(d20.getId(), UserTypeEnum.ADMIN.getValue(), "tok-d20", LocalDateTime.now().plusMinutes(30));
        insertToken(sup.getId(), UserTypeEnum.ADMIN.getValue(), "tok-sup", LocalDateTime.now().plusMinutes(30));

        OAuth2AccessTokenPageReqVO reqVO = new OAuth2AccessTokenPageReqVO();
        SecurityFrameworkUtils.setLoginUser(adminUser(9001L), new MockHttpServletRequest());
        when(permissionCommonApi.getDeptDataPermission(9001L)).thenReturn(perm(true, Set.of()));
        PageResult<OAuth2AccessTokenDO> allPage = oauth2AccessTokenMapper.selectPageByPlatform(reqVO, "business_admin");
        assertThat(allPage.getList()).extracting(OAuth2AccessTokenDO::getAccessToken)
                .containsExactlyInAnyOrder("tok-d10", "tok-d20");

        SecurityFrameworkUtils.setLoginUser(adminUser(9002L), new MockHttpServletRequest());
        when(permissionCommonApi.getDeptDataPermission(9002L)).thenReturn(perm(false, Set.of(10L)));
        PageResult<OAuth2AccessTokenDO> deptPage = oauth2AccessTokenMapper.selectPageByPlatform(reqVO, "business_admin");
        assertThat(deptPage.getTotal()).isEqualTo(1L);
        assertThat(deptPage.getList()).extracting(OAuth2AccessTokenDO::getAccessToken).containsExactly("tok-d10");
    }

    /** 验证密码重置外层事务回滚时，{@code REQUIRES_NEW} 失败审计仍独立提交到数据库。 */
    @Test
    void resetPasswordFailureShouldRollbackOuterTxWhileCommittingAuditLog() {
        doThrow(exception(ErrorCodeConstants.SMS_CODE_NOT_FOUND)).when(smsCodeApi).useSmsCode(any());
        assertThatThrownBy(() -> adminAuthService.resetPassword(new AuthResetPasswordReqVO("enc", "13900001111", "0")))
                .isInstanceOf(ServiceException.class);
        List<LoginLogDO> firstLogs = loginLogMapper.selectList();
        assertThat(firstLogs).hasSize(1);
        assertThat(firstLogs.get(0).getLogType()).isEqualTo(LoginLogTypeEnum.PASSWORD_RESET.getType());
        assertThat(firstLogs.get(0).getResult()).isEqualTo(LoginResultEnum.SMS_CODE_ERROR.getResult());
        assertThat(firstLogs.get(0).getUserId()).isZero();
        assertThat(firstLogs.get(0).getUserIp()).isEmpty();

        AdminUserDO sup = insertUser("super_reset", "13900002222", 10L, 0, "super_admin");
        when(adminUserService.getUserByMobile("13900002222")).thenAnswer(i -> adminUserMapper.selectByMobile("13900002222"));
        doAnswer(inv -> {
            AdminUserDO patch = new AdminUserDO();
            patch.setId(sup.getId());
            patch.setRemark("dirty-before-rollback");
            adminUserMapper.updateById(patch);
            return null;
        }).when(smsCodeApi).useSmsCode(any());
        assertThatThrownBy(() -> adminAuthService.resetPassword(new AuthResetPasswordReqVO("enc", "13900002222", "1")))
                .isInstanceOf(ServiceException.class);
        assertThat(adminUserMapper.selectById(sup.getId()).getRemark()).isEqualTo("init");
        assertThat(loginLogMapper.selectList()).hasSize(2).anySatisfy(row -> {
            assertThat(row.getUserId()).isEqualTo(sup.getId());
            assertThat(row.getResult()).isEqualTo(LoginResultEnum.BAD_CREDENTIALS.getResult());
        });
    }

    /** 验证受保护的账号管理操作在 H2 真实 SQL 数据权限过滤下拒绝跨部门修改并放行同部门操作。 */
    @Test
    @SuppressWarnings("unchecked")
    void adminUserProtectedOperationsShouldEnforceRealDeptDataScope() {
        AdminUserDO dept10User = insertUser("scope_d10", "13900003331", 10L, 0, "business_admin");
        AdminUserDO dept20User = insertUser("scope_d20", "13900003332", 20L, 0, "business_admin");
        AdminUserServiceImpl realUserService = new AdminUserServiceImpl();
        ObjectProvider<PermissionService> permProvider = mock(ObjectProvider.class);
        when(permProvider.getIfAvailable()).thenReturn(mock(PermissionService.class));
        ReflectionTestUtils.setField(realUserService, "userMapper", adminUserMapper);
        ReflectionTestUtils.setField(realUserService, "permissionServiceProvider", permProvider);
        ReflectionTestUtils.setField(realUserService, "applicationContext", mock(ApplicationContext.class));
        ReflectionTestUtils.setField(realUserService, "passwordEncoder", new BCryptPasswordEncoder(4));
        ReflectionTestUtils.setField(realUserService, "securityAuditService", securityAuditService);

        SecurityFrameworkUtils.setLoginUser(adminUser(9010L), new MockHttpServletRequest());
        when(permissionCommonApi.getDeptDataPermission(9010L)).thenReturn(perm(false, Set.of(10L)));
        assertThatThrownBy(() -> realUserService.updateUserStatus(dept20User.getId(), 1, "business_admin"))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ErrorCodeConstants.USER_NOT_EXISTS.getCode()));
        assertThatThrownBy(() -> realUserService.updateUserPassword(dept20User.getId(), "New#Pass1", "business_admin"))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ErrorCodeConstants.USER_NOT_EXISTS.getCode()));
        assertThatThrownBy(() -> realUserService.deleteUser(dept20User.getId(), "business_admin"))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ErrorCodeConstants.USER_NOT_EXISTS.getCode()));

        realUserService.updateUserStatus(dept10User.getId(), 1, "business_admin");
        SecurityFrameworkUtils.setLoginUser(adminUser(9011L), new MockHttpServletRequest());
        when(permissionCommonApi.getDeptDataPermission(9011L)).thenReturn(perm(true, Set.of()));
        assertThat(adminUserMapper.selectById(dept20User.getId()).getStatus()).isEqualTo(0);
        assertThat(adminUserMapper.selectById(dept10User.getId()).getStatus()).isEqualTo(1);
    }

    /** 插入测试用户。 */
    private AdminUserDO insertUser(String username, String mobile, Long deptId, Integer status, String userType) {
        AdminUserDO u = AdminUserDO.builder().username(username).password("pwd").passwordChangeRequired(false)
                .userType(userType).nickname(username).remark("init").deptId(deptId).mobile(mobile).status(status).build();
        u.setDeletedTag(0L);
        adminUserMapper.insert(u);
        return u;
    }

    /** 插入测试访问令牌。 */
    private void insertToken(Long userId, Integer userType, String token, LocalDateTime expiresTime) {
        OAuth2AccessTokenDO t = new OAuth2AccessTokenDO();
        t.setUserId(userId);
        t.setUserType(userType);
        t.setUserInfo(Map.of());
        t.setAccessToken(token);
        t.setRefreshToken("rf-" + token);
        t.setClientId("default");
        t.setExpiresTime(expiresTime);
        oauth2AccessTokenMapper.insert(t);
    }

    /** 构造管理员测试登录身份。 */
    private static LoginUser adminUser(Long id) {
        LoginUser u = new LoginUser();
        u.setId(id);
        u.setUserType(UserTypeEnum.ADMIN.getValue());
        return u;
    }

    /** 构造部门数据权限响应对象。 */
    private static DeptDataPermissionRespDTO perm(boolean all, Set<Long> deptIds) {
        DeptDataPermissionRespDTO dto = new DeptDataPermissionRespDTO();
        dto.setAll(all);
        dto.setDeptIds(deptIds);
        return dto;
    }

    /** 组装 H2 数据源、Spring 事务、MyBatis-Plus 数据权限链与目标服务的测试配置。 */
    @Configuration
    @EnableTransactionManagement(proxyTargetClass = true)
    static class TestConfig {

        /** 创建 H2 MySQL 兼容内存数据源并初始化测试表结构。 */
        @Bean
        DataSource dataSource() throws Exception {
            String url = "jdbc:h2:mem:oauth2_audit_" + UUID.randomUUID()
                    + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;NON_KEYWORDS=VALUE,KEY,USER;DB_CLOSE_DELAY=-1";
            SimpleDriverDataSource ds = new SimpleDriverDataSource(new Driver(), url, "sa", "");
            String auditCols = "creator VARCHAR(64) DEFAULT '', create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,"
                    + " updater VARCHAR(64) DEFAULT '', update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted SMALLINT NOT NULL DEFAULT 0";
            try (Connection c = ds.getConnection(); Statement s = c.createStatement()) {
                s.execute("CREATE TABLE system_dept (id BIGINT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(30) NOT NULL,"
                        + " parent_id BIGINT NOT NULL DEFAULT 0, role_type VARCHAR(32) NOT NULL DEFAULT 'business_admin',"
                        + " sort INT NOT NULL DEFAULT 0, leader_user_id BIGINT, phone VARCHAR(11), email VARCHAR(50), status SMALLINT NOT NULL DEFAULT 0, " + auditCols + ")");
                s.execute("CREATE TABLE system_users (id BIGINT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(30) NOT NULL,"
                        + " password VARCHAR(100) NOT NULL DEFAULT '', password_change_required SMALLINT NOT NULL DEFAULT 0,"
                        + " user_type VARCHAR(32) NULL, nickname VARCHAR(30) NOT NULL DEFAULT '', remark VARCHAR(500), dept_id BIGINT,"
                        + " post_ids VARCHAR(255), email VARCHAR(50) DEFAULT '', mobile VARCHAR(11) DEFAULT '', sex SMALLINT DEFAULT 0,"
                        + " avatar VARCHAR(512) DEFAULT '', status SMALLINT NOT NULL DEFAULT 0, login_ip VARCHAR(50) DEFAULT '', login_date TIMESTAMP,"
                        + " deleted_tag BIGINT NOT NULL DEFAULT 0, " + auditCols + ")");
                s.execute("CREATE TABLE system_oauth2_access_token (id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id BIGINT NOT NULL DEFAULT 0,"
                        + " user_type SMALLINT NOT NULL, user_info VARCHAR(512) NOT NULL, access_token VARCHAR(255) NOT NULL,"
                        + " refresh_token VARCHAR(32) NOT NULL, client_id VARCHAR(255) NOT NULL, scopes VARCHAR(255), expires_time TIMESTAMP NOT NULL, " + auditCols + ")");
                s.execute("CREATE TABLE system_login_log (id BIGINT AUTO_INCREMENT PRIMARY KEY, log_type INT NOT NULL, trace_id VARCHAR(64) NOT NULL DEFAULT '',"
                        + " user_id BIGINT NOT NULL DEFAULT 0, user_type SMALLINT NOT NULL DEFAULT 0, username VARCHAR(50) NOT NULL DEFAULT '',"
                        + " result SMALLINT NOT NULL, user_ip VARCHAR(50) NOT NULL, user_agent VARCHAR(512) NOT NULL, " + auditCols + ")");
            }
            return ds;
        }

        /** 注册 Spring JDBC 事务管理器。 */
        @Bean PlatformTransactionManager transactionManager(DataSource ds) { return new DataSourceTransactionManager(ds); }
        /** 注册分页与数据权限共用的 MyBatis-Plus 拦截器链。 */
        @Bean MybatisPlusInterceptor mybatisPlusInterceptor() {
            MybatisPlusInterceptor i = new MybatisPlusInterceptor();
            i.addInnerInterceptor(new PaginationInnerInterceptor(DbType.H2));
            return i;
        }

        /** 构建 Spring 事务感知的 SqlSessionFactory 并注册目标 Mapper。 */
        @Bean SqlSessionFactory sqlSessionFactory(DataSource ds, MybatisPlusInterceptor interceptor) {
            JacksonTypeHandler.setObjectMapper(JsonUtils.getObjectMapper());
            MybatisConfiguration cfg = new MybatisConfiguration(new Environment("test", new SpringManagedTransactionFactory(), ds));
            cfg.setMapUnderscoreToCamelCase(true);
            cfg.addInterceptor(interceptor);
            GlobalConfig gc = GlobalConfigUtils.defaults();
            gc.setBanner(false);
            gc.setMetaObjectHandler(new DefaultDBFieldHandler());
            gc.getDbConfig().setIdType(IdType.AUTO);
            gc.getDbConfig().setLogicDeleteField("deleted");
            gc.getDbConfig().setLogicDeleteValue("1");
            gc.getDbConfig().setLogicNotDeleteValue("0");
            GlobalConfigUtils.setGlobalConfig(cfg, gc);
            for (Class<?> m : List.of(DeptMapper.class, AdminUserMapper.class, OAuth2AccessTokenMapper.class, LoginLogMapper.class)) {
                cfg.addMapper(m);
            }
            return new MybatisSqlSessionFactoryBuilder().build(cfg);
        }

        /** 注册 Spring 事务感知的 SqlSessionTemplate。 */
        @Bean SqlSessionTemplate sqlSessionTemplate(SqlSessionFactory f) { return new SqlSessionTemplate(f); }
        /** 注册 AdminUserMapper。 */
        @Bean AdminUserMapper adminUserMapper(SqlSessionTemplate t) { return t.getMapper(AdminUserMapper.class); }
        /** 注册 OAuth2AccessTokenMapper。 */
        @Bean OAuth2AccessTokenMapper oauth2AccessTokenMapper(SqlSessionTemplate t) { return t.getMapper(OAuth2AccessTokenMapper.class); }
        /** 注册 LoginLogMapper。 */
        @Bean LoginLogMapper loginLogMapper(SqlSessionTemplate t) { return t.getMapper(LoginLogMapper.class); }
        /** 注册 Mock 权限 API。 */
        @Bean PermissionCommonApi permissionCommonApi() { return mock(PermissionCommonApi.class); }
        /** 在 TableInfo 就绪后注册部门数据权限规则。 */
        @Bean DeptDataPermissionRule deptDataPermissionRule(PermissionCommonApi api, SqlSessionFactory ignored) {
            DeptDataPermissionRule rule = new DeptDataPermissionRule(api);
            new DataPermissionConfiguration().sysDeptDataPermissionRuleCustomizer().customize(rule);
            return rule;
        }
        /** 注册数据权限拦截器到分页插件之前。 */
        @Bean DataPermissionRuleHandler dataPermissionRuleHandler(MybatisPlusInterceptor i, DeptDataPermissionRule rule) {
            DataPermissionRuleHandler h = new DataPermissionRuleHandler(new DataPermissionRuleFactoryImpl(List.of(rule)));
            MyBatisUtils.addInterceptor(i, new DataPermissionInterceptor(h), 0);
            return h;
        }
        /** 注册数据权限注解切面。 */
        @Bean DataPermissionAnnotationAdvisor dataPermissionAnnotationAdvisor() { return new DataPermissionAnnotationAdvisor(); }
        /** 注册方法级参数校验处理器。 */
        @Bean static MethodValidationPostProcessor methodValidationPostProcessor() { return new MethodValidationPostProcessor(); }
        /** 注册 Bean Validation 验证器。 */
        @Bean Validator validator() { return new LocalValidatorFactoryBean(); }
        /** 注册真实登录日志服务。 */
        @Bean LoginLogService loginLogService() { return new LoginLogServiceImpl(); }
        /** 注册安全审计服务。 */
        @Bean SecurityAuditService securityAuditService(LoginLogService s) { return new SecurityAuditService(s); }
        /** 注册 Mock 用户服务。 */
        @Bean AdminUserService adminUserService() { return mock(AdminUserService.class); }
        /** 注册 Mock 令牌服务。 */
        @Bean OAuth2TokenService oauth2TokenService() { return mock(OAuth2TokenService.class); }
        /** 注册 Mock 验证码服务。 */
        @Bean CaptchaService captchaService() { return mock(CaptchaService.class); }
        /** 注册 Mock 短信验证码服务。 */
        @Bean SmsCodeApi smsCodeApi() { return mock(SmsCodeApi.class); }
        /** 注册 Mock 账号锁定服务。 */
        @Bean LoginFailureLockService loginFailureLockService() { return mock(LoginFailureLockService.class); }
        /** 注册 Mock 短信锁定服务。 */
        @Bean SmsLoginFailureLockService smsLoginFailureLockService() { return mock(SmsLoginFailureLockService.class); }
        /** 注册真实认证服务。 */
        @Bean AdminAuthService adminAuthService() { return new AdminAuthServiceImpl(); }
    }
}
