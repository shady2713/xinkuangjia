package com.basicframework.module.system.service.user;

import cn.hutool.extra.spring.SpringUtil;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.basicframework.framework.common.api.config.ConfigApi;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.module.system.controller.admin.auth.vo.AuthRegisterReqVO;
import com.basicframework.module.system.controller.admin.user.vo.profile.UserProfileUpdatePasswordReqVO;
import com.basicframework.module.system.controller.admin.user.vo.profile.UserProfileUpdateReqVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserImportExcelVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserImportRespVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserPageReqVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserSaveReqVO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.dal.mysql.dept.DeptMapper;
import com.basicframework.module.system.dal.mysql.dept.UserPostMapper;
import com.basicframework.module.system.dal.mysql.permission.MenuMapper;
import com.basicframework.module.system.dal.mysql.permission.RoleMapper;
import com.basicframework.module.system.dal.mysql.permission.RoleMenuMapper;
import com.basicframework.module.system.dal.mysql.permission.UserRoleMapper;
import com.basicframework.module.system.dal.mysql.user.AdminUserMapper;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.framework.auth.config.AdminAuthenticationProperties;
import com.basicframework.module.system.mq.message.user.UserStatusChangedEvent;
import com.basicframework.module.system.service.dept.DeptService;
import com.basicframework.module.system.service.dept.DeptServiceImpl;
import com.basicframework.module.system.service.dept.PostService;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import com.basicframework.module.system.service.permission.MenuService;
import com.basicframework.module.system.service.permission.MenuServiceImpl;
import com.basicframework.module.system.service.permission.PermissionService;
import com.basicframework.module.system.service.permission.PermissionServiceImpl;
import com.basicframework.module.system.service.permission.RoleService;
import com.basicframework.module.system.service.permission.RoleServiceImpl;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.mybatis.spring.mapper.MapperFactoryBean;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.concurrent.ConcurrentMapCacheManager;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ApplicationListener;
import org.springframework.context.PayloadApplicationEvent;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.AnnotationConfigUtils;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.EnableAspectJAutoProxy;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.annotation.EnableTransactionManagement;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.basicframework.module.system.enums.ErrorCodeConstants.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;

/**
 * 用独立 MySQL 库、生产 DDL、真实 Mapper 与真实事务验证后台用户服务的写读契约。
 *
 * <p>后台用户服务是账号生命周期的唯一入口，它的边界必须落在真实持久化上：</p>
 * <ul>
 *   <li>创建与导入必须使用可信的登录平台写入 {@code user_type}，并把密码按当前协议加密后落库，
 *       不能把请求体里的平台字段或明文口令写进数据库。</li>
 *   <li>更新、改密、删除与状态变更都必须先校验平台归属；跨平台目标必须在任何写入前拒绝。</li>
 *   <li>岗位关联、角色关联与会话撤销属于同一次操作的副作用，必须在同一数据库状态里可核对。</li>
 *   <li>批量删除必须先整体校验再整体执行，混合跨平台编号时不得删掉合法用户。</li>
 * </ul>
 *
 * <p>跨模块的岗位校验、参数配置与令牌撤销使用接口替身（真实实现分别属于本模块之外的调用链），
 * 其余断言全部落在真实 SQL 结果、真实事件与真实 BCrypt 摘要上。显式执行此集成入口必须提供
 * 环回隔离 MySQL，缺失环境直接失败，不连接业务库。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AdminUserServiceImplMySqlIT {

    /** 用例需要导入的生产表，全部来自空库基线。 */
    private static final List<String> TABLES = List.of("system_users", "system_dept", "system_user_post",
            "system_role", "system_menu", "system_user_role", "system_role_menu");
    /** 创建用户时使用的明文口令摘要（浏览器侧已 MD5），只作为测试输入使用。 */
    private static final String PLAIN_PASSWORD = "DUMMY-md5-digest-0001";
    /** 导入用户的初始口令，由参数配置提供。 */
    private static final String INIT_PASSWORD = "DUMMY-md5-digest-init";

    private final String schema = "bf_adminuser_" + UUID.randomUUID().toString().replace("-", "");
    private AnnotationConfigApplicationContext context;
    private JdbcTemplate jdbc;
    private AdminUserService users;
    private PasswordEncoder passwordEncoder;
    private PostService postService;
    private OAuth2TokenService oauth2TokenService;
    private StubConfigApi configApi;
    private AdminAuthenticationProperties authenticationProperties;
    private UserStatusListener statusListener;
    private String adminUrl;
    private String databaseUser;
    private String databasePassword;
    private boolean schemaCreated;
    private Object previousSpringBeanFactory;
    private Object previousSpringContext;

    /** 建立随机库、真实上下文与全部生产 Mapper，缺失环境时直接失败。 */
    @BeforeAll
    void startEnvironment() throws Exception {
        adminUrl = requiredEnvironment("AUTH_TEST_MYSQL_URL");
        if (!adminUrl.matches("jdbc:mysql://(?:127\\.0\\.0\\.1|localhost):[0-9]+/(?:\\?.*)?")) {
            throw new IllegalArgumentException("测试 MySQL 必须位于环回地址且 URL 不得包含数据库名");
        }
        databaseUser = requiredEnvironment("AUTH_TEST_MYSQL_USERNAME");
        databasePassword = requiredEnvironment("AUTH_TEST_MYSQL_PASSWORD");
        try (Connection connection = DriverManager.getConnection(adminUrl, databaseUser, databasePassword);
             Statement statement = connection.createStatement()) {
            statement.execute("CREATE DATABASE `" + schema + "` CHARACTER SET utf8mb4");
            schemaCreated = true;
        }
        String[] parts = adminUrl.split("\\?", 2);
        DataSource dataSource = new DriverManagerDataSource(
                parts[0] + schema + (parts.length == 2 ? "?" + parts[1] : ""), databaseUser, databasePassword);
        jdbc = new JdbcTemplate(dataSource);
        String ddl = Files.readString(schemaSource());
        for (String table : TABLES) {
            Matcher matcher = Pattern.compile("CREATE TABLE `" + table + "`[\\s\\S]*?;").matcher(ddl);
            assertThat(matcher.find()).as("生产表 %s 必须存在", table).isTrue();
            jdbc.execute(matcher.group());
        }

        passwordEncoder = new BCryptPasswordEncoder();
        postService = mock(PostService.class);
        oauth2TokenService = mock(OAuth2TokenService.class);
        configApi = new StubConfigApi();
        authenticationProperties = new AdminAuthenticationProperties();
        statusListener = new UserStatusListener();

        previousSpringBeanFactory = ReflectionTestUtils.getField(SpringUtil.class, "beanFactory");
        previousSpringContext = ReflectionTestUtils.getField(SpringUtil.class, "applicationContext");
        context = new AnnotationConfigApplicationContext();
        context.registerBean(SpringUtil.class);
        context.register(TransactionConfiguration.class);
        context.removeBeanDefinition(AnnotationConfigUtils.COMMON_ANNOTATION_PROCESSOR_BEAN_NAME);
        context.registerBean(PlatformTransactionManager.class, () -> new DataSourceTransactionManager(dataSource));
        context.registerBean(DataSource.class, () -> dataSource);
        context.registerBean(CacheManager.class, () -> new ConcurrentMapCacheManager());
        context.registerBean(SqlSessionFactory.class, () -> sqlSessionFactory(dataSource));
        for (Class<?> type : List.of(AdminUserMapper.class, UserPostMapper.class, DeptMapper.class,
                UserRoleMapper.class, RoleMapper.class, MenuMapper.class, RoleMenuMapper.class)) {
            registerMapper(type);
        }
        context.registerBean(ConfigApi.class, () -> configApi);
        context.registerBean(AdminAuthenticationProperties.class, () -> authenticationProperties);
        context.registerBean(PasswordEncoder.class, () -> passwordEncoder);
        context.registerBean(OAuth2TokenService.class, () -> oauth2TokenService);
        context.registerBean(UserStatusListener.class, () -> statusListener);
        context.registerBean(DeptService.class, () -> {
            DeptServiceImpl service = wire(new DeptServiceImpl(), "deptMapper", context.getBean(DeptMapper.class));
            return wire(service, "userServiceProvider", context.getBeanProvider(AdminUserService.class));
        });
        context.registerBean(RoleService.class, () -> wire(new RoleServiceImpl(), "roleMapper",
                context.getBean(RoleMapper.class)));
        context.registerBean(MenuService.class, () -> wire(new MenuServiceImpl(), "menuMapper",
                context.getBean(MenuMapper.class)));
        context.registerBean(AdminUserService.class, () -> {
            AdminUserServiceImpl service = new AdminUserServiceImpl();
            wire(service, "userMapper", context.getBean(AdminUserMapper.class));
            wire(service, "userPostMapper", context.getBean(UserPostMapper.class));
            wire(service, "deptService", context.getBean(DeptService.class));
            wire(service, "postService", postService);
            wire(service, "permissionServiceProvider", context.getBeanProvider(PermissionService.class));
            wire(service, "passwordEncoder", passwordEncoder);
            wire(service, "applicationContext", context);
            wire(service, "configApi", configApi);
            wire(service, "authenticationProperties", authenticationProperties);
            wire(service, "oauth2TokenServiceProvider", context.getBeanProvider(OAuth2TokenService.class));
            return service;
        });
        context.registerBean(PermissionService.class, () -> {
            PermissionServiceImpl service = new PermissionServiceImpl();
            wire(service, "userService", context.getBean(AdminUserService.class));
            wire(service, "roleService", context.getBean(RoleService.class));
            wire(service, "menuService", context.getBean(MenuService.class));
            wire(service, "deptService", context.getBean(DeptService.class));
            wire(service, "roleMenuMapper", context.getBean(RoleMenuMapper.class));
            return wire(service, "userRoleMapper", context.getBean(UserRoleMapper.class));
        });
        context.refresh();
        users = context.getBean(AdminUserService.class);
    }

    /** 关闭上下文、还原静态 Spring 上下文并删除随机库。 */
    @AfterAll
    void closeEnvironment() throws Exception {
        try {
            if (context != null) {
                context.close();
                ReflectionTestUtils.setField(SpringUtil.class, "beanFactory", previousSpringBeanFactory);
                ReflectionTestUtils.setField(SpringUtil.class, "applicationContext", previousSpringContext);
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

    /** 每例清空全部表与缓存，写入两个部门、四个用户与三个角色的固定夹具。 */
    @BeforeEach
    void seedFixtures() {
        reset(oauth2TokenService);
        statusListener.events.clear();
        configApi.values.clear();
        authenticationProperties.setRegistrationEnabled(false);
        CacheManager cacheManager = context.getBean(CacheManager.class);
        cacheManager.getCacheNames().forEach(name -> cacheManager.getCache(name).clear());
        for (String table : TABLES) {
            jdbc.update("DELETE FROM " + table);
        }
        jdbc.update("INSERT INTO system_dept (id,name,parent_id,role_type,status) VALUES "
                + "(10,'本部门',0,'business_admin',0),(20,'子部门',10,'business_admin',0),"
                + "(30,'另一平台部门',0,'super_admin',0)");
        jdbc.update("INSERT INTO system_users (id,username,password,nickname,dept_id,user_type,status,avatar) VALUES "
                + "(1,'accountone','stored-digest','user_one',10,'business_admin',0,'https://files.example.test/a.png'),"
                + "(2,'accounttwo','stored-digest','user_two',10,'business_admin',0,"
                + "'https://files.example.test/two.png'),"
                + "(3,'accountthree','stored-digest','user_three',20,'business_admin',1,''),"
                + "(4,'accountfour','stored-digest','user_four',30,'super_admin',0,'')");
        jdbc.update("INSERT INTO system_role (id,name,code,role_type,sort,status,type,data_scope) VALUES "
                + "(1,'业务角色','test_business','business_admin',0,0,2,5),"
                + "(2,'另一平台角色','test_other','super_admin',0,0,2,1)");
        jdbc.update("INSERT INTO system_menu (id,name,permission,menu_type,type,sort,parent_id,path,status) "
                + "VALUES (1,'业务菜单','test:read','business_admin',3,0,0,'',0)");
    }

    /** 创建用户必须写入可信平台、加密口令、默认启用状态与岗位关联。 */
    @Test
    void createUserPersistsTrustedPlatformHashedPasswordAndPosts() {
        UserSaveReqVO request = createRequest("createdone");
        request.setDeptId(10L);
        request.setPostIds(Set.of(100L, 200L));

        Long id = asActorResult(1L, () -> users.createUser(request, null));

        assertThat(id).isNotNull();
        Map<String, Object> row = jdbc.queryForMap("SELECT username, user_type, status, dept_id, password, post_ids "
                + "FROM system_users WHERE id = ?", id);
        assertThat(row.get("username")).isEqualTo("createdone");
        assertThat(row.get("user_type")).as("请求未指定平台时必须写入当前业务平台")
                .isEqualTo(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        assertThat(row.get("status")).isEqualTo(0);
        assertThat(row.get("dept_id")).isEqualTo(10L);
        assertThat((String) row.get("password")).as("不得写入明文摘要")
                .isNotEqualTo(PLAIN_PASSWORD).startsWith("$2");
        assertThat(passwordEncoder.matches(PLAIN_PASSWORD, (String) row.get("password"))).isTrue();
        assertThat((String) row.get("post_ids")).contains("100").contains("200");
        assertThat(jdbc.queryForList("SELECT post_id FROM system_user_post WHERE user_id = ? AND deleted = 0",
                Long.class, id)).containsExactlyInAnyOrder(100L, 200L);
    }

    /** 账号、手机号与邮箱在各自口径下重复时必须分别拒绝，且不留下半条用户记录。 */
    @Test
    void createUserRejectsDuplicateUsernameMobileAndEmail() {
        asActor(1L, () -> {
            UserSaveReqVO duplicatedUsername = createRequest("accountone");
            assertBusinessError(() -> users.createUser(duplicatedUsername, "business_admin"),
                    USER_USERNAME_EXISTS.getCode());

            UserSaveReqVO duplicatedMobile = createRequest("createdmobile");
            duplicatedMobile.setMobile("13800138000");
            users.createUser(duplicatedMobile, "business_admin");
            UserSaveReqVO sameMobile = createRequest("createdmobile_two");
            sameMobile.setMobile("13800138000");
            assertBusinessError(() -> users.createUser(sameMobile, "business_admin"), USER_MOBILE_EXISTS.getCode());

            UserSaveReqVO duplicatedEmail = createRequest("createdemail");
            duplicatedEmail.setEmail("probe@example.test");
            users.createUser(duplicatedEmail, "business_admin");
            UserSaveReqVO sameEmail = createRequest("createdemail_two");
            sameEmail.setEmail("probe@example.test");
            assertBusinessError(() -> users.createUser(sameEmail, "business_admin"), USER_EMAIL_EXISTS.getCode());
        });

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_users WHERE deleted = 0", Integer.class))
                .as("被拒绝的创建不得留下任何用户").isEqualTo(6);
    }

    /** 更新用户必须写入字段差异并只调整岗位关联差异，未提交的头像保持原值。 */
    @Test
    void updateUserPersistsFieldAndPostDifferences() {
        jdbc.update("INSERT INTO system_user_post (user_id,post_id) VALUES (2,100)");
        UserSaveReqVO request = createRequest("accounttwo");
        request.setId(2L);
        request.setNickname("updated_two");
        request.setDeptId(20L);
        request.setPostIds(Set.of(200L));

        asActor(1L, () -> users.updateUser(request, "business_admin"));

        Map<String, Object> row = jdbc.queryForMap("SELECT nickname, dept_id, avatar FROM system_users WHERE id = 2");
        assertThat(row.get("nickname")).isEqualTo("updated_two");
        assertThat(row.get("dept_id")).isEqualTo(20L);
        assertThat(row.get("avatar")).as("请求未提交头像时不得清空原值")
                .isEqualTo("https://files.example.test/two.png");
        assertThat(jdbc.queryForList("SELECT post_id FROM system_user_post WHERE user_id = 2 AND deleted = 0",
                Long.class)).containsExactly(200L);
    }

    /** 更新用户时账号被他人占用必须拒绝，且不得改动任何字段。 */
    @Test
    void updateUserRejectsUsernameOwnedByAnotherUser() {
        UserSaveReqVO request = createRequest("accountone");
        request.setId(2L);
        request.setNickname("renamed_two");

        asActor(1L, () -> assertBusinessError(() -> users.updateUser(request, "business_admin"),
                USER_USERNAME_EXISTS.getCode()));

        assertThat(jdbc.queryForObject("SELECT nickname FROM system_users WHERE id = 2", String.class))
                .as("被拒绝的更新不得改动用户").isEqualTo("user_two");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_users WHERE username = 'accountone'",
                Integer.class)).isEqualTo(1);
    }

    /** 更新用户资料必须只改联系字段，重复的邮箱与手机号必须拒绝。 */
    @Test
    void updateUserProfileUpdatesContactsAndRejectsDuplicates() {
        UserProfileUpdateReqVO request = new UserProfileUpdateReqVO();
        request.setNickname("profile_two");
        request.setEmail("profile@example.test");
        request.setMobile("13900139000");

        users.updateUserProfile(2L, request);

        Map<String, Object> row = jdbc.queryForMap("SELECT nickname, email, mobile FROM system_users WHERE id = 2");
        assertThat(row.get("nickname")).isEqualTo("profile_two");
        assertThat(row.get("email")).isEqualTo("profile@example.test");
        assertThat(row.get("mobile")).isEqualTo("13900139000");

        // 保持自己的邮箱与手机号不变时必须放行，不能把自己判成重复占用。
        users.updateUserProfile(2L, request);
        assertThat(jdbc.queryForObject("SELECT email FROM system_users WHERE id = 2", String.class))
                .isEqualTo("profile@example.test");

        UserProfileUpdateReqVO conflict = new UserProfileUpdateReqVO();
        conflict.setEmail("profile@example.test");
        assertBusinessError(() -> users.updateUserProfile(1L, conflict), USER_EMAIL_EXISTS.getCode());
        UserProfileUpdateReqVO mobileConflict = new UserProfileUpdateReqVO();
        mobileConflict.setMobile("13900139000");
        assertBusinessError(() -> users.updateUserProfile(1L, mobileConflict), USER_MOBILE_EXISTS.getCode());
        assertBusinessError(() -> users.updateUserProfile(999L, new UserProfileUpdateReqVO()),
                USER_NOT_EXISTS.getCode());
    }

    /** 个人改密必须先校验旧密码摘要，成功后写入新摘要并撤销全部会话。 */
    @Test
    void updateUserPasswordWithProfileRequestValidatesOldDigestAndRevokesSessions() {
        AdminUserDO digestSeed = new AdminUserDO();
        digestSeed.setId(1L);
        digestSeed.setPassword(passwordEncoder.encode(PLAIN_PASSWORD));
        context.getBean(AdminUserMapper.class).updateById(digestSeed);
        UserProfileUpdatePasswordReqVO wrong = new UserProfileUpdatePasswordReqVO();
        wrong.setOldPassword("DUMMY-md5-digest-wrong");
        wrong.setNewPassword("DUMMY-md5-digest-new");
        assertBusinessError(() -> users.updateUserPassword(1L, wrong), USER_PASSWORD_FAILED.getCode());
        assertThat(passwordEncoder.matches(PLAIN_PASSWORD,
                jdbc.queryForObject("SELECT password FROM system_users WHERE id = 1", String.class)))
                .as("旧密码错误时不得改写密码").isTrue();

        UserProfileUpdatePasswordReqVO correct = new UserProfileUpdatePasswordReqVO();
        correct.setOldPassword(PLAIN_PASSWORD);
        correct.setNewPassword("DUMMY-md5-digest-new");
        users.updateUserPassword(1L, correct);

        assertThat(passwordEncoder.matches("DUMMY-md5-digest-new",
                jdbc.queryForObject("SELECT password FROM system_users WHERE id = 1", String.class))).isTrue();
        verify(oauth2TokenService).removeAccessToken(1L, UserTypeEnum.ADMIN.getValue());
    }

    /** 管理端改密必须写入新摘要并撤销会话，跨平台或不存在目标必须拒绝。 */
    @Test
    void updateUserPasswordByAdminRevokesSessionsAndChecksPlatform() {
        users.updateUserPassword(2L, "DUMMY-md5-digest-admin");

        assertThat(passwordEncoder.matches("DUMMY-md5-digest-admin",
                jdbc.queryForObject("SELECT password FROM system_users WHERE id = 2", String.class))).isTrue();
        verify(oauth2TokenService).removeAccessToken(2L, UserTypeEnum.ADMIN.getValue());

        assertBusinessError(() -> users.updateUserPassword(999L, "DUMMY-md5-digest-admin"),
                USER_NOT_EXISTS.getCode());
        assertBusinessError(() -> users.updateUserPassword(4L, "DUMMY-md5-digest-admin", "business_admin"),
                SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
    }

    /** 行锁入口必须在事务外被框架拒绝，不能在无事务时给出不受保护的读取。 */
    @Test
    void lockUserRequiresActiveTransaction() {
        assertThatThrownBy(() -> users.lockUser(1L)).isInstanceOf(IllegalTransactionStateException.class);
    }

    /** 状态变更必须落库并发布用户状态事件，跨平台目标必须拒绝。 */
    @Test
    void updateUserStatusPersistsAndPublishesEvent() {
        asActor(1L, () -> users.updateUserStatus(2L, CommonStatusEnum.DISABLE.getStatus(), "business_admin"));

        assertThat(jdbc.queryForObject("SELECT status FROM system_users WHERE id = 2", Integer.class)).isEqualTo(1);
        assertThat(statusListener.events).singleElement().satisfies(event -> {
            assertThat(event.getUserId()).isEqualTo(2L);
            assertThat(event.getUserType()).isEqualTo(UserTypeEnum.ADMIN.getValue());
            assertThat(event.getStatus()).isEqualTo(CommonStatusEnum.DISABLE.getStatus());
        });
        assertBusinessError(() -> users.updateUserStatus(4L, CommonStatusEnum.ENABLE.getStatus(), "business_admin"),
                SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
        assertBusinessError(() -> users.updateUserStatus(999L, CommonStatusEnum.ENABLE.getStatus(), "business_admin"),
                USER_NOT_EXISTS.getCode());
    }

    /** 删除用户必须同时清空岗位与角色关联，并记录被删除对象。 */
    @Test
    void deleteUserClearsPostsAndRoleRelations() {
        jdbc.update("INSERT INTO system_user_post (user_id,post_id) VALUES (2,100)");
        jdbc.update("INSERT INTO system_user_role (user_id,role_id) VALUES (2,1)");

        asActor(1L, () -> users.deleteUser(2L, "business_admin"));

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_users WHERE id = 2 AND deleted = 0",
                Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_user_post WHERE user_id = 2 AND deleted = 0",
                Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_user_role WHERE user_id = 2 AND deleted = 0",
                Integer.class)).isZero();
        assertBusinessError(() -> users.deleteUser(999L, "business_admin"), USER_NOT_EXISTS.getCode());
    }

    /** 批量删除必须先整体校验：空输入无副作用，混合跨平台编号时不得删除任何用户。 */
    @Test
    void deleteUserListValidatesWholeBatchBeforeDeleting() {
        jdbc.update("INSERT INTO system_user_post (user_id,post_id) VALUES (1,100),(2,100)");
        jdbc.update("INSERT INTO system_user_role (user_id,role_id) VALUES (1,1),(2,1)");

        asActor(1L, () -> users.deleteUserList(List.of(), "business_admin"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_users WHERE deleted = 0", Integer.class))
                .as("空编号集合不得删除任何用户").isEqualTo(4);

        asActor(1L, () -> assertBusinessError(() -> users.deleteUserList(List.of(1L, 4L), "business_admin"),
                SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_users WHERE deleted = 0", Integer.class))
                .as("混合跨平台编号时合法用户也不得被删除").isEqualTo(4);

        asActor(1L, () -> users.deleteUserList(List.of(1L, 1L, 2L), "business_admin"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_users WHERE deleted = 0", Integer.class))
                .isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_user_post WHERE deleted = 0", Integer.class))
                .isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_user_role WHERE deleted = 0", Integer.class))
                .isZero();
    }

    /** 账号与手机号查询必须支持全局与固定平台两种口径。 */
    @Test
    void userQueriesByUsernameAndMobileRespectPlatform() {
        jdbc.update("UPDATE system_users SET mobile = '13700137000' WHERE id = 1");

        assertThat(users.getUserByUsername("accountone")).extracting(AdminUserDO::getId).isEqualTo(1L);
        assertThat(users.getUserByUsername("missing")).isNull();
        assertThat(users.getUserByUsernameAndType("accountone", "business_admin"))
                .extracting(AdminUserDO::getId).isEqualTo(1L);
        assertThat(users.getUserByUsernameAndType("accountone", "super_admin")).isNull();
        assertThat(users.getUserByMobile("13700137000")).extracting(AdminUserDO::getId).isEqualTo(1L);
        assertThat(users.getUserByMobile("19900199000")).isNull();
        assertThat(users.getUserByMobileAndType("13700137000", "business_admin"))
                .extracting(AdminUserDO::getId).isEqualTo(1L);
        assertThat(users.getUserByMobileAndType("13700137000", "super_admin")).isNull();
    }

    /** 按编号查询必须区分不存在与跨平台两种拒绝方式，平台类型推导必须有历史兜底。 */
    @Test
    void getUserByIdRespectsPlatformBoundary() {
        assertThat(users.getUser(1L)).extracting(AdminUserDO::getId).isEqualTo(1L);
        assertThat(users.getUser(999L)).isNull();
        assertThat(users.getUser(999L, "business_admin")).as("不存在时返回空而不是抛错").isNull();
        assertBusinessError(() -> users.getUser(4L, "business_admin"), SYSTEM_PLATFORM_ACCESS_DENIED.getCode());

        assertThat(users.getUserTypeOrDefault(null)).isEqualTo(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        assertThat(users.getUserTypeOrDefault(1L)).isEqualTo(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        assertThat(users.getUserTypeOrDefault(4L)).isEqualTo(AdminPlatformTypeEnum.SUPER_ADMIN.getType());
        assertThat(users.getUserTypeOrDefault(999L)).as("历史空值必须兜底到业务平台")
                .isEqualTo(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        asActor(1L, () -> assertThat(users.getLoginUserTypeOrDefault())
                .isEqualTo(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
    }

    /** 用户分页必须支持按角色编号与部门编号过滤，角色无人时返回空页。 */
    @Test
    void getUserPageFiltersByRoleAndDepartment() {
        jdbc.update("INSERT INTO system_user_role (user_id,role_id) VALUES (1,1)");
        UserPageReqVO byRole = new UserPageReqVO();
        byRole.setRoleId(1L);
        UserPageReqVO emptyRole = new UserPageReqVO();
        emptyRole.setRoleId(2L);
        UserPageReqVO byDept = new UserPageReqVO();
        byDept.setDeptId(10L);
        UserPageReqVO byPlatform = new UserPageReqVO();
        byPlatform.setUserType("super_admin");

        asActor(1L, () -> {
            PageResult<AdminUserDO> rolePage = users.getUserPage(byRole);
            assertThat(rolePage.getList()).extracting(AdminUserDO::getId).containsExactly(1L);
            assertThat(rolePage.getTotal()).isEqualTo(1);

            PageResult<AdminUserDO> emptyPage = users.getUserPage(emptyRole);
            assertThat(emptyPage.getList()).isEmpty();
            assertThat(emptyPage.getTotal()).isZero();

            PageResult<AdminUserDO> deptPage = users.getUserPage(byDept);
            assertThat(deptPage.getList()).extracting(AdminUserDO::getId)
                    .as("部门条件必须包含子部门").containsExactlyInAnyOrder(1L, 2L, 3L);

            assertThat(users.getUserPage(byPlatform).getList()).extracting(AdminUserDO::getId).containsExactly(4L);
        });
    }

    /** 按部门、岗位与编号的列表入口必须对空输入短路，并返回真实关联用户。 */
    @Test
    void getUserListByDeptPostAndIdsHandlesEmptyInput() {
        jdbc.update("INSERT INTO system_user_post (user_id,post_id) VALUES (1,100),(2,200)");

        assertThat(users.getUserListByDeptIds(List.of())).isEmpty();
        assertThat(users.getUserListByDeptIds(List.of(10L))).extracting(AdminUserDO::getId).containsExactly(1L, 2L);
        assertThat(users.getUserListByPostIds(List.of())).isEmpty();
        assertThat(users.getUserListByPostIds(List.of(100L))).extracting(AdminUserDO::getId).containsExactly(1L);
        assertThat(users.getUserListByPostIds(List.of(999L))).as("岗位没有关联用户时返回空列表").isEmpty();
        assertThat(users.getUserList(List.of())).isEmpty();
        assertThat(users.getUserList(List.of(1L, 2L))).extracting(AdminUserDO::getId)
                .containsExactlyInAnyOrder(1L, 2L);
    }

    /** 批量校验必须区分空输入、缺失用户与停用用户。 */
    @Test
    void validateUserListRejectsMissingAndDisabledUsers() {
        users.validateUserList(List.of());
        users.validateUserList(List.of(1L, 2L));

        assertBusinessError(() -> users.validateUserList(List.of(1L, 999L)), USER_NOT_EXISTS.getCode());
        assertThatThrownBy(() -> users.validateUserList(List.of(3L)))
                .isInstanceOfSatisfying(ServiceException.class, exception -> {
                    assertThat(exception.getCode()).isEqualTo(USER_IS_DISABLE.getCode());
                    assertThat(exception.getMessage()).contains("user_three");
                });
    }

    /** 昵称、状态与平台组合查询必须按各自口径返回结果。 */
    @Test
    void getUserListByNicknameAndStatusRespectPlatform() {
        assertThat(users.getUserListByNickname("user_tw")).extracting(AdminUserDO::getId).containsExactly(2L);
        assertThat(users.getUserListByStatus(CommonStatusEnum.DISABLE.getStatus()))
                .extracting(AdminUserDO::getId).containsExactly(3L);
        assertThat(users.getUserListByStatusAndType(CommonStatusEnum.ENABLE.getStatus(), "business_admin"))
                .extracting(AdminUserDO::getId).containsExactlyInAnyOrder(1L, 2L);
        assertThat(users.getUserListByStatusAndType(CommonStatusEnum.ENABLE.getStatus(), "super_admin"))
                .extracting(AdminUserDO::getId).containsExactly(4L);
    }

    /** 密码比对必须走真实编码器，不得退化成字符串比较。 */
    @Test
    void isPasswordMatchUsesEncoder() {
        String encoded = passwordEncoder.encode(PLAIN_PASSWORD);

        assertThat(users.isPasswordMatch(PLAIN_PASSWORD, encoded)).isTrue();
        assertThat(users.isPasswordMatch("DUMMY-md5-digest-wrong", encoded)).isFalse();
    }

    /** 开放注册必须同时满足部署开关与参数配置，成功时必须写入业务平台账号。 */
    @Test
    void registerUserRequiresBothSwitches() {
        AuthRegisterReqVO request = registerRequest("registeredone");

        assertBusinessError(() -> users.registerUser(request), USER_REGISTER_DISABLED.getCode());

        authenticationProperties.setRegistrationEnabled(true);
        configApi.values.put(AdminUserServiceImpl.USER_REGISTER_ENABLED_KEY, "false");
        assertBusinessError(() -> users.registerUser(request), USER_REGISTER_DISABLED.getCode());

        configApi.values.put(AdminUserServiceImpl.USER_REGISTER_ENABLED_KEY, "true");
        Long id = users.registerUser(request);

        Map<String, Object> row = jdbc.queryForMap("SELECT username, user_type, status, password "
                + "FROM system_users WHERE id = ?", id);
        assertThat(row.get("username")).isEqualTo("registeredone");
        assertThat(row.get("user_type")).as("注册入口只允许生成业务平台账号")
                .isEqualTo(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        assertThat(row.get("status")).isEqualTo(CommonStatusEnum.ENABLE.getStatus());
        assertThat(passwordEncoder.matches(PLAIN_PASSWORD, (String) row.get("password"))).isTrue();
    }

    /** 导入入口必须拒绝空清单与缺失的初始口令，不产生任何用户。 */
    @Test
    void importUserListRequiresListAndInitPassword() {
        assertBusinessError(() -> users.importUserList(List.of(), false), USER_IMPORT_LIST_IS_EMPTY.getCode());

        List<UserImportExcelVO> importUsers = List.of(importUser("importedone", "user_imported"));
        assertBusinessError(() -> users.importUserList(importUsers, false), USER_IMPORT_INIT_PASSWORD.getCode());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_users WHERE deleted = 0", Integer.class))
                .isEqualTo(4);
    }

    /** 导入必须逐行给出失败原因：字段非法、部门不存在、唯一键冲突与不允许更新。 */
    @Test
    void importUserListReportsRowFailuresWithoutPartialWrites() {
        configApi.values.put(AdminUserServiceImpl.USER_INIT_PASSWORD_KEY, INIT_PASSWORD);
        UserImportExcelVO invalid = importUser(null, "user_invalid");
        invalid.setMobile("123");
        UserImportExcelVO missingDept = importUser("importeddept", "user_dept");
        missingDept.setDeptName("不存在的部门");
        UserImportExcelVO duplicatedMobile = importUser("importedmobile", "user_mobile");
        duplicatedMobile.setMobile("13600136000");
        UserImportExcelVO duplicatedExisting = importUser("accountone", "user_duplicated");
        UserImportExcelVO duplicatedContact = importUser("importedconflict", "user_conflict");
        duplicatedContact.setMobile("13600136000");

        UserImportRespVO result = asActorResult(1L, () -> users.importUserList(
                Arrays.asList(invalid, missingDept, duplicatedMobile, duplicatedExisting, duplicatedContact), false));

        assertThat(result.getCreateUsernames()).containsExactly("importedmobile");
        assertThat(result.getFailureUsernames()).containsKeys("第 1 行", "importeddept", "accountone",
                "importedconflict");
        assertThat(result.getFailureUsernames().get("importedconflict"))
                .as("唯一键冲突必须计入失败清单而不是中断导入").isEqualTo(USER_MOBILE_EXISTS.getMsg());
        assertThat(result.getFailureUsernames().get("importeddept")).isEqualTo("部门名称不存在");
        assertThat(result.getFailureUsernames().get("accountone")).isEqualTo(USER_USERNAME_EXISTS.getMsg());
        assertThat(result.getUpdateUsernames()).isEmpty();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_users WHERE deleted = 0", Integer.class))
                .isEqualTo(5);
    }

    /** 导入必须支持按部门名称创建新用户，并在允许更新时更新既有用户。 */
    @Test
    void importUserListCreatesAndUpdatesUsers() {
        configApi.values.put(AdminUserServiceImpl.USER_INIT_PASSWORD_KEY, INIT_PASSWORD);
        UserImportExcelVO created = importUser("importednew", "user_new");
        created.setDeptName("子部门");
        UserImportExcelVO existing = importUser("accounttwo", "user_renamed");

        UserImportRespVO result = asActorResult(1L, () -> users.importUserList(List.of(created, existing), true));

        assertThat(result.getCreateUsernames()).containsExactly("importednew");
        assertThat(result.getUpdateUsernames()).containsExactly("accounttwo");
        assertThat(result.getFailureUsernames()).isEmpty();
        Map<String, Object> createdRow = jdbc.queryForMap("SELECT dept_id, user_type, password FROM system_users "
                + "WHERE username = 'importednew'");
        assertThat(createdRow.get("dept_id")).as("部门名称必须解析成真实部门编号").isEqualTo(20L);
        assertThat(createdRow.get("user_type")).isEqualTo(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        assertThat(passwordEncoder.matches(INIT_PASSWORD, (String) createdRow.get("password"))).isTrue();
        assertThat(jdbc.queryForObject("SELECT nickname FROM system_users WHERE username = 'accounttwo'",
                String.class)).isEqualTo("user_renamed");
    }

    /**
     * 构造创建用户的请求。
     *
     * @param username 用户账号
     * @return 创建请求
     */
    private UserSaveReqVO createRequest(String username) {
        UserSaveReqVO request = new UserSaveReqVO();
        request.setUsername(username);
        request.setNickname(username);
        request.setPassword(PLAIN_PASSWORD);
        return request;
    }

    /**
     * 构造注册请求。
     *
     * @param username 用户账号
     * @return 注册请求
     */
    private AuthRegisterReqVO registerRequest(String username) {
        AuthRegisterReqVO request = new AuthRegisterReqVO();
        request.setUsername(username);
        request.setNickname(username);
        request.setPassword(PLAIN_PASSWORD);
        return request;
    }

    /**
     * 构造导入行。
     *
     * @param username 用户账号，可为空以覆盖"第 N 行"失败键
     * @param nickname 用户昵称
     * @return 导入行
     */
    private UserImportExcelVO importUser(String username, String nickname) {
        UserImportExcelVO importUser = new UserImportExcelVO();
        importUser.setUsername(username);
        importUser.setNickname(nickname);
        return importUser;
    }

    /** 在可信登录上下文中执行动作，结束后恢复线程原有安全上下文。 */
    private void asActor(Long actorId, Runnable action) {
        SecurityContext original = SecurityContextHolder.getContext();
        try {
            SecurityContext security = SecurityContextHolder.createEmptyContext();
            LoginUser login = new LoginUser().setId(actorId).setUserType(UserTypeEnum.ADMIN.getValue());
            security.setAuthentication(new UsernamePasswordAuthenticationToken(login, null, List.of()));
            SecurityContextHolder.setContext(security);
            action.run();
        } finally {
            SecurityContextHolder.setContext(original);
        }
    }

    /** 在可信登录上下文中执行有返回值的动作，结束后恢复线程原有安全上下文。 */
    private <T> T asActorResult(Long actorId, Supplier<T> action) {
        Object[] result = new Object[1];
        asActor(actorId, () -> result[0] = action.get());
        @SuppressWarnings("unchecked")
        T typed = (T) result[0];
        return typed;
    }

    /** 只接受预期业务拒绝，SQL 异常或装配异常不能冒充业务边界通过。 */
    private void assertBusinessError(Runnable action, int errorCode) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(ServiceException.class,
                exception -> assertThat(exception.getCode()).isEqualTo(errorCode));
    }

    /** 使用真实 MyBatis 配置与分页插件，防止内存替身掩盖映射或分页错误。 */
    private SqlSessionFactory sqlSessionFactory(DataSource dataSource) {
        try {
            MybatisConfiguration configuration = new MybatisConfiguration();
            configuration.setMapUnderscoreToCamelCase(true);
            GlobalConfig global = new GlobalConfig();
            global.setDbConfig(new GlobalConfig.DbConfig().setIdType(IdType.AUTO));
            // 审计字段由生产填充器负责；缺失会让 create_time/update_time 写入 null 并被数据库拒绝。
            global.setMetaObjectHandler(new DefaultDBFieldHandler());
            MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
            interceptor.addInnerInterceptor(new PaginationInnerInterceptor());
            MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
            factory.setDataSource(dataSource);
            factory.setConfiguration(configuration);
            factory.setGlobalConfig(global);
            factory.setPlugins(interceptor);
            return factory.getObject();
        } catch (Exception failure) {
            throw new IllegalStateException("后台用户测试会话工厂初始化失败", failure);
        }
    }

    /** 为每个生产 Mapper 建立真实代理，不扫描无关业务依赖。 */
    private <T> void registerMapper(Class<T> type) {
        context.registerBean(type, () -> {
            try {
                MapperFactoryBean<T> mapper = new MapperFactoryBean<>(type);
                mapper.setSqlSessionFactory(context.getBean(SqlSessionFactory.class));
                mapper.afterPropertiesSet();
                return mapper.getObject();
            } catch (Exception failure) {
                throw new IllegalStateException("后台用户测试 Mapper 创建失败", failure);
            }
        });
    }

    /** 显式注入本测试所需依赖，由 Spring 为生产方法建立实际事务代理。 */
    private static <T> T wire(T target, String field, Object value) {
        ReflectionTestUtils.setField(target, field, value);
        return target;
    }

    /** 定位当前工作区生产 DDL，不维护脱节的测试表结构。 */
    private Path schemaSource() {
        for (Path path = Path.of("").toAbsolutePath(); path != null; path = path.getParent()) {
            Path candidate = path.resolve("数据库文件/basic_framework.sql");
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("未找到生产 DDL");
    }

    /** 缺失隔离环境时直接失败，避免退化成跳过真实数据库证据。 */
    private String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("缺少隔离测试环境变量 " + name);
        }
        return value;
    }

    /**
     * 可写参数配置替身，供注册与导入读取开关和初始口令。
     *
     * @author shady2713
     */
    private static class StubConfigApi implements ConfigApi {

        /** 用例内可写的配置项。 */
        private final Map<String, String> values = new HashMap<>();

        /**
         * 读取参数值。
         *
         * @param key 参数键
         * @return 参数值；未配置时返回 null
         */
        @Override
        public String getConfigValueByKey(String key) {
            return values.get(key);
        }

    }

    /**
     * 记录用户状态变更事件的监听器，用于验证状态变更的真实副作用。
     *
     * @author shady2713
     */
    private static class UserStatusListener implements ApplicationListener<PayloadApplicationEvent<UserStatusChangedEvent>> {

        /** 按发布顺序记录的事件。 */
        private final List<UserStatusChangedEvent> events = new ArrayList<>();

        /**
         * 记录一次用户状态变更事件。
         *
         * @param event 携带用户状态变更负载的容器事件
         */
        @Override
        public void onApplicationEvent(PayloadApplicationEvent<UserStatusChangedEvent> event) {
            events.add(event.getPayload());
        }

    }

    /** 开启生产事务、缓存与 AOP 边界，异常必须回滚真实 MySQL。 */
    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement(proxyTargetClass = true)
    @EnableCaching(proxyTargetClass = true)
    @EnableAspectJAutoProxy(proxyTargetClass = true)
    static class TransactionConfiguration {
    }

}
