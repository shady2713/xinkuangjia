package com.basicframework.framework.mybatis.core.util;

import com.basicframework.framework.common.util.spring.SpringUtils;
import com.baomidou.dynamic.datasource.DynamicRoutingDataSource;
import com.baomidou.mybatisplus.annotation.DbType;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import javax.sql.DataSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证 JDBC 工具类的连接探测、URL 方言识别与容器内数据源探测。
 *
 * <p>这些方法决定启动期与运行期的数据库类型判定：连接探测误判会让运维看到"连接正常"却连不上库；
 * URL 方言识别错误会让分页与 ID 策略走错分支；容器探测取错数据源会在多数据源环境下
 * 把主库类型读成从库类型。因此除纯 URL 映射外，全部使用真实 MySQL 与真实 Spring 容器。</p>
 *
 * <p>需要外部注入隔离 MySQL 连接；缺失环境变量时直接失败，不退化成跳过。断言只使用连接是否成功、
 * 数据库类型枚举与异常类型，不回显账号、口令或完整连接串。</p>
 *
 * @author shady2713
 */
class JdbcUtilsTest {

    /** 进入用例前的静态 Spring 上下文，结束后原样恢复，避免污染同 JVM 的其它测试。 */
    private ApplicationContext previousContext;
    /** 本用例创建的全部容器，结束时统一关闭。 */
    private AnnotationConfigApplicationContext context;
    /** 隔离 MySQL 连接串。 */
    private String mysqlUrl;
    /** 隔离 MySQL 账号。 */
    private String mysqlUsername;
    /** 隔离 MySQL 口令，仅注入测试子进程。 */
    private String mysqlPassword;

    /** 记录静态上下文并读取隔离数据库连接参数。 */
    @BeforeEach
    void setUp() {
        previousContext = SpringUtils.getApplicationContext();
        mysqlUrl = requiredEnvironment("AUTH_TEST_MYSQL_URL");
        mysqlUsername = requiredEnvironment("AUTH_TEST_MYSQL_USERNAME");
        mysqlPassword = requiredEnvironment("AUTH_TEST_MYSQL_PASSWORD");
    }

    /** 关闭容器并还原静态上下文。 */
    @AfterEach
    void tearDown() {
        if (context != null) {
            context.close();
            context = null;
        }
        new SpringUtils().setApplicationContext(previousContext);
    }

    /** 可连通的隔离库必须判定为连接正常，错误口令与不可达端口必须判定为失败。 */
    @Test
    void isConnectionOKReflectsRealConnectivity() {
        assertThat(JdbcUtils.isConnectionOK(mysqlUrl, mysqlUsername, mysqlPassword))
                .as("隔离库必须真实可连通").isTrue();
        assertThat(JdbcUtils.isConnectionOK(mysqlUrl, mysqlUsername, "CHANGE_ME_WRONG_PASSWORD"))
                .as("口令错误必须判定为失败").isFalse();
        assertThat(JdbcUtils.isConnectionOK(
                "jdbc:mysql://127.0.0.1:1/basic_framework_probe?connectTimeout=300", "DUMMY-USER", "CHANGE_ME_PASSWORD"))
                .as("端口不可达必须判定为失败而不是抛错").isFalse();
    }

    /** URL 方言识别必须覆盖项目支持的数据库前缀。 */
    @Test
    void getDbTypeByUrlRecognisesDialects() {
        assertThat(JdbcUtils.getDbType("jdbc:mysql://127.0.0.1:3306/basic_framework?useSSL=false"))
                .isEqualTo(DbType.MYSQL);
        assertThat(JdbcUtils.getDbType("jdbc:h2:mem:basic_framework")).isEqualTo(DbType.H2);
        assertThat(JdbcUtils.getDbType("jdbc:postgresql://127.0.0.1:5432/basic_framework")).isEqualTo(DbType.POSTGRE_SQL);
        assertThat(JdbcUtils.getDbType("jdbc:oracle:thin:@127.0.0.1:1521:xe")).isEqualTo(DbType.ORACLE);
    }

    /**
     * 容器中只有普通数据源时必须回退到该数据源读取真实数据库类型。
     *
     * <p>这是单数据源环境的常见装配：没有 {@code DynamicRoutingDataSource}，
     * 工具类必须能回退而不是把"缺少动态数据源"当成失败。</p>
     */
    @Test
    void getDbTypeFallsBackToPlainDataSource() {
        DataSource dataSource = new DriverManagerDataSource(mysqlUrl, mysqlUsername, mysqlPassword);
        context = new AnnotationConfigApplicationContext();
        context.registerBean(DataSource.class, () -> dataSource);
        context.refresh();
        new SpringUtils().setApplicationContext(context);

        assertThat(JdbcUtils.getDbType()).as("必须从真实连接元数据读到 MySQL").isEqualTo(DbType.MYSQL);
    }

    /** 容器中存在动态数据源时必须优先读取其确定数据源，而不是容器里的任意数据源。 */
    @Test
    void getDbTypePrefersDynamicRoutingDataSource() {
        DataSource mysql = new DriverManagerDataSource(mysqlUrl, mysqlUsername, mysqlPassword);
        DataSource unreachable = new DriverManagerDataSource(
                "jdbc:mysql://127.0.0.1:1/basic_framework_probe?connectTimeout=300", "DUMMY-USER", "CHANGE_ME_PASSWORD");
        DynamicRoutingDataSource routing = new DynamicRoutingDataSource(java.util.Collections.emptyList());
        routing.addDataSource("probe-unreachable", unreachable);
        routing.addDataSource("master", mysql);
        routing.setPrimary("master");
        context = new AnnotationConfigApplicationContext();
        context.registerBean(DataSource.class, () -> unreachable);
        context.registerBean(DynamicRoutingDataSource.class, () -> routing);
        context.refresh();
        new SpringUtils().setApplicationContext(context);

        assertThat(JdbcUtils.getDbType()).as("必须读取动态数据源的主库而不是容器里的其它数据源")
                .isEqualTo(DbType.MYSQL);
    }

    /** 数据源无法建立连接时必须抛出带原因的显式失败，不能返回猜测的数据库类型。 */
    @Test
    void getDbTypeFailsWhenConnectionUnavailable() {
        DataSource unreachable = new DriverManagerDataSource(
                "jdbc:mysql://127.0.0.1:1/basic_framework_probe?connectTimeout=300", "DUMMY-USER", "CHANGE_ME_PASSWORD");
        context = new AnnotationConfigApplicationContext();
        context.registerBean(DataSource.class, () -> unreachable);
        context.refresh();
        new SpringUtils().setApplicationContext(context);

        assertThatThrownBy(JdbcUtils::getDbType)
                .isInstanceOf(IllegalStateException.class).hasMessage("读取当前数据库类型失败");
    }

    /** SQL Server 判定必须同时覆盖两个版本枚举，其它数据库与空值都不得误判。 */
    @Test
    void isSQLServerMatchesBothVersionsOnly() {
        assertThat(JdbcUtils.isSQLServer("jdbc:sqlserver://127.0.0.1:1433;databaseName=basic_framework")).isTrue();
        assertThat(JdbcUtils.isSQLServer("jdbc:mysql://127.0.0.1:3306/basic_framework")).isFalse();
        assertThat(JdbcUtils.isSQLServer(DbType.SQL_SERVER)).isTrue();
        assertThat(JdbcUtils.isSQLServer(DbType.SQL_SERVER2005)).as("2005 版本同样属于 SQL Server").isTrue();
        assertThat(JdbcUtils.isSQLServer(DbType.MYSQL)).isFalse();
        assertThat(JdbcUtils.isSQLServer((DbType) null)).as("未识别的类型不得判成 SQL Server").isFalse();
    }

    /**
     * 工具类未声明私有构造，实例化不得改变静态入口的行为。
     *
     * <p>该类没有实例状态，构造方法属于真实可调用面；断言实例化后静态判断仍按同一规则工作，
     * 防止未来把共享状态放进实例，导致按实例使用与静态入口读到不同结果。</p>
     */
    @Test
    void instantiationKeepsStaticEntryBehaviour() {
        new JdbcUtils();

        assertThat(JdbcUtils.isSQLServer(DbType.SQL_SERVER)).isTrue();
        assertThat(JdbcUtils.isSQLServer(DbType.MYSQL)).isFalse();
    }

    /** 缺失隔离环境时直接失败，避免退化成跳过真实数据库证据。 */
    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("缺少隔离测试环境变量 " + name);
        }
        return value;
    }

}
