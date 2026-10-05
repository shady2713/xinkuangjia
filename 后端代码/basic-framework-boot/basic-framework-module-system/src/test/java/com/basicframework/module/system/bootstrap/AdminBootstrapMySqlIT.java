package com.basicframework.module.system.bootstrap;

import cn.hutool.crypto.digest.DigestUtil;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.dal.mysql.user.AdminUserMapper;
import com.basicframework.module.system.service.auth.AdminAuthServiceImpl;
import com.basicframework.module.system.service.logger.LoginLogService;
import com.basicframework.module.system.service.user.AdminUserServiceImpl;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mybatis.spring.mapper.MapperFactoryBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.mock;

/**
 * 真实 MySQL 验证独立初始化进程的空库、事务、并发与现有登录协议；只使用随机隔离数据库。
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AdminBootstrapMySqlIT {

    private static final List<String> TABLES = List.of("system_users", "system_user_role", "system_user_post",
            "system_oauth2_access_token", "system_oauth2_refresh_token", "system_role");
    private final String schema = "bf_bootstrap_" + UUID.randomUUID().toString().replace("-", "");
    private final BootstrapAdminService service = new BootstrapAdminService();
    private String adminUrl;
    private String databaseUser;
    private String databasePassword;
    private String databaseUrl;
    private boolean schemaCreated;
    private JdbcTemplate jdbc;
    private DriverManagerDataSource dataSource;
    private Map<String, String> environment;
    private String plaintext;

    /** 强制环回无库连接，只创建自己命名的数据库，并使用仓库真实 DDL。 */
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
        databaseUrl = adminUrl.split("\\?", 2)[0] + schema + "?sslMode=DISABLED&allowPublicKeyRetrieval=true";
        dataSource = new DriverManagerDataSource(databaseUrl, databaseUser, databasePassword);
        jdbc = new JdbcTemplate(dataSource);
        String ddl = Files.readString(findSchemaSource());
        for (String table : TABLES) {
            Matcher matcher = Pattern.compile("CREATE TABLE `" + table + "`[\\s\\S]*?;").matcher(ddl);
            assertThat(matcher.find()).as("生产 DDL 必须包含 %s", table).isTrue();
            jdbc.execute(matcher.group());
        }
    }

    /** 每例重建空身份边界与唯一有效角色，口令随机生成而非分发固定测试凭据。 */
    @BeforeEach
    void resetIdentities() {
        jdbc.execute("DROP TRIGGER IF EXISTS bootstrap_reject_grant");
        for (String table : TABLES) {
            jdbc.update("DELETE FROM " + table);
        }
        jdbc.update("INSERT INTO system_role (id, name, code, role_type, sort, status, type)"
                + " VALUES (11, 'bootstrap test', 'super_admin', 'super_admin', 1, 0, 1)");
        environment = new HashMap<>();
        environment.put("BOOTSTRAP_JDBC_URL", databaseUrl);
        environment.put("BOOTSTRAP_CONFIRM_DATABASE", schema);
        environment.put("DB_USERNAME", databaseUser);
        environment.put("DB_PASSWORD", databasePassword);
        environment.put("BOOTSTRAP_ADMIN_USERNAME", "init" + UUID.randomUUID().toString().replace("-", "").substring(0, 20));
        plaintext = "A9" + UUID.randomUUID() + "中";
    }

    /** 初始化产物通过真实 Mapper 和实际 authenticate 密码协议认证，部门允许为空。 */
    @Test
    void bootstrapCreatesAtomicIdentityAcceptedByExistingAuthentication() throws Exception {
        long id = create();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_users", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT role_id FROM system_user_role WHERE user_id = ?", Long.class, id))
                .isEqualTo(11L);
        assertThat(jdbc.queryForObject("SELECT password FROM system_users WHERE id = ?", String.class, id))
                .startsWith("$2a$10$");
        assertThat(jdbc.queryForObject("SELECT dept_id FROM system_users WHERE id = ?", Long.class, id)).isNull();
        AdminAuthServiceImpl auth = realAuthentication();
        TransactionTemplate transaction = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
        AdminUserDO user = transaction.execute(status -> auth.authenticate(environment.get("BOOTSTRAP_ADMIN_USERNAME"),
                DigestUtil.md5Hex(plaintext), "super_admin"));
        assertThat(user).isNotNull();
        assertThat(user.getId()).isEqualTo(id);
        assertThatThrownBy(() -> transaction.execute(status -> auth.authenticate(environment.get("BOOTSTRAP_ADMIN_USERNAME"),
                DigestUtil.md5Hex(plaintext + "other"), "super_admin"))).isInstanceOf(ServiceException.class);
        assertThatThrownBy(() -> transaction.execute(status -> auth.authenticate(environment.get("BOOTSTRAP_ADMIN_USERNAME"),
                DigestUtil.md5Hex(plaintext), "business_admin"))).isInstanceOf(ServiceException.class);
    }

    /** 运行第二次也不会覆盖口令、创建新用户或重新授予权限。 */
    @Test
    void repeatExecutionRejectsInsteadOfOverwritingExistingIdentity() throws Exception {
        long id = create();
        String encoded = jdbc.queryForObject("SELECT password FROM system_users WHERE id = ?", String.class, id);
        assertThatThrownBy(this::create).hasMessage("NONEMPTY_IDENTITIES");
        assertThat(jdbc.queryForObject("SELECT password FROM system_users WHERE id = ?", String.class, id)).isEqualTo(encoded);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_user_role", Integer.class)).isEqualTo(1);
    }

    /** 任意旧身份或关联都拒绝，包括逻辑删除账号和可能继承新账号 ID 的孤立会话。 */
    @ParameterizedTest
    @ValueSource(strings = {"system_users", "deleted_user", "system_user_role", "system_user_post",
            "system_oauth2_access_token", "system_oauth2_refresh_token"})
    void existingIdentityResidueIsRejected(String table) {
        insertResidue(table);
        assertThatThrownBy(this::create).hasMessage("NONEMPTY_IDENTITIES");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_users WHERE username = ?", Integer.class,
                environment.get("BOOTSTRAP_ADMIN_USERNAME"))).isZero();
    }

    /** 无效、禁用、已删除、外平台或非系统类型角色均不能被 bootstrap 修复或绕过。 */
    @ParameterizedTest
    @ValueSource(strings = {"missing", "disabled", "deleted", "foreign_platform", "custom_type", "wrong_case"})
    void invalidSuperAdminRoleIsRejected(String state) {
        switch (state) {
            case "missing" -> jdbc.update("DELETE FROM system_role");
            case "disabled" -> jdbc.update("UPDATE system_role SET status = 1");
            case "deleted" -> jdbc.update("UPDATE system_role SET deleted = b'1'");
            case "foreign_platform" -> jdbc.update("UPDATE system_role SET role_type = 'business_admin'");
            case "custom_type" -> jdbc.update("UPDATE system_role SET type = 2");
            case "wrong_case" -> jdbc.update("UPDATE system_role SET code = 'SUPER_ADMIN'");
            default -> throw new AssertionError("未知测试角色状态");
        }
        assertThatThrownBy(this::create).hasMessage("INVALID_ADMIN_ROLE");
        assertEmptyIdentity();
    }

    /** 真实关联写入错误导致用户及关联同时回滚，失败后释放锁允许正常重试。 */
    @Test
    void grantFailureRollsBackUserAndReleasesDatabaseLock() throws Exception {
        jdbc.execute("CREATE TRIGGER bootstrap_reject_grant BEFORE INSERT ON system_user_role"
                + " FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'controlled test failure'");
        assertThatThrownBy(this::create).isInstanceOf(SQLException.class);
        assertEmptyIdentity();
        assertThat(jdbc.queryForObject("SELECT IS_USED_LOCK(?)", Long.class, BootstrapAdminService.lockName(schema))).isNull();
        jdbc.execute("DROP TRIGGER bootstrap_reject_grant");
        assertThat(create()).isPositive();
    }

    /**
     * 命名锁被其它会话持有时必须在等待超时后拒绝初始化，而不是继续写入身份数据。
     *
     * <p>真实并发下另一个初始化进程可能正在建库写身份；拿不到锁就写入会与对方交错，
     * 产生重复账号或半个关联。这里用一个真实连接持有同名锁，断言拒绝分类为 BOOTSTRAP_BUSY
     * 且目标库仍无任何身份数据。</p>
     */
    @Test
    void initializationIsRejectedWhileAnotherSessionHoldsNamedLock() throws Exception {
        String lock = BootstrapAdminService.lockName(schema);
        try (Connection holder = dataSource.getConnection()) {
            namedLock(holder, "GET_LOCK(?, 0)", lock);

            assertThatThrownBy(this::create).hasMessage("BOOTSTRAP_BUSY");
            assertEmptyIdentity();
        }
    }

    /**
     * 回滚本身失败时必须以抑制异常保留原始失败，且原失败不被替换或吞掉。
     *
     * <p>回滚失败是二次故障：调用方需要按原始 SQLException 判断失败原因（入口据此输出
     * 固定分类），回滚异常只能作为 suppressed 附加信息，不能覆盖原始异常。</p>
     *
     * <p>故障注入方式：先取真实连接，再代理它在 {@code rollback()} 上抛错，
     * 并通过 {@code DriverManager} 静态替身把该连接交给被测服务，
     * 使事务与锁定仍在真实 MySQL 上执行。</p>
     */
    @Test
    void rollbackFailureIsSuppressedWithoutReplacingOriginalFailure() throws Exception {
        jdbc.execute("CREATE TRIGGER bootstrap_reject_grant BEFORE INSERT ON system_user_role"
                + " FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'controlled test failure'");
        Connection real = DriverManager.getConnection(databaseUrl, databaseUser, databasePassword);
        Connection failingRollback = (Connection) java.lang.reflect.Proxy.newProxyInstance(
                Connection.class.getClassLoader(), new Class<?>[] {Connection.class}, (proxy, method, arguments) -> {
                    if ("rollback".equals(method.getName())) {
                        throw new SQLException("DUMMY-ROLLBACK-FAILURE");
                    }
                    try {
                        return method.invoke(real, arguments);
                    } catch (java.lang.reflect.InvocationTargetException exception) {
                        throw exception.getCause();
                    }
                });
        SQLException failure;
        try (org.mockito.MockedStatic<DriverManager> mocked = org.mockito.Mockito.mockStatic(DriverManager.class)) {
            mocked.when(() -> DriverManager.getConnection(org.mockito.ArgumentMatchers.anyString(),
                    org.mockito.ArgumentMatchers.any(java.util.Properties.class))).thenReturn(failingRollback);

            failure = catchThrowableOfType(this::create, SQLException.class);
        } finally {
            failingRollback.close();
            jdbc.execute("DROP TRIGGER IF EXISTS bootstrap_reject_grant");
        }

        assertThat((Object) failure).as("原始写入失败必须仍以 SQLException 抛出").isNotNull();
        assertThat(failure.getSuppressed())
                .as("回滚失败只能作为抑制异常附加，不能替换原始失败")
                .hasSize(1);
        assertThat(failure.getSuppressed()[0]).isInstanceOf(SQLException.class)
                .hasMessage("DUMMY-ROLLBACK-FAILURE");
        assertEmptyIdentity();
    }

    /** 两个初始化连接真实等待同一命名锁，释放后仅一个提交，另一个读到已存在身份。 */
    @Test
    void concurrentBootstrapProcessesHaveExactlyOneWinner() throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(2);
        String lock = BootstrapAdminService.lockName(schema);
        try (Connection owner = dataSource.getConnection()) {
            namedLock(owner, "GET_LOCK(?, 0)", lock);
            Future<String> first = executor.submit(this::createOutcome);
            Future<String> second = executor.submit(this::createOutcome);
            try {
                await().atMost(Duration.ofSeconds(7)).untilAsserted(() -> assertThat(jdbc.queryForObject(
                        "SELECT COUNT(*) FROM performance_schema.metadata_locks WHERE OBJECT_TYPE = 'USER LEVEL LOCK'"
                                + " AND OBJECT_NAME = ? AND LOCK_STATUS = 'PENDING'", Integer.class, lock)).isEqualTo(2));
            } finally {
                namedLock(owner, "RELEASE_LOCK(?)", lock);
            }
            assertThat(List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder("created", "NONEMPTY_IDENTITIES");
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_users", Integer.class)).isEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_user_role", Integer.class)).isEqualTo(1);
        } finally {
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    /** 初始化等待角色行时仍持有空用户表间隙锁，普通写入必须等到整笔初始化提交。 */
    @Test
    void ordinaryUserInsertCannotPassEmptyIdentityCheckBeforeBootstrapCommit() throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try (Connection roleOwner = dataSource.getConnection()) {
            roleOwner.setAutoCommit(false);
            try (Statement statement = roleOwner.createStatement()) {
                statement.executeQuery("SELECT id FROM system_role WHERE id = 11 FOR UPDATE").close();
            }
            Future<Long> bootstrap = executor.submit(this::create);
            awaitTableLockWait("system_role");
            Future<Integer> ordinary = executor.submit(() -> jdbc.update(
                    "INSERT INTO system_users (username, nickname) VALUES ('paralleluser', 'parallel test')"));
            try {
                awaitTableLockWait("system_users");
                assertThat(bootstrap.isDone()).isFalse();
                assertThat(ordinary.isDone()).isFalse();
            } finally {
                roleOwner.commit();
            }
            long id = bootstrap.get(10, TimeUnit.SECONDS);
            assertThat(ordinary.get(10, TimeUnit.SECONDS)).isEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT role_id FROM system_user_role WHERE user_id = ?", Long.class, id))
                    .isEqualTo(11L);
        } finally {
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    /** 非事务表使原子性前提失效时必须在任何用户写入前拒绝。 */
    @Test
    void nonTransactionalTableIsRejectedBeforeWrites() {
        jdbc.execute("ALTER TABLE system_role ENGINE = MyISAM");
        try {
            assertThatThrownBy(this::create).hasMessage("NON_TRANSACTIONAL_SCHEMA");
            assertEmptyIdentity();
        } finally {
            jdbc.execute("ALTER TABLE system_role ENGINE = InnoDB");
        }
    }

    /** 环境口令直接消费且输出不泄露凭据；入口仍执行真实数据库事务。 */
    @Test
    void environmentEntryDoesNotPrintSecretsOrAskForConsole() {
        environment.put("BOOTSTRAP_ADMIN_PASSWORD", plaintext);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        PrintStream stream = new PrintStream(output, true, StandardCharsets.UTF_8);
        assertThat(AdminBootstrapMain.execute(new String[0], environment, prompt -> {
            throw new AssertionError("已有环境口令不应读取终端");
        }, stream, stream)).isZero();
        assertThat(output.toString(StandardCharsets.UTF_8)).startsWith("BOOTSTRAP_CREATED userId=")
                .doesNotContain(plaintext, databasePassword, databaseUrl, DigestUtil.md5Hex(plaintext));
    }

    /** 双次交互输入成功后全部可变数组清零，数据库写入使用确认前的原始值。 */
    @Test
    void interactiveEntryConfirmsAndClearsBothPasswordBuffers() {
        char[] first = plaintext.toCharArray();
        char[] second = plaintext.toCharArray();
        AtomicInteger reads = new AtomicInteger();
        PrintStream stream = new PrintStream(new ByteArrayOutputStream());
        assertThat(AdminBootstrapMain.execute(new String[0], environment,
                prompt -> reads.getAndIncrement() == 0 ? first : second, stream, stream)).isZero();
        assertThat(reads.get()).isEqualTo(2);
        assertThat(first).containsOnly('\0');
        assertThat(second).containsOnly('\0');
        assertThat(new BCryptPasswordEncoder().matches(DigestUtil.md5Hex(plaintext),
                jdbc.queryForObject("SELECT password FROM system_users", String.class))).isTrue();
    }

    /** 即使数据库错误中含秘密，入口也只输出固定分类和 SQLState、错误号。 */
    @Test
    void databaseErrorOutputIsSanitizedAndNoPartialAccountRemains() {
        String marker = "private" + UUID.randomUUID().toString().replace("-", "");
        jdbc.execute("CREATE TRIGGER bootstrap_reject_grant BEFORE INSERT ON system_user_role"
                + " FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '" + marker + "'");
        environment.put("BOOTSTRAP_ADMIN_PASSWORD", plaintext);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        PrintStream stream = new PrintStream(output, true, StandardCharsets.UTF_8);
        assertThat(AdminBootstrapMain.execute(new String[0], environment, prompt -> null, stream, stream)).isEqualTo(3);
        assertThat(output.toString(StandardCharsets.UTF_8)).contains("BOOTSTRAP_STORAGE_FAILURE state=45000")
                .doesNotContain(marker, plaintext, databasePassword, databaseUrl);
        assertEmptyIdentity();
    }

    /** 人工确认错误在连接前失败，真正目标库保持无身份数据。 */
    @Test
    void wrongDatabaseConfirmationDoesNotWrite() {
        environment.put("BOOTSTRAP_CONFIRM_DATABASE", "other_database");
        assertThatThrownBy(this::create).hasMessage("TARGET_MISMATCH");
        assertEmptyIdentity();
    }

    /** 用既有用户 Mapper、口令校验和认证实现验证写入协议，不在测试中重写认证逻辑。 */
    private AdminAuthServiceImpl realAuthentication() throws Exception {
        MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
        factory.setDataSource(dataSource);
        MybatisConfiguration configuration = new MybatisConfiguration();
        configuration.setMapUnderscoreToCamelCase(true);
        factory.setConfiguration(configuration);
        GlobalConfig global = new GlobalConfig();
        global.setDbConfig(new GlobalConfig.DbConfig().setIdType(IdType.AUTO));
        global.setMetaObjectHandler(new DefaultDBFieldHandler());
        factory.setGlobalConfig(global);
        MapperFactoryBean<AdminUserMapper> mapper = new MapperFactoryBean<>(AdminUserMapper.class);
        mapper.setSqlSessionFactory(factory.getObject());
        mapper.afterPropertiesSet();
        AdminUserServiceImpl users = new AdminUserServiceImpl();
        ReflectionTestUtils.setField(users, "userMapper", mapper.getObject());
        ReflectionTestUtils.setField(users, "passwordEncoder", new BCryptPasswordEncoder());
        AdminAuthServiceImpl auth = new AdminAuthServiceImpl();
        ReflectionTestUtils.setField(auth, "userService", users);
        ReflectionTestUtils.setField(auth, "loginLogService", mock(LoginLogService.class));
        return auth;
    }

    /** 构造真实数据库残留状态，凭据随机生成且不会发送给外部服务。 */
    private void insertResidue(String table) {
        String random = UUID.randomUUID().toString().replace("-", "");
        switch (table) {
            case "system_users", "deleted_user" -> jdbc.update(
                    "INSERT INTO system_users (username, nickname, deleted) VALUES (?, 'old identity', ?)",
                    random.substring(0, 20), "deleted_user".equals(table));
            case "system_user_role" -> jdbc.update("INSERT INTO system_user_role (user_id, role_id) VALUES (1, 11)");
            case "system_user_post" -> jdbc.update("INSERT INTO system_user_post (user_id, post_id) VALUES (1, 1)");
            case "system_oauth2_access_token" -> jdbc.update("INSERT INTO system_oauth2_access_token"
                    + " (user_id, user_type, user_info, access_token, refresh_token, client_id, expires_time)"
                    + " VALUES (1, 2, '{}', ?, ?, 'default', DATE_ADD(NOW(), INTERVAL 1 DAY))", random, random);
            case "system_oauth2_refresh_token" -> jdbc.update("INSERT INTO system_oauth2_refresh_token"
                    + " (user_id, user_type, refresh_token, client_id, expires_time)"
                    + " VALUES (1, 2, ?, 'default', DATE_ADD(NOW(), INTERVAL 1 DAY))", random);
            default -> throw new AssertionError("未知测试身份表");
        }
    }

    /** 运行当前随机配置的真实初始化用例。 */
    private long create() throws SQLException {
        return service.create(BootstrapConfiguration.fromEnvironment(environment), plaintext.toCharArray());
    }

    /** 并发测试只收集预期业务拒绝，任何 SQL 或其他失败仍让 Future 失败。 */
    private String createOutcome() throws SQLException {
        try {
            create();
            return "created";
        } catch (BootstrapFailure exception) {
            return exception.getMessage();
        }
    }

    /** 检查原子写入边界，不以调用次数代替数据库状态。 */
    private void assertEmptyIdentity() {
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_users", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_user_role", Integer.class)).isZero();
    }

    /** 控制测试连接的真实命名锁，以数据库待锁状态证明并发顺序。 */
    private static void namedLock(Connection connection, String expression, String lock) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("SELECT " + expression)) {
            statement.setString(1, lock);
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getInt(1)).isEqualTo(1);
            }
        }
    }

    /** 以 MySQL 真实锁等待关系同步测试，不以睡眠或方法调用次数推断串行化。 */
    private void awaitTableLockWait(String table) {
        await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM performance_schema.data_lock_waits w"
                        + " JOIN performance_schema.data_locks b ON b.ENGINE_LOCK_ID = w.BLOCKING_ENGINE_LOCK_ID"
                        + " WHERE b.OBJECT_SCHEMA = ? AND b.OBJECT_NAME = ?", Integer.class, schema, table))
                .isGreaterThan(0));
    }

    /** 从当前工作目录向上定位真实建表脚本，不维护测试专用结构副本。 */
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

    /** 显式集成测试缺失环境即失败，不默默跳过或连接本机默认业务服务。 */
    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("必须提供测试环境变量 " + name);
        }
        return value;
    }

    /** 只清理本测试已创建且名称经过约束的随机数据库。 */
    @AfterAll
    void dropEnvironment() throws SQLException {
        if (schemaCreated && schema.matches("bf_bootstrap_[a-f0-9]{32}")) {
            try (Connection connection = DriverManager.getConnection(adminUrl, databaseUser, databasePassword);
                 Statement statement = connection.createStatement()) {
                statement.execute("DROP DATABASE `" + schema + "`");
            }
        }
    }
}
