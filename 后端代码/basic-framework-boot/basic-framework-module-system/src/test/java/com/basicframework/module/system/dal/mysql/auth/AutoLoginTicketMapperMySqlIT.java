package com.basicframework.module.system.dal.mysql.auth;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.module.system.dal.dataobject.auth.AutoLoginTicketDO;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.mybatis.spring.mapper.MapperFactoryBean;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.UUID;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 用独立 MySQL 库与生产 Mapper 验证自动登录分享码的查询、状态与逻辑删除边界。
 *
 * <p>分享码长期有效，是否允许继续使用只由数据行状态决定：按分享码查询一旦漏掉逻辑删除或映射错列，
 * 停用或已删除的分享码仍能完成自动登录，属于凭据层面的越权。这里必须用真实 SQL 证明条件与映射，
 * 不能用 Mock 代替。</p>
 *
 * <p>显式执行此集成入口必须提供环回测试环境，缺失环境直接失败，不连接业务库。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AutoLoginTicketMapperMySqlIT {

    /** 本测试使用的生产建表语句。 */
    private static final String TICKET_TABLE = "system_auto_login_ticket";

    /** 本测试独占的随机库名，结束时整体删除。 */
    private final String schema = "bf_auto_login_" + UUID.randomUUID().toString().replace("-", "");

    /** 测试装配的上下文，持有真实数据源与 Mapper。 */
    private AnnotationConfigApplicationContext context;
    /** 直连测试库的 JDBC 模板，用于在 Mapper 之外观察持久状态。 */
    private JdbcTemplate jdbc;
    /** 被测生产 Mapper。 */
    private AutoLoginTicketMapper ticketMapper;
    /** 管理连接使用的库级 URL，用于建库与删库。 */
    private String adminUrl;
    /** 隔离测试账号。 */
    private String databaseUser;
    /** 隔离测试口令。 */
    private String databasePassword;
    /** 是否已真实建库，决定结束时是否需要回收。 */
    private boolean schemaCreated;

    /** 建立随机数据库并只导入生产分享码表；不导入种子数据。 */
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
        String ddl = Files.readString(repositoryRoot().resolve("数据库文件/basic_framework.sql"));
        var matcher = Pattern.compile("CREATE TABLE `" + TICKET_TABLE + "`[\\s\\S]*?;").matcher(ddl);
        assertThat(matcher.find()).as("生产表 %s 必须存在", TICKET_TABLE).isTrue();
        jdbc.execute(matcher.group());

        context = new AnnotationConfigApplicationContext();
        context.registerBean(DataSource.class, () -> dataSource);
        context.registerBean(SqlSessionFactory.class, () -> sqlSessionFactory(dataSource));
        context.registerBean(AutoLoginTicketMapper.class, () -> {
            try {
                MapperFactoryBean<AutoLoginTicketMapper> factory =
                        new MapperFactoryBean<>(AutoLoginTicketMapper.class);
                factory.setSqlSessionFactory(context.getBean(SqlSessionFactory.class));
                factory.afterPropertiesSet();
                return factory.getObject();
            } catch (Exception failure) {
                throw new IllegalStateException("自动登录分享码测试 Mapper 创建失败", failure);
            }
        });
        context.refresh();
        ticketMapper = context.getBean(AutoLoginTicketMapper.class);
    }

    /** 每例清空分享码表，避免跨用例的唯一键冲突污染查询结果。 */
    @BeforeEach
    void resetFixtures() {
        jdbc.update("DELETE FROM " + TICKET_TABLE);
    }

    /** 按分享码查询必须返回真实映射的整行数据，字段不能错列或丢失。 */
    @Test
    void selectByTicketReturnsFullyMappedRow() {
        AutoLoginTicketDO ticket = ticket("share-token-alpha", "admin", CommonStatusEnum.ENABLE.getStatus(), "运维分享");

        ticketMapper.insert(ticket);

        AutoLoginTicketDO found = ticketMapper.selectByTicket("share-token-alpha");
        assertThat(found).as("已写入的分享码必须能被真实查到").isNotNull();
        assertThat(found.getId()).isEqualTo(ticket.getId());
        assertThat(found.getTicket()).isEqualTo("share-token-alpha");
        assertThat(found.getUsername()).isEqualTo("admin");
        assertThat(found.getStatus()).isEqualTo(CommonStatusEnum.ENABLE.getStatus());
        assertThat(found.getRemark()).isEqualTo("运维分享");
        assertThat(found.getDeleted()).as("新建记录必须落在未删除状态").isFalse();
        assertThat(found.getCreateTime()).as("审计时间必须由真实填充器写入").isNotNull();
    }

    /** 未知分享码必须返回 null，调用方据此拒绝自动登录而不是拿到半空对象。 */
    @Test
    void selectByTicketReturnsNullForUnknownTicket() {
        ticketMapper.insert(ticket("share-token-beta", "admin", CommonStatusEnum.ENABLE.getStatus(), null));

        assertThat(ticketMapper.selectByTicket("share-token-unknown")).isNull();
        assertThat(ticketMapper.selectByTicket("share-token-beta")).isNotNull();
    }

    /** 停用状态原样映射，登录入口才能据状态拒绝已停用的分享码。 */
    @Test
    void selectByTicketKeepsDisabledStatus() {
        ticketMapper.insert(ticket("share-token-disabled", "admin", CommonStatusEnum.DISABLE.getStatus(), null));

        AutoLoginTicketDO found = ticketMapper.selectByTicket("share-token-disabled");

        assertThat(found.getStatus()).isEqualTo(CommonStatusEnum.DISABLE.getStatus());
    }

    /** 逻辑删除的分享码不再可查，且删除不物理移除数据行。 */
    @Test
    void selectByTicketIgnoresLogicallyDeletedRow() {
        AutoLoginTicketDO ticket = ticket("share-token-deleted", "admin", CommonStatusEnum.ENABLE.getStatus(), null);
        ticketMapper.insert(ticket);

        ticketMapper.deleteById(ticket.getId());

        assertThat(ticketMapper.selectByTicket("share-token-deleted")).as("已删除分享码不得再用于登录").isNull();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + TICKET_TABLE, Integer.class))
                .as("逻辑删除必须保留数据行").isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT deleted FROM " + TICKET_TABLE, Boolean.class))
                .as("删除标记必须真实落库").isTrue();
    }

    /** 关闭上下文并删除随机数据库；异常时也继续回收。 */
    @AfterAll
    void closeEnvironment() throws Exception {
        try {
            if (context != null) {
                context.close();
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

    /** 构造只包含本用例所需字段的分享码记录。 */
    private static AutoLoginTicketDO ticket(String ticket, String username, Integer status, String remark) {
        AutoLoginTicketDO autoLoginTicket = new AutoLoginTicketDO();
        autoLoginTicket.setTicket(ticket);
        autoLoginTicket.setUsername(username);
        autoLoginTicket.setStatus(status);
        autoLoginTicket.setRemark(remark);
        return autoLoginTicket;
    }

    /** 缺失隔离环境时直接失败，避免退化成跳过真实数据库证据。 */
    private String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("缺少隔离测试环境变量 " + name);
        }
        return value;
    }

    /** 定位版本控制中的生产 DDL，不依赖测试进程从哪个模块启动。 */
    private Path repositoryRoot() {
        Path directory = Path.of("").toAbsolutePath();
        while (directory != null && !Files.isRegularFile(directory.resolve("数据库文件/basic_framework.sql"))) {
            directory = directory.getParent();
        }
        if (directory == null) {
            throw new IllegalStateException("未找到框架空库基线");
        }
        return directory;
    }

    /** 使用真实 MyBatis 配置与审计填充器，防止内存替身掩盖映射错误。 */
    private SqlSessionFactory sqlSessionFactory(DataSource dataSource) {
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
        } catch (Exception failure) {
            throw new IllegalStateException("自动登录分享码测试 Mapper 初始化失败", failure);
        }
    }
}
