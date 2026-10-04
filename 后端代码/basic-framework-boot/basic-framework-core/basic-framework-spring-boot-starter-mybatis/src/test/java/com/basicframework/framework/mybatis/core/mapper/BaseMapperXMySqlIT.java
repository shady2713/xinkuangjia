package com.basicframework.framework.mybatis.core.mapper;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.exceptions.MybatisPlusException;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.basicframework.framework.common.pojo.PageParam;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.pojo.SortablePageParam;
import com.basicframework.framework.common.pojo.SortingField;
import com.basicframework.framework.common.util.spring.SpringUtils;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.framework.mybatis.core.query.MPJLambdaWrapperX;
import com.github.yulichang.injector.MPJSqlInjector;
import com.github.yulichang.interceptor.MPJInterceptor;
import lombok.Data;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.mybatis.spring.mapper.MapperFactoryBean;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 用独立 MySQL 库、真实 Mapper 代理与真实 SQL 验证 {@link BaseMapperX} 的全部默认方法契约。
 *
 * <p>{@code BaseMapperX} 是业务 Mapper 的统一入口，它的默认方法决定分页总数、条件拼接、
 * 批量写入与删除的数据边界。这些行为只能在真实方言与真实表上验证：</p>
 * <ul>
 *   <li>分页方法必须让数据库分页并返回符合条件的总数；{@link PageParam#PAGE_SIZE_NONE}
 *       必须退化为全量查询，不能返回被截断的首页。</li>
 *   <li>集合条件为空时不得拼出 {@code IN ()} 或退化成全表条件，只能返回空结果。</li>
 *   <li>批量写入依赖 MyBatis Plus 的 {@code Db} 静态助手，它需要容器装配出来的
 *       {@code SqlSessionFactory}；SQL Server 分支则按方言改为逐条插入。</li>
 * </ul>
 *
 * <p>SQL Server 分支无法在本机准备真实 SQL Server，因此只把"容器数据源元数据"替身为 SQL Server，
 * 写入仍落到真实 MySQL：被验证的是方言判断与逐条插入分支，而不是 SQL Server 的 SQL 兼容性。
 * 显式执行此集成入口必须提供环回隔离 MySQL，缺失环境直接失败，不连接业务库。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class BaseMapperXMySqlIT {

    /** 被查询的主表，仅由本测试创建，不使用任何业务表。 */
    private static final String USER_TABLE = "bf_probe_user";
    /** 被 Join 的部门表，用于验证连表查询与连表分页。 */
    private static final String DEPT_TABLE = "bf_probe_dept";
    /** 容器数据源元数据替身返回的产品名，用于驱动 SQL Server 方言分支。 */
    private static final String SQL_SERVER_PRODUCT = "Microsoft SQL Server";
    /** 容器数据源元数据替身返回的产品名，与真实 MySQL 连接一致。 */
    private static final String MYSQL_PRODUCT = "MySQL";

    private final String schema = "bf_basemapperx_" + UUID.randomUUID().toString().replace("-", "");
    private AnnotationConfigApplicationContext context;
    private JdbcTemplate jdbc;
    private ProbeUserMapper userMapper;
    private DataSource metadataSource;
    private Connection metadataConnection;
    private DatabaseMetaData metadataInfo;
    private String adminUrl;
    private String databaseUser;
    private String databasePassword;
    private boolean schemaCreated;
    private ApplicationContext previousContext;

    /** 建立随机数据库、两张探针表与真实 Mapper，缺失环境时直接失败。 */
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
        jdbc.execute("CREATE TABLE `" + USER_TABLE + "` ("
                + "id BIGINT NOT NULL AUTO_INCREMENT, name VARCHAR(64) NOT NULL, dept_id BIGINT NULL, "
                + "create_time DATETIME NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        jdbc.execute("CREATE TABLE `" + DEPT_TABLE + "` ("
                + "id BIGINT NOT NULL AUTO_INCREMENT, dept_name VARCHAR(64) NOT NULL, "
                + "PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

        previousContext = SpringUtils.getApplicationContext();
        metadataSource = mock(DataSource.class);
        metadataConnection = mock(Connection.class);
        metadataInfo = mock(DatabaseMetaData.class);
        when(metadataSource.getConnection()).thenReturn(metadataConnection);
        when(metadataConnection.getMetaData()).thenReturn(metadataInfo);
        context = new AnnotationConfigApplicationContext();
        // 容器数据源只服务于 JdbcUtils 的方言判断；Mapper 使用上面的真实 MySQL 数据源。
        context.registerBean(DataSource.class, () -> metadataSource);
        context.registerBean(SqlSessionFactory.class, () -> sqlSessionFactory(dataSource));
        registerMapper(ProbeUserMapper.class);
        registerMapper(ProbeDeptMapper.class);
        context.refresh();
        // JdbcUtils 通过 hutool 的静态上下文读取容器数据源，因此必须显式注入本测试的容器。
        new SpringUtils().setApplicationContext(context);
        userMapper = context.getBean(ProbeUserMapper.class);
    }

    /** 关闭容器、还原静态 Spring 上下文并删除随机数据库。 */
    @AfterAll
    void closeEnvironment() throws Exception {
        try {
            if (context != null) {
                context.close();
            }
            new SpringUtils().setApplicationContext(previousContext);
        } finally {
            if (schemaCreated) {
                try (Connection connection = DriverManager.getConnection(adminUrl, databaseUser, databasePassword);
                     Statement statement = connection.createStatement()) {
                    statement.execute("DROP DATABASE `" + schema + "`");
                }
            }
        }
    }

    /** 每例重建固定数据并把方言元数据恢复成 MySQL，避免用例之间互相影响。 */
    @BeforeEach
    void resetFixtures() {
        stubProductName(MYSQL_PRODUCT);
        jdbc.update("DELETE FROM " + USER_TABLE);
        jdbc.update("DELETE FROM " + DEPT_TABLE);
        jdbc.update("INSERT INTO " + DEPT_TABLE + " (id, dept_name) VALUES (10, '研发'), (20, '销售'), (30, '空部门')");
        insertUser("alpha", 10L, LocalDateTime.of(2026, 10, 3, 9, 0, 0));
        insertUser("bravo", 10L, LocalDateTime.of(2026, 10, 3, 10, 0, 0));
        insertUser("charlie", 20L, LocalDateTime.of(2026, 10, 3, 11, 0, 0));
        insertUser("orphan", null, LocalDateTime.of(2026, 10, 3, 12, 0, 0));
    }

    /** 可排序分页必须按排序字段生成 ORDER BY，并返回符合条件的真实总数。 */
    @Test
    void selectPageWithSortableParamAppliesSortingAndCountsEveryMatch() {
        SortablePageParam pageParam = new SortablePageParam();
        pageParam.setPageSize(2);
        pageParam.setSortingFields(List.of(new SortingField("name", SortingField.ORDER_DESC)));

        PageResult<ProbeUserDO> result = userMapper.selectPage(pageParam,
                new LambdaQueryWrapperX<ProbeUserDO>().in(ProbeUserDO::getDeptId, List.of(10L)));

        assertThat(result.getTotal()).as("总数必须是符合条件的全部记录数").isEqualTo(2);
        assertThat(result.getList()).extracting(ProbeUserDO::getName).containsExactly("bravo", "alpha");
    }

    /** 不带排序的分页入口必须仍按页码取页，不得把排序字段当成缺失条件过滤。 */
    @Test
    void selectPageWithoutSortingReturnsRequestedPage() {
        PageParam pageParam = new PageParam();
        pageParam.setPageNo(2);
        pageParam.setPageSize(2);

        PageResult<ProbeUserDO> result = userMapper.selectPage(pageParam,
                new LambdaQueryWrapperX<ProbeUserDO>().isNotNull(ProbeUserDO::getDeptId));

        assertThat(result.getTotal()).isEqualTo(3);
        assertThat(result.getList()).hasSize(1);
    }

    /** 每页条数为 -1 时必须全量返回并附带排序，且总数等于返回条数而不是被截断的页大小。 */
    @Test
    void selectPageWithNoneSizeReturnsEveryMatchInSortedOrder() {
        SortablePageParam pageParam = new SortablePageParam();
        pageParam.setPageSize(PageParam.PAGE_SIZE_NONE);
        pageParam.setSortingFields(List.of(new SortingField("name", SortingField.ORDER_ASC)));

        PageResult<ProbeUserDO> result = userMapper.selectPage(pageParam,
                new LambdaQueryWrapperX<ProbeUserDO>().in(ProbeUserDO::getDeptId, List.of(10L, 20L)));

        assertThat(result.getList()).extracting(ProbeUserDO::getName)
                .containsExactly("alpha", "bravo", "charlie");
        assertThat(result.getTotal()).as("不分页时总数必须是实际返回条数").isEqualTo(3);
    }

    /** 不分页入口（无排序字段）同样必须返回全部匹配记录。 */
    @Test
    void selectPageWithoutSortingAndNoneSizeReturnsEveryMatch() {
        PageParam pageParam = new PageParam();
        pageParam.setPageSize(PageParam.PAGE_SIZE_NONE);

        PageResult<ProbeUserDO> result = userMapper.selectPage(pageParam, new LambdaQueryWrapperX<>());

        assertThat(result.getTotal()).isEqualTo(4);
        assertThat(result.getList()).hasSize(4);
    }

    /** 连表分页必须返回连接后的行与总数，未匹配部门的主表记录不得被内连接丢弃。 */
    @Test
    void selectJoinPageReturnsJoinedRowsAndTotal() {
        PageParam pageParam = new PageParam();
        pageParam.setPageSize(10);

        PageResult<ProbeUserDO> result = userMapper.selectJoinPage(pageParam, ProbeUserDO.class,
                joinWrapper().selectAll(ProbeUserDO.class).selectAs(ProbeDeptDO::getDeptName, ProbeUserDO::getDeptName));

        assertThat(result.getTotal()).isEqualTo(4);
        assertThat(result.getList()).extracting(ProbeUserDO::getName)
                .containsExactlyInAnyOrder("alpha", "bravo", "charlie", "orphan");
        assertThat(result.getList()).filteredOn(user -> "alpha".equals(user.getName()))
                .singleElement().extracting(ProbeUserDO::getDeptName).isEqualTo("研发");
    }

    /** 可排序的连表分页必须把排序字段带进真实 SQL，并按该顺序返回当前页。 */
    @Test
    void selectJoinPageWithSortableParamOrdersJoinedRows() {
        SortablePageParam pageParam = new SortablePageParam();
        pageParam.setPageSize(3);
        pageParam.setPageNo(2);
        pageParam.setSortingFields(List.of(new SortingField("name", SortingField.ORDER_ASC)));

        PageResult<ProbeUserDO> result = userMapper.selectJoinPage(pageParam, ProbeUserDO.class,
                joinWrapper().selectAll(ProbeUserDO.class));

        assertThat(result.getTotal()).isEqualTo(4);
        assertThat(result.getList()).extracting(ProbeUserDO::getName).containsExactly("orphan");
    }

    /**
     * 连表不分页入口必须返回全部连接结果；当前实现不把排序字段带进该分支。
     *
     * <p>这是与 {@code selectPage(PageParam, sortingFields, wrapper)} 的真实差异：后者在不分页时
     * 仍调用 {@code MyBatisUtils.addOrder} 排序，而连表不分页分支直接 {@code selectJoinList}，
     * 请求里的排序字段被静默丢弃（导出场景会拿到未排序结果）。用例锁定当前可观察行为并直接
     * 断言包装器 SQL 中没有 ORDER BY，避免用"碰巧的顺序"代替证据；该差异已作为独立发现上报，
     * 未修改生产源码。</p>
     */
    @Test
    void selectJoinPageWithNoneSizeReturnsEveryJoinedRowWithoutApplyingSorting() {
        SortablePageParam pageParam = new SortablePageParam();
        pageParam.setPageSize(PageParam.PAGE_SIZE_NONE);
        pageParam.setSortingFields(List.of(new SortingField("name", SortingField.ORDER_DESC)));
        MPJLambdaWrapperX<ProbeUserDO> wrapper = joinWrapper().selectAll(ProbeUserDO.class);

        PageResult<ProbeUserDO> result = userMapper.selectJoinPage(pageParam, ProbeUserDO.class, wrapper);

        assertThat(result.getTotal()).isEqualTo(4);
        assertThat(result.getList()).extracting(ProbeUserDO::getName)
                .containsExactlyInAnyOrder("alpha", "bravo", "charlie", "orphan");
        assertThat(wrapper.getTargetSql()).as("不分页的连表分支不得声称已排序").doesNotContain("ORDER BY");
    }

    /** 以普通分页参数传入且每页条数为 -1 时，连表查询必须返回全部连接结果。 */
    @Test
    void selectJoinPageWithNoneSizeOnPageParamReturnsEveryJoinedRow() {
        PageParam pageParam = new PageParam();
        pageParam.setPageSize(PageParam.PAGE_SIZE_NONE);

        PageResult<ProbeUserDO> result = userMapper.selectJoinPage(pageParam, ProbeUserDO.class,
                joinWrapper().selectAll(ProbeUserDO.class));

        assertThat(result.getTotal()).as("不分页时总数必须是实际返回条数").isEqualTo(4);
        assertThat(result.getList()).extracting(ProbeUserDO::getName)
                .containsExactlyInAnyOrder("alpha", "bravo", "charlie", "orphan");
    }

    /** 以连接条件接口传入的连表分页必须与具体 Wrapper 类型同样可用。 */
    @Test
    void selectJoinPageWithBaseJoinInterfaceReturnsPage() {
        PageParam pageParam = new PageParam();
        pageParam.setPageSize(2);

        PageResult<ProbeUserDO> result = userMapper.selectJoinPage(pageParam, ProbeUserDO.class,
                (com.github.yulichang.interfaces.MPJBaseJoin<ProbeUserDO>) joinWrapper().selectAll(ProbeUserDO.class));

        assertThat(result.getTotal()).isEqualTo(4);
        assertThat(result.getList()).hasSize(2);
    }

    /** 按列名查询单条必须命中指定值，且不匹配时返回 null。 */
    @Test
    void selectOneByColumnNameMatchesExactValue() {
        assertThat(userMapper.selectOne("name", "alpha")).extracting(ProbeUserDO::getDeptId).isEqualTo(10L);
        assertThat(userMapper.selectOne("name", "missing")).isNull();
    }

    /** 按 Lambda 字段查询单条必须使用真实列名而非属性名。 */
    @Test
    void selectOneByLambdaMatchesExactValue() {
        assertThat(userMapper.selectOne(ProbeUserDO::getName, "charlie"))
                .extracting(ProbeUserDO::getDeptId).isEqualTo(20L);
        assertThat(userMapper.selectOne(ProbeUserDO::getName, "missing")).isNull();
    }

    /** 双列名条件必须同时生效，任一列不匹配时不得返回记录。 */
    @Test
    void selectOneByTwoColumnNamesRequiresBothConditions() {
        assertThat(userMapper.selectOne("name", "alpha", "dept_id", 10L)).isNotNull();
        assertThat(userMapper.selectOne("name", "alpha", "dept_id", 20L)).isNull();
    }

    /** 双 Lambda 条件必须同时生效。 */
    @Test
    void selectOneByTwoLambdaColumnsRequiresBothConditions() {
        assertThat(userMapper.selectOne(ProbeUserDO::getName, "bravo", ProbeUserDO::getDeptId, 10L)).isNotNull();
        assertThat(userMapper.selectOne(ProbeUserDO::getName, "bravo", ProbeUserDO::getDeptId, 20L)).isNull();
    }

    /** 三 Lambda 条件必须同时生效，缺失任一条件都会命中其它记录。 */
    @Test
    void selectOneByThreeLambdaColumnsRequiresEveryCondition() {
        Long alphaId = userMapper.selectOne(ProbeUserDO::getName, "alpha").getId();
        Long bravoId = userMapper.selectOne(ProbeUserDO::getName, "bravo").getId();

        assertThat(userMapper.selectOne(ProbeUserDO::getName, "alpha", ProbeUserDO::getDeptId, 10L,
                ProbeUserDO::getId, alphaId)).isNotNull();
        assertThat(userMapper.selectOne(ProbeUserDO::getName, "alpha", ProbeUserDO::getDeptId, 10L,
                ProbeUserDO::getId, bravoId)).isNull();
    }

    /** 多条匹配时取首条必须返回其中一条而不是抛错，这是并发重复数据的既定口径。 */
    @Test
    void selectFirstOneReturnsOneOfDuplicatedMatches() {
        insertUser("alpha", 20L, LocalDateTime.of(2026, 10, 3, 13, 0, 0));

        ProbeUserDO first = userMapper.selectFirstOne(ProbeUserDO::getName, "alpha");

        assertThat(first).isNotNull();
        assertThat(first.getName()).isEqualTo("alpha");
    }

    /** 无匹配记录时取首条必须返回 null，而不是抛异常或返回空对象。 */
    @Test
    void selectFirstOneReturnsNullWhenNothingMatches() {
        assertThat(userMapper.selectFirstOne(ProbeUserDO::getName, "missing")).isNull();
    }

    /** 双条件与三条件的取首条入口必须按全部条件过滤。 */
    @Test
    void selectFirstOneWithMultipleConditionsFiltersEveryColumn() {
        Long bravoId = userMapper.selectFirstOne(ProbeUserDO::getName, "bravo").getId();
        Long charlieId = userMapper.selectFirstOne(ProbeUserDO::getName, "charlie").getId();

        assertThat(userMapper.selectFirstOne(ProbeUserDO::getName, "bravo", ProbeUserDO::getDeptId, 10L)).isNotNull();
        assertThat(userMapper.selectFirstOne(ProbeUserDO::getName, "bravo", ProbeUserDO::getDeptId, 20L)).isNull();
        assertThat(userMapper.selectFirstOne(ProbeUserDO::getName, "bravo", ProbeUserDO::getDeptId, 10L,
                ProbeUserDO::getId, bravoId)).isNotNull();
        assertThat(userMapper.selectFirstOne(ProbeUserDO::getName, "bravo", ProbeUserDO::getDeptId, 10L,
                ProbeUserDO::getId, charlieId)).isNull();
    }

    /** 计数入口必须区分无条件、列名条件与 Lambda 条件三种统计口径。 */
    @Test
    void selectCountSupportsAllConditionForms() {
        assertThat(userMapper.selectCount()).isEqualTo(4L);
        assertThat(userMapper.selectCount("dept_id", 10L)).isEqualTo(2L);
        assertThat(userMapper.selectCount(ProbeUserDO::getDeptId, 20L)).isEqualTo(1L);
        assertThat(userMapper.selectCount(ProbeUserDO::getDeptId, null)).as("无匹配条件时计数为 0").isZero();
    }

    /** 列表入口必须区分无条件、列名条件与 Lambda 条件三种查询口径。 */
    @Test
    void selectListSupportsConditionFormsAndEmptyCollectionShortCircuit() {
        assertThat(userMapper.selectList()).hasSize(4);
        assertThat(userMapper.selectList("name", "alpha")).extracting(ProbeUserDO::getName).containsExactly("alpha");
        assertThat(userMapper.selectList(ProbeUserDO::getName, "bravo"))
                .extracting(ProbeUserDO::getName).containsExactly("bravo");
        assertThat(userMapper.selectList("name", List.of())).as("空集合必须直接返回空列表").isEmpty();
        assertThat(userMapper.selectList(ProbeUserDO::getName, List.of()))
                .as("Lambda 空集合同样必须直接返回空列表").isEmpty();
        assertThat(userMapper.selectList("name", List.of("alpha", "charlie")))
                .extracting(ProbeUserDO::getName).containsExactlyInAnyOrder("alpha", "charlie");
        assertThat(userMapper.selectList(ProbeUserDO::getDeptId, List.of(10L, 20L))).hasSize(3);
        assertThat(userMapper.selectList(ProbeUserDO::getDeptId, 10L, ProbeUserDO::getName, "alpha"))
                .extracting(ProbeUserDO::getName).containsExactly("alpha");
        assertThat(userMapper.selectList(ProbeUserDO::getDeptId, 20L, ProbeUserDO::getName, "alpha")).isEmpty();
    }

    /** 批量插入必须一次写完全部实体，并回填自增主键供后续关联使用。 */
    @Test
    void insertBatchPersistsEveryEntityAndFillsGeneratedIds() {
        List<ProbeUserDO> entities = new ArrayList<>();
        entities.add(newProbeUser("delta", 20L));
        entities.add(newProbeUser("echo", 30L));
        entities.add(newProbeUser("foxtrot", null));

        Boolean result = userMapper.insertBatch(entities);

        assertThat(result).isTrue();
        assertThat(entities).allSatisfy(entity -> assertThat(entity.getId()).as("批量插入必须回填主键").isNotNull());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + USER_TABLE + " WHERE name IN "
                + "('delta','echo','foxtrot')", Integer.class)).isEqualTo(3);
        assertThat(jdbc.queryForObject("SELECT dept_id FROM " + USER_TABLE + " WHERE name = 'delta'", Long.class))
                .isEqualTo(20L);
    }

    /** 指定分片大小的批量插入必须与默认分片写入同样的数据。 */
    @Test
    void insertBatchWithChunkSizePersistsEveryEntity() {
        List<ProbeUserDO> entities = new ArrayList<>();
        for (int index = 0; index < 5; index++) {
            entities.add(newProbeUser("chunk-" + index, 10L));
        }

        Boolean result = userMapper.insertBatch(entities, 2);

        assertThat(result).isTrue();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + USER_TABLE + " WHERE name LIKE 'chunk-%'",
                Integer.class)).isEqualTo(5);
    }

    /** 空集合批量插入必须返回 false 且不产生任何写入。 */
    @Test
    void insertBatchWithEmptyCollectionWritesNothing() {
        assertThat(userMapper.insertBatch(List.of())).isFalse();
        assertThat(userMapper.insertBatch(List.of(), 10)).isFalse();
        assertThat(userMapper.selectCount()).isEqualTo(4L);
    }

    /**
     * 容器数据源元数据为 SQL Server 时必须改为逐条插入，以规避批量插入后取不到自增主键的问题。
     *
     * <p>负对照：同一份实体在 MySQL 方言下走 {@code Db.saveBatch} 分支；本用例只改变方言判定，
     * 断言两种方言写入的行数与主键回填结果一致，证明分支切换不改变业务结果。</p>
     */
    @Test
    void insertBatchOnSqlServerDialectFallsBackToSingleInserts() {
        stubProductName(SQL_SERVER_PRODUCT);
        List<ProbeUserDO> entities = List.of(newProbeUser("golf", 10L), newProbeUser("hotel", 20L));

        assertThat(userMapper.insertBatch(entities)).isTrue();
        assertThat(entities).allSatisfy(entity -> assertThat(entity.getId()).isNotNull());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + USER_TABLE + " WHERE name IN ('golf','hotel')",
                Integer.class)).isEqualTo(2);

        assertThat(userMapper.insertBatch(List.of(), 10)).as("空集合在 SQL Server 方言下同样返回 false").isFalse();
        assertThat(userMapper.insertBatch(List.of(newProbeUser("india", 30L)), 5)).isTrue();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + USER_TABLE + " WHERE name = 'india'",
                Integer.class)).isEqualTo(1);
    }

    /**
     * 实体式批量更新必须更新全部命中行。
     *
     * <p>该入口用无条件 Wrapper 更新整表，属于框架提供的"批量改字段"能力；断言真实受影响行数
     * 与逐行落库结果，避免把空条件当成不更新。</p>
     */
    @Test
    void updateBatchByEntityUpdatesEveryRow() {
        ProbeUserDO update = new ProbeUserDO();
        update.setDeptId(30L);

        int updated = userMapper.updateBatch(update);

        assertThat(updated).isEqualTo(4);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + USER_TABLE + " WHERE dept_id = 30",
                Integer.class)).isEqualTo(4);
    }

    /** 按主键批量更新必须只改指定记录，其它记录保持原值。 */
    @Test
    void updateBatchByEntitiesUpdatesOnlyGivenIds() {
        List<ProbeUserDO> all = userMapper.selectList();
        ProbeUserDO first = all.get(0);
        ProbeUserDO second = all.get(1);
        first.setName("renamed-first");
        second.setName("renamed-second");

        Boolean result = userMapper.updateBatch(List.of(first, second));

        assertThat(result).isTrue();
        assertThat(userMapper.selectList("name", "renamed-first")).hasSize(1);
        assertThat(userMapper.selectList("name", "renamed-second")).hasSize(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + USER_TABLE + " WHERE name IN ('alpha','bravo')",
                Integer.class)).as("未传入的记录不得被更新").isZero();
    }

    /** 指定分片大小的按主键批量更新必须与默认分片结果一致。 */
    @Test
    void updateBatchByEntitiesWithChunkSizeUpdatesGivenIds() {
        List<ProbeUserDO> all = userMapper.selectList();
        all.forEach(user -> user.setName("chunk-" + user.getId()));

        Boolean result = userMapper.updateBatch(all, 2);

        assertThat(result).isTrue();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + USER_TABLE + " WHERE name LIKE 'chunk-%'",
                Integer.class)).isEqualTo(4);
    }

    /**
     * 空集合批量更新无法推断实体类型，必须显式失败而不是静默返回成功。
     *
     * <p>{@code updateBatch} 走 MyBatis Plus 的按主键批量更新，实体类型取自集合首个元素；
     * 空集合下"更新成功"没有可核对的语义，因此真实契约是抛出 {@code MybatisPlusException}。
     * 用例同时确认失败后没有任何行被改动，避免把异常当成已更新。</p>
     */
    @Test
    void updateBatchWithEmptyCollectionFailsWithoutChangingRows() {
        assertThatThrownBy(() -> userMapper.updateBatch(List.of()))
                .isInstanceOf(MybatisPlusException.class)
                .hasMessageContaining("can not get entityClass from entityList");
        assertThatThrownBy(() -> userMapper.updateBatch(new ArrayList<ProbeUserDO>(), 3))
                .isInstanceOf(MybatisPlusException.class)
                .hasMessageContaining("can not get entityClass from entityList");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + USER_TABLE + " WHERE name LIKE 'chunk-%'",
                Integer.class)).isZero();
    }

    /** 按列名删除必须只删除命中的行，并返回真实受影响行数。 */
    @Test
    void deleteByColumnNameRemovesMatchingRows() {
        int deleted = userMapper.delete("name", "orphan");

        assertThat(deleted).isEqualTo(1);
        assertThat(userMapper.selectCount()).isEqualTo(3L);
    }

    /** 按 Lambda 条件删除必须只删除命中的行。 */
    @Test
    void deleteByLambdaRemovesMatchingRows() {
        int deleted = userMapper.delete(ProbeUserDO::getDeptId, 10L);

        assertThat(deleted).isEqualTo(2);
        assertThat(userMapper.selectList()).extracting(ProbeUserDO::getName)
                .containsExactlyInAnyOrder("charlie", "orphan");
    }

    /** 空集合批量删除必须返回 0，不得生成全表删除条件。 */
    @Test
    void deleteBatchWithEmptyCollectionRemovesNothing() {
        int deleted = userMapper.deleteBatch(ProbeUserDO::getName, List.of());

        assertThat(deleted).isZero();
        assertThat(userMapper.selectCount()).isEqualTo(4L);
    }

    /** 批量删除必须只删除集合内的记录。 */
    @Test
    void deleteBatchRemovesOnlyListedValues() {
        int deleted = userMapper.deleteBatch(ProbeUserDO::getName, List.of("alpha", "charlie"));

        assertThat(deleted).isEqualTo(2);
        assertThat(userMapper.selectList()).extracting(ProbeUserDO::getName)
                .containsExactlyInAnyOrder("bravo", "orphan");
    }

    /**
     * 构造连表 Wrapper：以用户为主表左连接部门，并返回框架扩展类型以验证链式能力。
     *
     * @return 用户左连接部门且已带上别名前缀的查询包装器
     */
    private MPJLambdaWrapperX<ProbeUserDO> joinWrapper() {
        return new MPJLambdaWrapperX<ProbeUserDO>()
                .selectAs(ProbeUserDO::getId, ProbeUserDO::getId)
                .selectAs(ProbeUserDO::getName, ProbeUserDO::getName)
                .selectAs(ProbeUserDO::getDeptId, ProbeUserDO::getDeptId)
                .leftJoin(ProbeDeptDO.class, ProbeDeptDO::getId, ProbeUserDO::getDeptId);
    }

    /** 构造未落库用户的实体，主键由数据库自增生成。 */
    private ProbeUserDO newProbeUser(String name, Long deptId) {
        ProbeUserDO user = new ProbeUserDO();
        user.setName(name);
        user.setDeptId(deptId);
        user.setCreateTime(LocalDateTime.of(2026, 10, 3, 8, 0, 0));
        return user;
    }

    /** 直接插入固定用户数据，避免用例通过被测写入路径准备自己的夹具。 */
    private void insertUser(String name, Long deptId, LocalDateTime createTime) {
        jdbc.update("INSERT INTO " + USER_TABLE + " (name, dept_id, create_time) VALUES (?, ?, ?)",
                name, deptId, createTime);
    }

    /**
     * 注册真实 Mapper 动态代理，让实体元数据与 SQL 全部走真实 MyBatis。
     *
     * @param type Mapper 接口类型
     * @param <T> Mapper 类型
     */
    private <T> void registerMapper(Class<T> type) {
        context.registerBean(type, () -> {
            try {
                MapperFactoryBean<T> factory = new MapperFactoryBean<>(type);
                factory.setSqlSessionFactory(context.getBean(SqlSessionFactory.class));
                factory.afterPropertiesSet();
                return factory.getObject();
            } catch (Exception failure) {
                throw new IllegalStateException("BaseMapperX 测试 Mapper 创建失败", failure);
            }
        });
    }

    /**
     * 切换数据源替身返回的数据库产品名，模拟容器连接到的不同数据库。
     *
     * @param productName JDBC 元数据数据库产品名，取值必须能被方言枚举识别
     */
    private void stubProductName(String productName) {
        try {
            when(metadataInfo.getDatabaseProductName()).thenReturn(productName);
        } catch (Exception failure) {
            throw new IllegalStateException("方言元数据替身配置失败", failure);
        }
    }

    /**
     * 用真实 MyBatis 配置、MyBatis Plus Join 注入器与分页插件建立 SqlSessionFactory。
     *
     * @param dataSource 真实 MySQL 数据源
     * @return 可直接访问数据库的会话工厂
     */
    private SqlSessionFactory sqlSessionFactory(DataSource dataSource) {
        try {
            MybatisConfiguration configuration = new MybatisConfiguration();
            configuration.setMapUnderscoreToCamelCase(true);
            GlobalConfig global = new GlobalConfig();
            global.setDbConfig(new GlobalConfig.DbConfig().setIdType(IdType.AUTO));
            // Join 能力来自 MPJ 的注入器；Db 静态助手依赖工厂构建时写入的会话工厂。
            global.setSqlInjector(new MPJSqlInjector());
            MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
            interceptor.addInnerInterceptor(new PaginationInnerInterceptor());
            MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
            factory.setDataSource(dataSource);
            factory.setConfiguration(configuration);
            factory.setGlobalConfig(global);
            factory.setPlugins(interceptor, new MPJInterceptor());
            return factory.getObject();
        } catch (Exception failure) {
            throw new IllegalStateException("BaseMapperX 测试会话工厂初始化失败", failure);
        }
    }

    /** 缺失隔离环境时直接失败，避免退化成跳过真实数据库证据。 */
    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("缺少隔离测试环境变量 " + name);
        }
        return value;
    }

    /**
     * 用户探针实体，只用于验证 {@link BaseMapperX} 的通用能力，不代表任何业务对象。
     *
     * @author shady2713
     */
    @Data
    @TableName(BaseMapperXMySqlIT.USER_TABLE)
    static class ProbeUserDO {

        /** 主键，由数据库自增生成。 */
        @TableId(type = IdType.AUTO)
        private Long id;

        /** 用户名，用于唯一命中单条记录。 */
        private String name;

        /** 所属部门编号，可为空以覆盖未匹配连表分支。 */
        private Long deptId;

        /** 创建时间，用于验证排序字段不改变业务语义。 */
        private LocalDateTime createTime;

        /** 连表查询时接收部门名称的展示字段，不落库。 */
        @TableField(exist = false)
        private String deptName;

    }

    /**
     * 部门探针实体，作为连表查询的从表。
     *
     * @author shady2713
     */
    @Data
    @TableName(BaseMapperXMySqlIT.DEPT_TABLE)
    static class ProbeDeptDO {

        /** 主键，与用户表的部门编号关联。 */
        @TableId(type = IdType.AUTO)
        private Long id;

        /** 部门名称，用于验证连表列映射与别名。 */
        private String deptName;

    }

    /**
     * 用户探针 Mapper，直接继承 {@link BaseMapperX} 以获得全部待验证的默认方法。
     *
     * @author shady2713
     */
    interface ProbeUserMapper extends BaseMapperX<ProbeUserDO> {
    }

    /**
     * 部门探针 Mapper；连表查询要求从表存在真实 Mapper 与实体元数据，否则 Join 无法解析表名。
     *
     * @author shady2713
     */
    interface ProbeDeptMapper extends BaseMapperX<ProbeDeptDO> {
    }

}
