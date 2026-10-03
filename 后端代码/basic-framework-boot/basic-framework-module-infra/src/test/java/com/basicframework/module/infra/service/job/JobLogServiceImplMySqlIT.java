package com.basicframework.module.infra.service.job;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.module.infra.controller.admin.job.vo.log.JobLogPageReqVO;
import com.basicframework.module.infra.dal.dataobject.job.JobLogDO;
import com.basicframework.module.infra.dal.mysql.job.JobLogMapper;
import com.basicframework.module.infra.enums.job.JobLogStatusEnum;
import com.basicframework.module.infra.job.job.JobLogCleanJob;
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
import org.springframework.test.util.ReflectionTestUtils;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * 用独立 MySQL 库、生产 Mapper 和生产建表语句验证任务日志的状态流转与分批清理。
 *
 * <p>任务日志有两条真实风险：执行结果回写失败如果冒泡，会把“记录日志失败”变成“任务执行失败”，
 * 触发重试并重复执行业务；清理如果不分批，一次删除会长时间持有行锁并撑大事务日志。
 * 两条都由本测试用真实表和真实 SQL 覆盖。</p>
 *
 * <p>结果回写标注了 {@code @Async}，本测试上下文不开启异步代理，方法在调用线程同步执行，
 * 使断言不依赖线程时序；异步代理本身由 Spring 容器装配保证，不属于本模块契约。</p>
 *
 * <p>显式执行此集成入口必须提供环回测试环境，缺失环境直接失败，不连接业务库。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class JobLogServiceImplMySqlIT {

    /** 本测试使用的生产建表语句。 */
    private static final String LOG_TABLE = "infra_job_log";
    /** 清理任务固定保留天数，与生产定时任务配置一致。 */
    private static final int CLEAN_RETAIN_DAY = 14;
    /** 清理任务单批删除上限，与生产定时任务配置一致。 */
    private static final int CLEAN_DELETE_LIMIT = 100;

    private final String schema = "bf_joblog_" + UUID.randomUUID().toString().replace("-", "");
    private AnnotationConfigApplicationContext context;
    private JdbcTemplate jdbc;
    private JobLogMapper jobLogMapper;
    private JobLogService jobLogService;
    private JobLogCleanJob jobLogCleanJob;
    private String adminUrl;
    private String databaseUser;
    private String databasePassword;
    private boolean schemaCreated;
    private String logTableDdl;

    /** 建立随机数据库并只导入生产任务日志表；生产建表语句同时用于故障注入后的恢复。 */
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
        logTableDdl = matcher.group();
        jdbc.execute(logTableDdl);

        context = new AnnotationConfigApplicationContext();
        context.registerBean(DataSource.class, () -> dataSource);
        context.registerBean(SqlSessionFactory.class, () -> sqlSessionFactory(dataSource));
        context.registerBean(JobLogMapper.class, () -> {
            try {
                MapperFactoryBean<JobLogMapper> factory = new MapperFactoryBean<>(JobLogMapper.class);
                factory.setSqlSessionFactory(context.getBean(SqlSessionFactory.class));
                factory.afterPropertiesSet();
                return factory.getObject();
            } catch (Exception failure) {
                throw new IllegalStateException("任务日志测试 Mapper 创建失败", failure);
            }
        });
        context.registerBean(JobLogService.class, () -> {
            JobLogServiceImpl service = new JobLogServiceImpl();
            ReflectionTestUtils.setField(service, "jobLogMapper", context.getBean(JobLogMapper.class));
            return service;
        });
        context.registerBean(JobLogCleanJob.class, () -> {
            JobLogCleanJob job = new JobLogCleanJob();
            ReflectionTestUtils.setField(job, "jobLogService", context.getBean(JobLogService.class));
            return job;
        });
        context.refresh();
        jobLogMapper = context.getBean(JobLogMapper.class);
        jobLogService = context.getBean(JobLogService.class);
        jobLogCleanJob = context.getBean(JobLogCleanJob.class);
    }

    /** 每例清空任务日志表，避免跨用例计数互相影响。 */
    @BeforeEach
    void resetFixtures() {
        jdbc.update("DELETE FROM " + LOG_TABLE);
    }

    /** 新建日志必须是运行中状态且不含结束时间，否则无法区分“未开始”和“已结束”。 */
    @Test
    void newLogStartsInRunningState() {
        LocalDateTime begin = seconds(LocalDateTime.now().minusMinutes(1));
        Long id = jobLogService.createJobLog(7L, begin, "handler", "param", 2);

        JobLogDO log = jobLogService.getJobLog(id);
        assertThat(log.getStatus()).isEqualTo(JobLogStatusEnum.RUNNING.getStatus());
        assertThat(log.getJobId()).isEqualTo(7L);
        assertThat(log.getHandlerName()).isEqualTo("handler");
        assertThat(log.getHandlerParam()).isEqualTo("param");
        assertThat(log.getExecuteIndex()).as("重试执行必须能按次序号区分").isEqualTo(2);
        assertThat(log.getBeginTime()).isEqualTo(begin);
        assertThat(log.getEndTime()).isNull();
        assertThat(log.getDuration()).isNull();
    }

    /** 成功与失败必须落到不同的终态，并把结果和耗时一并写入。 */
    @Test
    void resultUpdateMovesLogToTerminalState() {
        Long successId = jobLogService.createJobLog(1L, LocalDateTime.now(), "h", null, 1);
        Long failureId = jobLogService.createJobLog(1L, LocalDateTime.now(), "h", null, 1);
        LocalDateTime end = seconds(LocalDateTime.now());

        jobLogService.updateJobLogResultAsync(successId, end, 120, true, "完成");
        jobLogService.updateJobLogResultAsync(failureId, end, 30, false, "根因：受控异常");

        JobLogDO success = jobLogService.getJobLog(successId);
        assertThat(success.getStatus()).isEqualTo(JobLogStatusEnum.SUCCESS.getStatus());
        assertThat(success.getEndTime()).isEqualTo(end);
        assertThat(success.getDuration()).isEqualTo(120);
        assertThat(success.getResult()).isEqualTo("完成");

        JobLogDO failure = jobLogService.getJobLog(failureId);
        assertThat(failure.getStatus()).isEqualTo(JobLogStatusEnum.FAILURE.getStatus());
        assertThat(failure.getDuration()).isEqualTo(30);
        assertThat(failure.getResult()).isEqualTo("根因：受控异常");
    }

    /**
     * 回写失败不得影响调度线程。
     *
     * <p>结果回写发生在任务已经执行完之后；此处抛出异常会让 Quartz 认为任务失败并按重试策略
     * 再次执行业务逻辑，所以调用方必须吞掉异常。</p>
     */
    @Test
    void resultUpdateFailureDoesNotEscapeToCaller() {
        Long id = jobLogService.createJobLog(1L, LocalDateTime.now(), "h", null, 1);
        jdbc.execute("DROP TABLE " + LOG_TABLE);
        try {
            assertThatCode(() -> jobLogService.updateJobLogResultAsync(
                    id, LocalDateTime.now(), 10, true, "结果"))
                    .as("日志回写失败只能记录，不能抛给调度线程").doesNotThrowAnyException();
        } finally {
            jdbc.execute(logTableDdl);
        }
    }

    /**
     * 清理必须分批推进到没有过期数据为止。
     *
     * <p>超过单批上限的过期日志必须全部删除且返回真实总数；只删一批会让旧日志持续堆积。</p>
     */
    @Test
    void cleanJobLogDeletesEveryExpiredRowInBatches() {
        for (int index = 0; index < 250; index++) {
            seedLog(1L, LocalDateTime.now().minusDays(30));
        }
        LocalDateTime recent = LocalDateTime.now().minusDays(1);
        seedLog(1L, recent);

        Integer deleted = jobLogService.cleanJobLog(CLEAN_RETAIN_DAY, CLEAN_DELETE_LIMIT);

        assertThat(deleted).isEqualTo(250);
        assertThat(countLogs()).as("保留期内的日志不得被清理").isEqualTo(1);
        assertThat(jobLogService.getJobLogPage(new JobLogPageReqVO()).getTotal()).isEqualTo(1);
    }

    /** 没有过期数据时返回 0，不应触发无意义的删除语句循环。 */
    @Test
    void cleanJobLogOnFreshDataDeletesNothing() {
        seedLog(1L, LocalDateTime.now());

        assertThat(jobLogService.cleanJobLog(CLEAN_RETAIN_DAY, CLEAN_DELETE_LIMIT)).isZero();
        assertThat(countLogs()).isEqualTo(1);
    }

    /**
     * 保留期边界按“早于截止时间”判定，刚好等于截止时间的日志必须保留。
     *
     * <p>直接以确定的秒级时间戳调用 Mapper 断言严格小于，避免与服务内部“当前时刻”竞争。</p>
     */
    @Test
    void deleteByCreateTimeLtKeepsRowsExactlyOnTheCutoff() {
        LocalDateTime earlier = seconds(LocalDateTime.now()).minusDays(1);
        LocalDateTime onCutoff = earlier.plusSeconds(1);
        seedLogWithCreateTime(1L, earlier);
        seedLogWithCreateTime(1L, onCutoff);

        Integer deleted = jobLogMapper.deleteByCreateTimeLt(onCutoff, CLEAN_DELETE_LIMIT);

        assertThat(deleted).as("等于截止时间的日志不得被删除").isEqualTo(1);
        assertThat(countLogs()).isEqualTo(1);
    }

    /** 保留期内的日志必须留存，保留期外的日志必须清除。 */
    @Test
    void cleanJobLogKeepsRowsInsideRetentionWindow() {
        seedLog(1L, seconds(LocalDateTime.now()).minusDays(CLEAN_RETAIN_DAY + 1));
        seedLog(1L, seconds(LocalDateTime.now()).minusDays(CLEAN_RETAIN_DAY - 1));

        Integer deleted = jobLogService.cleanJobLog(CLEAN_RETAIN_DAY, CLEAN_DELETE_LIMIT);

        assertThat(deleted).isEqualTo(1);
        assertThat(countLogs()).isEqualTo(1);
    }

    /**
     * 定时清理任务必须按固定的保留天数和批大小执行，并如实报告清理条数。
     *
     * <p>返回值会写进任务日志，是运维核对清理是否生效的唯一依据，不能是占位文本。</p>
     */
    @Test
    void cleanJobExecutesWithConfiguredRetentionAndReportsCount() {
        for (int index = 0; index < 150; index++) {
            seedLog(1L, LocalDateTime.now().minusDays(20));
        }
        seedLog(1L, LocalDateTime.now().minusDays(2));

        String result = jobLogCleanJob.execute(null);

        assertThat(result).isEqualTo("定时执行清理定时任务日志数量 150 个");
        assertThat(countLogs()).as("保留期内的日志必须保留").isEqualTo(1);
    }

    /**
     * 分页按任务编号、处理器名和状态过滤，并按编号倒序。
     *
     * <p>日志量增长最快，漏过滤会把全部历史日志一次性拉回管理端。</p>
     */
    @Test
    void logPageFiltersByJobHandlerAndStatus() {
        Long first = jobLogService.createJobLog(10L, LocalDateTime.now(), "handlerA", null, 1);
        Long second = jobLogService.createJobLog(11L, LocalDateTime.now(), "handlerB", null, 1);
        jobLogService.updateJobLogResultAsync(second, LocalDateTime.now(), 5, false, "失败");
        Long third = jobLogService.createJobLog(11L, LocalDateTime.now(), "handlerB", null, 1);

        JobLogPageReqVO jobQuery = new JobLogPageReqVO();
        jobQuery.setJobId(11L);
        PageResult<JobLogDO> byJob = jobLogService.getJobLogPage(jobQuery);
        assertThat(byJob.getTotal()).isEqualTo(2);
        assertThat(byJob.getList()).extracting(JobLogDO::getId)
                .isSortedAccordingTo(Comparator.reverseOrder());

        JobLogPageReqVO handlerQuery = new JobLogPageReqVO();
        handlerQuery.setHandlerName("handler");
        assertThat(jobLogService.getJobLogPage(handlerQuery).getTotal()).isEqualTo(3);

        JobLogPageReqVO statusQuery = new JobLogPageReqVO();
        statusQuery.setStatus(JobLogStatusEnum.FAILURE.getStatus());
        PageResult<JobLogDO> failures = jobLogService.getJobLogPage(statusQuery);
        assertThat(failures.getTotal()).isEqualTo(1);
        assertThat(failures.getList().get(0).getId()).isEqualTo(second);

        assertThat(jobLogService.getJobLog(first).getId()).isEqualTo(first);
        assertThat(jobLogService.getJobLog(third).getId()).isEqualTo(third);
        assertThat(jobLogService.getJobLog(999_999L)).isNull();
    }

    /** 关闭上下文并删除随机数据库；异常时也继续回收。 */
    @AfterAll
    void closeEnvironment() throws Exception {
        try {
            if (context != null) context.close();
        } finally {
            if (schemaCreated) {
                try (Connection connection = DriverManager.getConnection(adminUrl, databaseUser, databasePassword);
                     Statement statement = connection.createStatement()) {
                    statement.execute("DROP DATABASE `" + schema + "`");
                }
            }
        }
    }

    /** 写入一条指定开始时间的日志，再用数据库回填创建时间以模拟历史数据。 */
    private void seedLog(Long jobId, LocalDateTime beginTime) {
        Long id = jobLogService.createJobLog(jobId, beginTime, "handler", null, 1);
        jdbc.update("UPDATE " + LOG_TABLE + " SET create_time = ? WHERE id = ?", beginTime, id);
    }

    /** 写入一条创建时间完全由调用方指定的日志，用于边界断言。 */
    private void seedLogWithCreateTime(Long jobId, LocalDateTime createTime) {
        Long id = jobLogService.createJobLog(jobId, LocalDateTime.now(), "handler", null, 1);
        jdbc.update("UPDATE " + LOG_TABLE + " SET create_time = ? WHERE id = ?", createTime, id);
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

    /** 统计未逻辑删除的日志行数。 */
    private int countLogs() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + LOG_TABLE + " WHERE deleted = b'0'", Integer.class);
    }

    /** 缺失隔离环境时直接失败，避免退化成跳过真实数据库证据。 */
    private String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException("缺少隔离测试环境变量 " + name);
        return value;
    }

    /** 定位版本控制中的生产 DDL，不依赖测试进程从哪个模块启动。 */
    private Path repositoryRoot() {
        Path directory = Path.of("").toAbsolutePath();
        while (directory != null && !Files.isRegularFile(directory.resolve("数据库文件/basic_framework.sql"))) {
            directory = directory.getParent();
        }
        if (directory == null) throw new IllegalStateException("未找到框架空库基线");
        return directory;
    }

    /** 使用真实 MyBatis 配置、分页插件和审计填充器，防止内存替身掩盖映射错误。 */
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
            config.setMetaObjectHandler(new DefaultDBFieldHandler());
            factory.setGlobalConfig(config);
            return factory.getObject();
        } catch (Exception failure) {
            throw new IllegalStateException("任务日志测试 Mapper 初始化失败", failure);
        }
    }
}
