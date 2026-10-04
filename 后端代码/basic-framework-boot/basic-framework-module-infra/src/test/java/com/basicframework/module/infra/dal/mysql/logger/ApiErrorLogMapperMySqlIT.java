package com.basicframework.module.infra.dal.mysql.logger;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
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
import java.time.LocalDateTime;
import java.util.UUID;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 用独立 MySQL 库、生产 Mapper 和生产建表语句验证错误日志的分批清理。
 *
 * <p>该实现与其他日志清理不同：它先用"只查主键、不查总数"的一页查询取出编号，
 * 再按编号批量逻辑删除。这里有两条真实风险：截止时间比较若写成"小于等于"，
 * 会把恰好落在保留期边界的记录提前删除；批次选择若不加数量上限或顺序不稳定，
 * 清理会长时间持有行锁、或在批次之间重复取到同一批已删除记录而永远无法收敛。
 * 这些都由生成的 SQL 决定，Mock 无法证明，因此必须在真实表上观察。</p>
 *
 * <p>断言同时核对逻辑删除标记与可查询行数，确认清理走的是逻辑删除而不是物理删除。</p>
 *
 * <p>显式执行此集成入口必须提供环回测试环境，缺失环境直接失败，不连接业务库。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ApiErrorLogMapperMySqlIT {

    /** 本测试使用的生产建表语句所在表名。 */
    private static final String LOG_TABLE = "infra_api_error_log";
    /** 单批删除上限，与生产定时任务配置口径一致。 */
    private static final int DELETE_LIMIT = 100;

    /** 本测试独占的随机库名，结束时整体删除。 */
    private final String schema = "bf_errlog_" + UUID.randomUUID().toString().replace("-", "");

    /** 测试装配的上下文，持有真实数据源与生产 Mapper。 */
    private AnnotationConfigApplicationContext context;
    /** 直连测试库的 JDBC 模板，用于在 Mapper 之外观察持久状态。 */
    private JdbcTemplate jdbc;
    /** 被测错误日志 Mapper。 */
    private ApiErrorLogMapper apiErrorLogMapper;
    /** 管理连接使用的库级 URL，用于建库与删库。 */
    private String adminUrl;
    /** 隔离测试账号。 */
    private String databaseUser;
    /** 隔离测试口令。 */
    private String databasePassword;
    /** 是否已真实建库，决定结束时是否需要回收。 */
    private boolean schemaCreated;

    /** 建立随机数据库并只导入生产错误日志表，避免影响其他数据。 */
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
        var matcher = Pattern.compile("CREATE TABLE `" + LOG_TABLE + "`[\\s\\S]*?;").matcher(ddl);
        assertThat(matcher.find()).as("生产表 %s 必须存在", LOG_TABLE).isTrue();
        jdbc.execute(matcher.group());

        context = new AnnotationConfigApplicationContext();
        context.registerBean(DataSource.class, () -> dataSource);
        context.registerBean(SqlSessionFactory.class, () -> sqlSessionFactory(dataSource));
        context.registerBean(ApiErrorLogMapper.class, () -> {
            try {
                MapperFactoryBean<ApiErrorLogMapper> factory = new MapperFactoryBean<>(ApiErrorLogMapper.class);
                factory.setSqlSessionFactory(context.getBean(SqlSessionFactory.class));
                factory.afterPropertiesSet();
                return factory.getObject();
            } catch (Exception failure) {
                throw new IllegalStateException("错误日志测试 Mapper 创建失败", failure);
            }
        });
        context.refresh();
        apiErrorLogMapper = context.getBean(ApiErrorLogMapper.class);
    }

    /** 每例清空错误日志表，避免跨用例计数互相影响。 */
    @BeforeEach
    void resetFixtures() {
        jdbc.update("DELETE FROM " + LOG_TABLE);
    }

    /**
     * 没有早于截止时间的记录时返回 0，且不得执行任何删除。
     *
     * <p>该分支若被写成"无条件按页删除"，定时清理会在没有过期数据时也产生写操作与行锁。</p>
     */
    @Test
    void noExpiredRowReturnsZeroAndKeepsEveryRow() {
        seedLog(seconds(LocalDateTime.now()));
        seedLog(seconds(LocalDateTime.now()).plusHours(1));

        Integer deleted = apiErrorLogMapper.deleteByCreateTimeLt(seconds(LocalDateTime.now()).minusDays(1),
                DELETE_LIMIT);

        assertThat(deleted).isZero();
        assertThat(countActiveLogs()).isEqualTo(2);
        assertThat(countDeletedLogs()).isZero();
    }

    /**
     * 严格早于截止时间的记录被逻辑删除，恰好等于截止时间的记录必须保留。
     *
     * <p>保留期边界用"小于"而不是"小于等于"：写成后者会把边界当天的记录提前清掉。</p>
     */
    @Test
    void rowsStrictlyBeforeCutoffAreLogicallyDeleted() {
        LocalDateTime cutoff = seconds(LocalDateTime.now());
        Long expiredFirst = seedLog(cutoff.minusDays(2));
        Long expiredSecond = seedLog(cutoff.minusDays(1));
        Long onCutoff = seedLog(cutoff);
        Long afterCutoff = seedLog(cutoff.plusDays(1));

        Integer deleted = apiErrorLogMapper.deleteByCreateTimeLt(cutoff, DELETE_LIMIT);

        assertThat(deleted).as("只应删除严格早于截止时间的两条").isEqualTo(2);
        assertThat(countDeletedLogs()).isEqualTo(2);
        assertThat(countActiveLogs()).isEqualTo(2);
        assertThat(isDeleted(expiredFirst)).as("过期记录必须标记为已删除").isTrue();
        assertThat(isDeleted(expiredSecond)).isTrue();
        assertThat(isDeleted(onCutoff)).as("等于截止时间的记录不得被删除").isFalse();
        assertThat(isDeleted(afterCutoff)).isFalse();
    }

    /**
     * 单批删除数量必须受上限约束，只删除最早的一批。
     *
     * <p>批次选择按编号升序：若顺序不稳定，批次之间会重复取到同一批已删除记录，
     * 清理永远无法推进。</p>
     */
    @Test
    void singleBatchDeletesAtMostConfiguredLimit() {
        LocalDateTime cutoff = seconds(LocalDateTime.now());
        Long oldest = seedLog(cutoff.minusHours(5));
        Long secondOldest = seedLog(cutoff.minusHours(4));
        for (int index = 3; index <= 5; index++) {
            seedLog(cutoff.minusHours(index));
        }

        Integer deleted = apiErrorLogMapper.deleteByCreateTimeLt(cutoff, 2);

        assertThat(deleted).as("单批不得超过上限").isEqualTo(2);
        assertThat(countDeletedLogs()).isEqualTo(2);
        assertThat(countActiveLogs()).isEqualTo(3);
        assertThat(isDeleted(oldest)).as("必须从最早的记录开始").isTrue();
        assertThat(isDeleted(secondOldest)).isTrue();
    }

    /** 反复调用必须能推进清理直到没有过期记录，返回 0 表示收敛。 */
    @Test
    void repeatedBatchesEventuallyDeleteEveryExpiredRow() {
        LocalDateTime cutoff = seconds(LocalDateTime.now());
        for (int index = 0; index < 5; index++) {
            seedLog(cutoff.minusHours(index + 1));
        }
        seedLog(cutoff);

        int totalDeleted = 0;
        for (int round = 0; round < 10; round++) {
            Integer deleted = apiErrorLogMapper.deleteByCreateTimeLt(cutoff, 2);
            totalDeleted += deleted;
            if (deleted == 0) {
                break;
            }
        }

        assertThat(totalDeleted).as("全部分批累计必须覆盖所有过期记录").isEqualTo(5);
        assertThat(countActiveLogs()).as("保留期内的记录必须留存").isEqualTo(1);
        assertThat(countDeletedLogs()).isEqualTo(5);
    }

    /**
     * 写入一条指定创建时间的错误日志。
     *
     * <p>按生产建表语句的必填列写入，创建时间由调用方指定以构造确定的时间边界。</p>
     *
     * @param createTime 日志创建时间
     * @return 新插入日志的主键
     */
    private Long seedLog(LocalDateTime createTime) {
        jdbc.update("INSERT INTO " + LOG_TABLE + " (trace_id, user_id, user_type, application_name, "
                        + "request_method, request_url, request_params, user_ip, user_agent, exception_time, "
                        + "exception_name, exception_message, exception_root_cause_message, exception_stack_trace, "
                        + "exception_class_name, exception_file_name, exception_method_name, exception_line_number, "
                        + "process_status, create_time, update_time) "
                        + "VALUES ('synthetic-trace-id', 0, 0, 'basic-framework-test', 'GET', '/admin-api/probe', "
                        + "'{}', '127.0.0.1', 'synthetic-agent', ?, 'java.lang.IllegalStateException', "
                        + "'synthetic-message', 'synthetic-root-cause', 'synthetic-stack-trace', "
                        + "'com.example.Probe', 'Probe.java', 'probe', 1, 0, ?, ?)",
                createTime, createTime, createTime);
        return jdbc.queryForObject("SELECT MAX(id) FROM " + LOG_TABLE, Long.class);
    }

    /** 统计未被逻辑删除的记录行数，代表仍然可查询的数据。 */
    private int countActiveLogs() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + LOG_TABLE + " WHERE deleted = b'0'", Integer.class);
    }

    /** 统计已被逻辑删除的记录行数，确认清理未做物理删除。 */
    private int countDeletedLogs() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + LOG_TABLE + " WHERE deleted = b'1'", Integer.class);
    }

    /**
     * 读取指定记录的逻辑删除标记。
     *
     * @param id 日志编号
     * @return 已标记删除时返回 true
     */
    private boolean isDeleted(Long id) {
        Boolean deleted = jdbc.queryForObject("SELECT deleted FROM " + LOG_TABLE + " WHERE id = ?",
                Boolean.class, id);
        return Boolean.TRUE.equals(deleted);
    }

    /**
     * 把时间截断到秒，与生产 datetime 列的存储精度一致。
     *
     * @param time 原始时间
     * @return 截断到秒的时间，避免回读断言被数据库精度掩盖
     */
    private LocalDateTime seconds(LocalDateTime time) {
        return time.withNano(0);
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

    /** 使用真实 MyBatis 配置、分页插件与审计填充器，防止内存替身掩盖映射或分页错误。 */
    private SqlSessionFactory sqlSessionFactory(DataSource dataSource) {
        try {
            MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
            factory.setDataSource(dataSource);
            MybatisConfiguration configuration = new MybatisConfiguration();
            configuration.setMapUnderscoreToCamelCase(true);
            factory.setConfiguration(configuration);
            MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
            // 不显式指定库类型：分页插件按测试数据源的实际连接自动识别
            interceptor.addInnerInterceptor(new PaginationInnerInterceptor());
            factory.setPlugins(interceptor);
            GlobalConfig config = new GlobalConfig();
            config.setDbConfig(new GlobalConfig.DbConfig().setIdType(IdType.AUTO));
            // 逻辑删除会写入 update_time，缺省填充器会让 NOT NULL 列写入失败
            config.setMetaObjectHandler(new DefaultDBFieldHandler());
            factory.setGlobalConfig(config);
            return factory.getObject();
        } catch (Exception failure) {
            throw new IllegalStateException("错误日志测试 Mapper 初始化失败", failure);
        }
    }
}
