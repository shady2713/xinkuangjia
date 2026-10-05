package com.basicframework.module.system.bootstrap;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 不启动应用容器的一次性管理员创建服务，以 MySQL 事务和数据库命名锁保护空库边界。
 *
 * @author shady2713
 */
final class BootstrapAdminService {

    /** JDBC 单行写入成功的更新行数。 */
    private static final int SINGLE_ROW_AFFECTED = 1;

    private static final List<String> IDENTITY_TABLES = List.of("system_users", "system_user_role",
            "system_user_post", "system_oauth2_access_token", "system_oauth2_refresh_token");
    private static final String ADMIN_PLATFORM = "super_admin";

    /**
     * 在确认的空身份库中原子创建唯一账号与超级管理员角色关联，不产生登录会话。
     *
     * <p>锁等待最多十秒；业务拒绝与 SQL 失败均回滚。提交响应丢失时应先核查数据库，
     * 不得通过清表重试。调用方保留明文数组所有权并负责清零。</p>
     *
     * @param configuration 显式校验的单库配置
     * @param password 符合初始化策略的明文口令，仅用于本次编码
     * @return 已提交的新用户 ID
     * @throws BootstrapFailure 目标、表引擎、空身份库、角色或锁边界不满足
     * @throws SQLException 数据库访问或提交失败，不保证提交响应丢失时未发生提交
     */
    long create(BootstrapConfiguration configuration, char[] password) throws SQLException {
        String encoded = BootstrapPassword.encode(password);
        try (Connection connection = DriverManager.getConnection(configuration.jdbcUrl(),
                configuration.connectionProperties())) {
            verifyDatabase(connection, configuration.database());
            String lockName = lockName(configuration.database());
            acquireLock(connection, lockName);
            try {
                connection.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
                connection.setAutoCommit(false);
                try {
                    try (Statement statement = connection.createStatement()) {
                        statement.execute("SET SESSION innodb_lock_wait_timeout = 10");
                    }
                    verifyTransactionalTables(connection, configuration.database());
                    // 包括逻辑删除和孤立关联、会话；新账号不得继承旧 ID 的岗位或有效令牌。
                    for (String table : IDENTITY_TABLES) {
                        assertEmptyAndLock(connection, table);
                    }
                    long roleId = selectAdminRoleForUpdate(connection);
                    long userId = insertUser(connection, configuration.adminUsername(), encoded);
                    insertUserRole(connection, userId, roleId);
                    connection.commit();
                    return userId;
                } catch (SQLException | RuntimeException exception) {
                    try {
                        connection.rollback();
                    } catch (SQLException rollbackFailure) {
                        exception.addSuppressed(rollbackFailure);
                    }
                    throw exception;
                }
            } finally {
                releaseLock(connection, lockName);
            }
        }
    }

    /** 实际会话的默认库必须与 URL 和人工确认值完全一致，查询失败不会进行写入。 */
    private static void verifyDatabase(Connection connection, String database) throws SQLException {
        try (Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery("SELECT DATABASE()")) {
            if (!result.next() || !database.equals(result.getString(1))) {
                throw new BootstrapFailure(BootstrapFailure.Reason.TARGET_MISMATCH);
            }
        }
    }

    /** 使用目标库的摘要作为服务器级命名锁，多个进程共享且不暴露连接或库名。 */
    static String lockName(String database) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(database.toLowerCase(Locale.ROOT).getBytes(StandardCharsets.UTF_8));
            return "bf:init:" + HexFormat.of().formatHex(digest).substring(0, 56);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("Required database lock digest unavailable");
        }
    }

    /** 命名锁覆盖检查与提交，超时或服务端无法加锁均拒绝初始化。 */
    private static void acquireLock(Connection connection, String name) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("SELECT GET_LOCK(?, 10)")) {
            statement.setString(1, name);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next() || result.getInt(1) != 1 || result.wasNull()) {
                    throw new BootstrapFailure(BootstrapFailure.Reason.BOOTSTRAP_BUSY);
                }
            }
        }
    }

    /** 无论提交还是回滚都释放连接级锁；连接关闭也是服务端释放的最终边界。 */
    private static void releaseLock(Connection connection, String name) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("SELECT RELEASE_LOCK(?)")) {
            statement.setString(1, name);
            statement.execute();
        }
    }

    /** 所有身份表与角色表均须存在且使用 InnoDB，否则回滚和空表间隙锁不能成立。 */
    private static void verifyTransactionalTables(Connection connection, String database) throws SQLException {
        Set<String> expected = new HashSet<>(IDENTITY_TABLES);
        expected.add("system_role");
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?")) {
            statement.setString(1, database);
            try (ResultSet result = statement.executeQuery()) {
                while (result.next()) {
                    String name = result.getString(1);
                    if (expected.contains(name) && "InnoDB".equalsIgnoreCase(result.getString(2))) {
                        expected.remove(name);
                    }
                }
            }
        }
        if (!expected.isEmpty()) {
            throw new BootstrapFailure(BootstrapFailure.Reason.NON_TRANSACTIONAL_SCHEMA);
        }
    }

    /** RR 下主键当前读锁住空表 supremum；误指已有库时最多读取一行后拒绝。 */
    private static void assertEmptyAndLock(Connection connection, String table) throws SQLException {
        // 表名只来自本类固定列表，不接受配置、HTTP 或命令行输入。
        try (Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery("SELECT id FROM " + table + " FORCE INDEX (PRIMARY) LIMIT 1 FOR UPDATE")) {
            if (result.next()) {
                throw new BootstrapFailure(BootstrapFailure.Reason.NONEMPTY_IDENTITIES);
            }
        }
    }

    /** 必须有且仅有一个启用、未删除、平台及编码精确匹配的内置超级管理员角色。 */
    private static long selectAdminRoleForUpdate(Connection connection) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT id, code, role_type, status, type, deleted FROM system_role WHERE code = ? FOR UPDATE")) {
            statement.setString(1, ADMIN_PLATFORM);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next() || !ADMIN_PLATFORM.equals(result.getString("code"))
                        || !ADMIN_PLATFORM.equals(result.getString("role_type"))
                        || result.getInt("status") != 0 || result.getInt("type") != 1 || result.getBoolean("deleted")) {
                    throw new BootstrapFailure(BootstrapFailure.Reason.INVALID_ADMIN_ROLE);
                }
                long id = result.getLong("id");
                if (result.next()) {
                    throw new BootstrapFailure(BootstrapFailure.Reason.INVALID_ADMIN_ROLE);
                }
                return id;
            }
        }
    }

    /** 初始账号不绑定示例部门，不生成可复用固定口令或首次改密状态。 */
    private static long insertUser(Connection connection, String username, String encoded) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO system_users (username, password, user_type, nickname, status, creator, updater)"
                        + " VALUES (?, ?, ?, ?, 0, 'bootstrap', 'bootstrap')", Statement.RETURN_GENERATED_KEYS)) {
            statement.setString(1, username);
            statement.setString(2, encoded);
            statement.setString(3, ADMIN_PLATFORM);
            statement.setString(4, username);
            if (statement.executeUpdate() != SINGLE_ROW_AFFECTED) {
                throw new SQLException("Bootstrap insert failed");
            }
            try (ResultSet keys = statement.getGeneratedKeys()) {
                if (!keys.next()) {
                    throw new SQLException("Bootstrap generated ID unavailable");
                }
                return keys.getLong(1);
            }
        }
    }

    /** 角色关联与账号处于同一事务，任何关联写入失败都不能留下无权账号。 */
    private static void insertUserRole(Connection connection, long userId, long roleId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO system_user_role (user_id, role_id, creator, updater)"
                        + " VALUES (?, ?, 'bootstrap', 'bootstrap')")) {
            statement.setLong(1, userId);
            statement.setLong(2, roleId);
            if (statement.executeUpdate() != SINGLE_ROW_AFFECTED) {
                throw new SQLException("Bootstrap role grant failed");
            }
        }
    }
}
