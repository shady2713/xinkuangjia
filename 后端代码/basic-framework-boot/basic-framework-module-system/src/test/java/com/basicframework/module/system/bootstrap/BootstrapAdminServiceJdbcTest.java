package com.basicframework.module.system.bootstrap;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证初始化服务在 JDBC 返回“异常但语法合法”结果时的拒绝行为。
 *
 * <p>真实 MySQL 对单行 INSERT 只会返回 1 或抛错，因此“影响行数不是 1”“自增键缺失”
 * 与“实际会话库名不匹配”在真实数据库上不可复现；但这些判定是防止半写入账号、
 * 错库写入的最后一道防线，必须能被单独验证。用例用 JDBC 接口替身构造这些返回，
 * 断言每个异常出口都抛出固定分类或固定消息，且事务内的语句确实被执行过。</p>
 *
 * <p><b>白盒直调：</b>三个方法都是私有静态方法，只被同类的事务流程调用；反射直调配合
 * JDBC 接口替身是仓库既有手法（同类证据中已用 {@code mockStatic} 覆盖口令编码分支）。</p>
 *
 * @author shady2713
 */
class BootstrapAdminServiceJdbcTest {

    /** 单行插入 SQL 中必须出现的账号表名，用于确认用例打桩的是正确语句。 */
    private static final String USER_INSERT_TABLE = "INSERT INTO system_users";

    /**
     * 实际会话库名与期望不一致时必须按目标不匹配拒绝。
     *
     * <p>初始化会写入真实数据，连错库（例如 URL 被中间件改写、服务器库名大小写归一）
     * 会把管理员账号建到别的库；这里断言拒绝分类，并断言查询语句与结果集都被关闭。</p>
     *
     * @throws Exception 反射查找失败时抛出
     */
    @Test
    void verifyDatabaseRejectsMismatchedSessionDatabase() throws Exception {
        Connection connection = mock(Connection.class);
        Statement statement = mock(Statement.class);
        ResultSet result = mock(ResultSet.class);
        when(connection.createStatement()).thenReturn(statement);
        when(statement.executeQuery("SELECT DATABASE()")).thenReturn(result);
        when(result.next()).thenReturn(true);
        when(result.getString(1)).thenReturn("other_db");

        Method method = BootstrapAdminService.class
                .getDeclaredMethod("verifyDatabase", Connection.class, String.class);
        method.setAccessible(true);
        InvocationTargetException thrown = catchThrowableOfType(
                () -> method.invoke(null, connection, "expected_db"), InvocationTargetException.class);

        assertThat(thrown).as("库名不一致必须拒绝而不是继续写入").isNotNull();
        assertThat(thrown.getCause()).isInstanceOf(BootstrapFailure.class)
                .hasMessage(BootstrapFailure.Reason.TARGET_MISMATCH.name());
        verify(statement).close();
        verify(result).close();
    }

    /**
     * 账号插入影响行数不是 1 时必须失败，避免半写入账号被当成初始化成功。
     *
     * <p>影响行数为 0 表示语句没有真正插入（例如被触发器或代理丢弃），
     * 此时若继续下发角色关联，会留下没有账号的孤立关联。</p>
     *
     * @throws Exception 反射查找失败时抛出
     */
    @Test
    void insertUserRejectsNonSingleRowInsert() throws Exception {
        Connection connection = mock(Connection.class);
        PreparedStatement statement = mock(PreparedStatement.class);
        when(connection.prepareStatement(anyString(),
                eq(Statement.RETURN_GENERATED_KEYS))).thenReturn(statement);
        when(statement.executeUpdate()).thenReturn(0);

        Method method = BootstrapAdminService.class
                .getDeclaredMethod("insertUser", Connection.class, String.class, String.class);
        method.setAccessible(true);
        InvocationTargetException thrown = catchThrowableOfType(
                () -> method.invoke(null, connection, "probe_admin", "probe-encoded"),
                InvocationTargetException.class);

        assertThat(thrown).as("影响行数不是 1 时必须失败").isNotNull();
        assertThat(thrown.getCause()).isInstanceOf(SQLException.class)
                .hasMessage("Bootstrap insert failed");
        assertThat(capturedUserInsertSql(connection)).as("必须插入账号表").contains(USER_INSERT_TABLE);
        verify(statement).setString(1, "probe_admin");
    }

    /**
     * 自增主键缺失时必须失败，避免把 0 号账号写进角色关联。
     *
     * <p>驱动未返回自增键时拿到的是默认值 0，继续写入会产生指向不存在账号的关联记录。</p>
     *
     * @throws Exception 反射查找失败时抛出
     */
    @Test
    void insertUserRejectsMissingGeneratedKey() throws Exception {
        Connection connection = mock(Connection.class);
        PreparedStatement statement = mock(PreparedStatement.class);
        ResultSet keys = mock(ResultSet.class);
        when(connection.prepareStatement(anyString(),
                eq(Statement.RETURN_GENERATED_KEYS))).thenReturn(statement);
        when(statement.executeUpdate()).thenReturn(1);
        when(statement.getGeneratedKeys()).thenReturn(keys);
        when(keys.next()).thenReturn(false);

        Method method = BootstrapAdminService.class
                .getDeclaredMethod("insertUser", Connection.class, String.class, String.class);
        method.setAccessible(true);
        InvocationTargetException thrown = catchThrowableOfType(
                () -> method.invoke(null, connection, "probe_admin", "probe-encoded"),
                InvocationTargetException.class);

        assertThat(thrown).as("缺少自增主键时必须失败").isNotNull();
        assertThat(thrown.getCause()).isInstanceOf(SQLException.class)
                .hasMessage("Bootstrap generated ID unavailable");
        verify(keys).close();
    }

    /**
     * 角色关联写入影响行数不是 1 时必须失败，避免留下无权限的管理员账号。
     *
     * <p>账号与关联在同一事务里：关联写入被静默丢弃会得到“能登录但没有任何权限”的初始管理员，
     * 现场只能靠人工排查恢复。</p>
     *
     * @throws Exception 反射查找失败时抛出
     */
    @Test
    void insertUserRoleRejectsNonSingleRowInsert() throws Exception {
        Connection connection = mock(Connection.class);
        PreparedStatement statement = mock(PreparedStatement.class);
        when(connection.prepareStatement(anyString())).thenReturn(statement);
        when(statement.executeUpdate()).thenReturn(0);

        Method method = BootstrapAdminService.class
                .getDeclaredMethod("insertUserRole", Connection.class, long.class, long.class);
        method.setAccessible(true);
        InvocationTargetException thrown = catchThrowableOfType(
                () -> method.invoke(null, connection, 7L, 9L), InvocationTargetException.class);

        assertThat(thrown).as("关联写入影响行数不是 1 时必须失败").isNotNull();
        assertThat(thrown.getCause()).isInstanceOf(SQLException.class)
                .hasMessage("Bootstrap role grant failed");
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(connection).prepareStatement(sql.capture());
        assertThat(sql.getValue()).as("必须写入角色关联表").contains("INSERT INTO system_user_role");
        verify(statement).setLong(1, 7L);
        verify(statement).setLong(2, 9L);
    }

    /**
     * 读取账号插入实际使用的 SQL 文本。
     *
     * @param connection 被验证的连接替身
     * @return 账号插入语句
     */
    private static String capturedUserInsertSql(Connection connection) throws SQLException {
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(connection).prepareStatement(sql.capture(), eq(Statement.RETURN_GENERATED_KEYS));
        return sql.getValue();
    }

    /**
     * 角色查询返回两行时必须按“内置管理员角色不唯一”拒绝，不能只取第一行继续初始化。
     *
     * <p>唯一索引只约束合规数据库；被代理改写的结果集、指向已有库的连接、读库与写库不一致，
     * 都可能让同一条 SQL 返回两行。此时若沿用第一行，初始化出来的账号会绑定到不确定的角色上，
     * 而权限审计看到的是一条“成功”记录，现场无法回放。这里锁定“第二行存在即拒绝”的分类。</p>
     *
     * <p><b>边界替身：</b>{@link ResultSet} 用 JDK 动态代理实现，只替换 JDBC 依赖边界；
     * 真实执行的是 {@code selectAdminRoleForUpdate} 自身的行判定、字段校验、异常抛出与
     * try-with-resources 资源关闭。用例同时统计 {@code next()} 的调用次数，
     * 证明拒绝来自第二行而不是字段校验——整体 Mock 被测方法无法产生这种区分。</p>
     *
     * @throws Exception 反射查找或结果集构造失败时抛出
     */
    @Test
    void selectAdminRoleForUpdateRejectsSecondRow() throws Exception {
        long adminRoleId = 7L;
        List<String> nextCalls = new ArrayList<>();
        ResultSet twoRows = (ResultSet) Proxy.newProxyInstance(
                BootstrapAdminServiceJdbcTest.class.getClassLoader(),
                new Class<?>[]{ResultSet.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "next" -> {
                        nextCalls.add("next");
                        yield nextCalls.size() <= 2;
                    }
                    case "getString" -> adminPlatform();
                    // 第一行的状态与类型都必须合法，否则会在字段校验处提前拒绝；
                    // 本用例要证明的是“第二行存在”这一独立出口。
                    case "getInt" -> "status".equals(args[0]) ? 0 : 1;
                    case "getBoolean" -> false;
                    case "getLong" -> adminRoleId;
                    case "close" -> null;
                    case "isWrapperFor" -> false;
                    case "toString" -> "ResultSet(two admin role rows)";
                    case "hashCode" -> System.identityHashCode(proxy);
                    case "equals" -> proxy == args[0];
                    default -> throw new UnsupportedOperationException("未预期的结果集调用：" + method.getName());
                });
        PreparedStatement statement = mock(PreparedStatement.class);
        Connection connection = mock(Connection.class);
        when(connection.prepareStatement(anyString())).thenReturn(statement);
        when(statement.executeQuery()).thenReturn(twoRows);

        Method method = BootstrapAdminService.class.getDeclaredMethod("selectAdminRoleForUpdate", Connection.class);
        method.setAccessible(true);
        InvocationTargetException thrown = catchThrowableOfType(
                () -> method.invoke(null, connection), InvocationTargetException.class);

        assertThat(thrown).as("两行内置管理员角色必须拒绝").isNotNull();
        assertThat(thrown.getCause()).isInstanceOf(BootstrapFailure.class)
                .hasMessage(BootstrapFailure.Reason.INVALID_ADMIN_ROLE.name());
        assertThat(nextCalls).as("第一行字段全部合法，必须读到第二行才拒绝").hasSize(2);
        verify(statement).setString(1, adminPlatform());
        verify(statement).close();
    }

    /**
     * 读取被测类内置的管理员平台编码，避免在用例中复制一份可能与生产实现漂移的字面量。
     *
     * @return 内置管理员平台编码
     * @throws Exception 字段查找或读取失败时抛出
     */
    private static String adminPlatform() throws Exception {
        Field field = BootstrapAdminService.class.getDeclaredField("ADMIN_PLATFORM");
        field.setAccessible(true);
        return (String) field.get(null);
    }

}
