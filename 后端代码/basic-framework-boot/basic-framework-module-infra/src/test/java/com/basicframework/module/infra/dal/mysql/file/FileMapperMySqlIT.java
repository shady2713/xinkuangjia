package com.basicframework.module.infra.dal.mysql.file;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.infra.controller.admin.file.vo.file.FilePageReqVO;
import com.basicframework.module.infra.dal.dataobject.file.FileDO;
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
import java.util.Comparator;
import java.util.UUID;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 用独立 MySQL 库、生产 Mapper 和生产建表语句验证文件分页查询条件。
 *
 * <p>管理端文件列表按路径、类型和时间区间过滤，条件拼接必须“有值才生效”：
 * 条件漏拼会让列表把全部文件拉回，条件多拼（例如把 null 当成空串参与 LIKE）会让
 * 查询永远匹配不到数据。这两类错误在 Mock 上不可见，只有在真实表与真实 SQL 上才能验证。</p>
 *
 * <p>排序与分页同样属于契约：按编号倒序保证最新上传的文件出现在第一页；
 * 分页总数由分页插件真实统计，用于前端展示总条数。</p>
 *
 * <p>显式执行此集成入口必须提供环回测试环境，缺失环境直接失败，不连接业务库。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class FileMapperMySqlIT {

    /** 本测试使用的生产建表语句所在表名。 */
    private static final String FILE_TABLE = "infra_file";
    /** 用例内唯一路径前缀，避免与同库其他数据互相干扰。 */
    private static final String MARKER = "page-probe-" + UUID.randomUUID();
    /** 不匹配前缀的对照路径，用于确认模糊条件真实生效。 */
    private static final String OTHER_PATH = "unrelated-" + UUID.randomUUID() + "/note.txt";

    private final String schema = "bf_filepage_" + UUID.randomUUID().toString().replace("-", "");
    private AnnotationConfigApplicationContext context;
    private JdbcTemplate jdbc;
    private FileMapper fileMapper;
    private String adminUrl;
    private String databaseUser;
    private String databasePassword;
    private boolean schemaCreated;

    /** 建立随机数据库并只导入生产文件表。 */
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
        var matcher = Pattern.compile("CREATE TABLE `" + FILE_TABLE + "`[\\s\\S]*?;").matcher(ddl);
        assertThat(matcher.find()).as("生产表 %s 必须存在", FILE_TABLE).isTrue();
        jdbc.execute(matcher.group());

        context = new AnnotationConfigApplicationContext();
        context.registerBean(DataSource.class, () -> dataSource);
        context.registerBean(SqlSessionFactory.class, () -> sqlSessionFactory(dataSource));
        context.registerBean(FileMapper.class, () -> {
            try {
                MapperFactoryBean<FileMapper> factory = new MapperFactoryBean<>(FileMapper.class);
                factory.setSqlSessionFactory(context.getBean(SqlSessionFactory.class));
                factory.afterPropertiesSet();
                return factory.getObject();
            } catch (Exception failure) {
                throw new IllegalStateException("文件分页测试 Mapper 创建失败", failure);
            }
        });
        context.refresh();
        fileMapper = context.getBean(FileMapper.class);
    }

    /** 每例清空文件表并写入三条时间与类型各不相同的样例记录。 */
    @BeforeEach
    void resetFixtures() {
        jdbc.update("DELETE FROM " + FILE_TABLE);
        LocalDateTime base = LocalDateTime.of(2026, 10, 1, 12, 0, 0);
        seedFile(MARKER + "/first.txt", "text/plain", base);
        seedFile(MARKER + "/second.png", "image/png", base.plusDays(1));
        seedFile(MARKER + "/third.txt", "text/plain", base.plusDays(2));
        seedFile(OTHER_PATH, "text/plain", base.plusDays(1));
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

    /**
     * 只传路径时按模糊匹配过滤，并按编号倒序返回最新记录。
     *
     * <p>该用例同时覆盖类型与时间区间条件“未提供时不参与拼接”的分支：若实现把 null
     * 当作空串参与 LIKE，或把空区间拼成条件，结果条数会与预期不符。</p>
     */
    @Test
    void pathFilterAloneMatchesPrefixAndOrdersByIdDescending() {
        FilePageReqVO reqVO = new FilePageReqVO();
        reqVO.setPath(MARKER);

        PageResult<FileDO> result = fileMapper.selectPage(reqVO);

        assertThat(result.getTotal()).isEqualTo(3);
        assertThat(result.getList()).extracting(FileDO::getPath)
                .allSatisfy(path -> assertThat(path).startsWith(MARKER));
        assertThat(result.getList()).extracting(FileDO::getId)
                .as("最新上传的文件必须排在最前").isSortedAccordingTo(Comparator.reverseOrder());
    }

    /** 路径与类型同时提供时必须同时生效，类型条件不能覆盖路径条件。 */
    @Test
    void pathAndTypeFiltersApplyTogether() {
        FilePageReqVO reqVO = new FilePageReqVO();
        reqVO.setPath(MARKER);
        reqVO.setType("image/png");

        PageResult<FileDO> result = fileMapper.selectPage(reqVO);

        assertThat(result.getTotal()).isEqualTo(1);
        assertThat(result.getList()).extracting(FileDO::getPath).containsExactly(MARKER + "/second.png");
    }

    /** 创建时间区间必须闭区间生效，区间外记录不得返回。 */
    @Test
    void createTimeRangeFiltersRecordsOutsideWindow() {
        FilePageReqVO reqVO = new FilePageReqVO();
        reqVO.setPath(MARKER);
        reqVO.setCreateTime(new LocalDateTime[] {
                LocalDateTime.of(2026, 10, 2, 0, 0, 0), LocalDateTime.of(2026, 10, 2, 23, 59, 59)});

        PageResult<FileDO> result = fileMapper.selectPage(reqVO);

        assertThat(result.getTotal()).isEqualTo(1);
        assertThat(result.getList()).extracting(FileDO::getPath).containsExactly(MARKER + "/second.png");
    }

    /** 区间只给起始时间时按“不早于起始时间”过滤，结束时间缺失不得丢弃条件。 */
    @Test
    void createTimeRangeWithOnlyLowerBoundActsAsFromFilter() {
        FilePageReqVO reqVO = new FilePageReqVO();
        reqVO.setPath(MARKER);
        reqVO.setCreateTime(new LocalDateTime[] {LocalDateTime.of(2026, 10, 2, 0, 0, 0)});

        PageResult<FileDO> result = fileMapper.selectPage(reqVO);

        assertThat(result.getTotal()).isEqualTo(2);
        assertThat(result.getList()).extracting(FileDO::getPath)
                .containsExactlyInAnyOrder(MARKER + "/second.png", MARKER + "/third.txt");
    }

    /** 没有匹配记录时必须返回空列表与 0 总数，而不是 null。 */
    @Test
    void unmatchedFiltersReturnEmptyPage() {
        FilePageReqVO reqVO = new FilePageReqVO();
        reqVO.setPath(MARKER);
        reqVO.setType("application/not-exists");

        PageResult<FileDO> result = fileMapper.selectPage(reqVO);

        assertThat(result.getTotal()).isZero();
        assertThat(result.getList()).isEmpty();
    }

    /** 分页参数必须真实生效：每页条数限制返回记录数，总数仍为符合条件的全部条数。 */
    @Test
    void pageSizeLimitsRecordsWhileTotalCountsEveryMatch() {
        FilePageReqVO reqVO = new FilePageReqVO();
        reqVO.setPath(MARKER);
        reqVO.setPageSize(2);

        PageResult<FileDO> result = fileMapper.selectPage(reqVO);

        assertThat(result.getList()).hasSize(2);
        assertThat(result.getTotal()).as("总数必须是符合条件的全部记录数").isEqualTo(3);
    }

    /**
     * 写入一条指定路径、类型与创建时间的文件记录。
     *
     * @param path 文件路径
     * @param type 文件 MIME 类型
     * @param createTime 文件创建时间
     */
    private void seedFile(String path, String type, LocalDateTime createTime) {
        jdbc.update("INSERT INTO " + FILE_TABLE + " (name, path, url, type, size, creator, create_time, "
                        + "updater, update_time) VALUES (?, ?, ?, ?, 1, '1001', ?, '1001', ?)",
                path.substring(path.lastIndexOf('/') + 1), path, "https://files.example.test/" + path,
                type, createTime, createTime);
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

    /** 使用真实 MyBatis 配置与分页插件，防止内存替身掩盖映射或分页错误。 */
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
            factory.setGlobalConfig(config);
            return factory.getObject();
        } catch (Exception failure) {
            throw new IllegalStateException("文件分页测试 Mapper 初始化失败", failure);
        }
    }
}
