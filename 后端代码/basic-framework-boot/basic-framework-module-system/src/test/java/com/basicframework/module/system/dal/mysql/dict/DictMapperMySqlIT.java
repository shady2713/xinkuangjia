package com.basicframework.module.system.dal.mysql.dict;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.module.system.controller.admin.dict.vo.data.DictDataPageReqVO;
import com.basicframework.module.system.controller.admin.dict.vo.type.DictTypePageReqVO;
import com.basicframework.module.system.dal.dataobject.dict.DictDataDO;
import com.basicframework.module.system.dal.dataobject.dict.DictTypeDO;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.mybatis.spring.mapper.MapperFactoryBean;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 用独立 MySQL 库与生产 Mapper 验证字典类型与字典数据的键值查询、条件分页和软删除语义。
 *
 * <p>这些方法承载字典模块的关键约束：字典类型编码与名称必须能按唯一键定位（重复即数据错误），
 * 字典数据的标签/值查询决定导入导出与校验能否找到正确条目；分页条件写错会让停用数据出现在启用筛选里、
 * 或让排序结果不稳定；软删除必须同时写入删除标记与删除时间，否则回收站与唯一键释放都会失效。
 * 类型编码的复用同样由数据库约束决定：唯一索引只覆盖存活行，被删记录保留原编码，同一编码可以反复
 * 创建与删除，并发创建时仍然只能有一条存活记录。因此这里使用真实 SQL 与真实约束观察结果，
 * 不用内存替身代替映射。</p>
 *
 * <p>显式执行此集成入口必须提供环回测试环境，缺失环境直接失败，不连接业务库。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class DictMapperMySqlIT {

    /** 本测试使用的生产表：字典类型表。 */
    private static final String TYPE_TABLE = "system_dict_type";
    /** 本测试使用的生产表：字典数据表。 */
    private static final String DATA_TABLE = "system_dict_data";

    /** 本测试独占的随机库名，结束时整体删除。 */
    private final String schema = "bf_dict_mapper_" + UUID.randomUUID().toString().replace("-", "");

    /** 测试装配的上下文，持有真实数据源与两个生产 Mapper。 */
    private AnnotationConfigApplicationContext context;
    /** 直连测试库的 JDBC 模板，用于在 Mapper 之外观察持久状态。 */
    private JdbcTemplate jdbc;
    /** 被测字典类型 Mapper。 */
    private DictTypeMapper dictTypeMapper;
    /** 被测字典数据 Mapper。 */
    private DictDataMapper dictDataMapper;
    /** 管理连接使用的库级 URL，用于建库与删库。 */
    private String adminUrl;
    /** 隔离测试账号。 */
    private String databaseUser;
    /** 隔离测试口令。 */
    private String databasePassword;
    /** 是否已真实建库，决定结束时是否需要回收。 */
    private boolean schemaCreated;

    /** 建立随机数据库并只导入两张生产表；不导入种子数据。 */
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
        for (String table : List.of(TYPE_TABLE, DATA_TABLE)) {
            var matcher = Pattern.compile("CREATE TABLE `" + table + "`[\\s\\S]*?;").matcher(ddl);
            assertThat(matcher.find()).as("生产表 %s 必须存在", table).isTrue();
            jdbc.execute(matcher.group());
        }

        context = new AnnotationConfigApplicationContext();
        context.registerBean(DataSource.class, () -> dataSource);
        context.registerBean(SqlSessionFactory.class, () -> sqlSessionFactory(dataSource));
        registerMapper(DictTypeMapper.class);
        registerMapper(DictDataMapper.class);
        context.refresh();
        dictTypeMapper = context.getBean(DictTypeMapper.class);
        dictDataMapper = context.getBean(DictDataMapper.class);
    }

    /** 每例清空两张表，避免跨用例的唯一键冲突污染查询结果。 */
    @BeforeEach
    void resetFixtures() {
        jdbc.update("DELETE FROM " + DATA_TABLE);
        jdbc.update("DELETE FROM " + TYPE_TABLE);
    }

    /** 类型编码与名称查询必须按精确匹配返回唯一记录，未命中返回 null。 */
    @Test
    void selectByTypeAndNameMatchExactly() {
        dictTypeMapper.insert(dictType(1L, "sys_sex", "性别", CommonStatusEnum.ENABLE.getStatus()));
        dictTypeMapper.insert(dictType(2L, "sys_status", "状态", CommonStatusEnum.ENABLE.getStatus()));

        assertThat(dictTypeMapper.selectByType("sys_sex").getName()).isEqualTo("性别");
        assertThat(dictTypeMapper.selectByName("状态").getType()).isEqualTo("sys_status");
        assertThat(dictTypeMapper.selectByType("sys_absent")).as("未命中的编码必须返回 null").isNull();
        assertThat(dictTypeMapper.selectByName("不存在的名称")).isNull();
    }

    /**
     * 类型分页必须组合可选的模糊、精确与时间区间条件，并按编号倒序。
     *
     * <p>名称与编码是运营筛选字典的入口；排序变化会让新建的字典沉到列表末尾。</p>
     */
    @Test
    void dictTypePageAppliesOptionalFiltersAndOrder() {
        LocalDateTime base = LocalDateTime.of(2024, 1, 1, 0, 0);
        dictTypeMapper.insert(dictType(1L, "sys_sex", "性别", CommonStatusEnum.ENABLE.getStatus()));
        dictTypeMapper.insert(dictType(2L, "sys_status", "通用状态", CommonStatusEnum.DISABLE.getStatus()));
        dictTypeMapper.insert(dictType(3L, "biz_level", "会员等级", CommonStatusEnum.ENABLE.getStatus()));
        jdbc.update("UPDATE " + TYPE_TABLE + " SET create_time = ? WHERE id = 1", base);
        jdbc.update("UPDATE " + TYPE_TABLE + " SET create_time = ? WHERE id = 2", base.plusDays(5));
        jdbc.update("UPDATE " + TYPE_TABLE + " SET create_time = ? WHERE id = 3", base.plusDays(10));

        DictTypePageReqVO nameReq = new DictTypePageReqVO();
        nameReq.setName("状态");
        assertThat(dictTypeMapper.selectPage(nameReq).getList()).extracting(DictTypeDO::getType)
                .containsExactly("sys_status");

        DictTypePageReqVO typeReq = new DictTypePageReqVO();
        typeReq.setType("biz");
        assertThat(dictTypeMapper.selectPage(typeReq).getList()).extracting(DictTypeDO::getType)
                .containsExactly("biz_level");

        DictTypePageReqVO statusReq = new DictTypePageReqVO();
        statusReq.setStatus(CommonStatusEnum.ENABLE.getStatus());
        assertThat(dictTypeMapper.selectPage(statusReq).getList()).extracting(DictTypeDO::getType)
                .containsExactly("biz_level", "sys_sex");

        DictTypePageReqVO timeReq = new DictTypePageReqVO();
        timeReq.setCreateTime(new LocalDateTime[]{base, base.plusDays(6)});
        PageResult<DictTypeDO> timePage = dictTypeMapper.selectPage(timeReq);
        assertThat(timePage.getTotal()).isEqualTo(2L);
        assertThat(timePage.getList()).extracting(DictTypeDO::getType)
                .as("区间外记录不得出现，且按编号倒序").containsExactly("sys_status", "sys_sex");

        DictTypePageReqVO noFilterReq = new DictTypePageReqVO();
        PageResult<DictTypeDO> allPage = dictTypeMapper.selectPage(noFilterReq);
        assertThat(allPage.getTotal()).as("未提供可选条件时不得追加过滤").isEqualTo(3L);
        assertThat(allPage.getList()).extracting(DictTypeDO::getId).containsExactly(3L, 2L, 1L);
    }

    /**
     * 单个软删除必须同时写入删除时间与逻辑删除标记，删除后记录不再被查询命中。
     *
     * <p>回归契约：{@code deleted} 与 {@code deleted_time} 都要落库，且 {@code selectByType}
     * 查不到该记录——删除接口返回成功必须等价于记录真正不可见。</p>
     */
    @Test
    void updateToDeleteMarksRecordDeletedAndInvisible() {
        DictTypeDO dictType = dictType(7L, "sys_probe", "探针", CommonStatusEnum.ENABLE.getStatus());
        dictTypeMapper.insert(dictType);
        LocalDateTime deletedTime = LocalDateTime.of(2024, 3, 4, 5, 6, 7);

        dictTypeMapper.updateToDelete(7L, deletedTime, "9000");

        assertThat(jdbc.queryForObject("SELECT deleted_time FROM " + TYPE_TABLE + " WHERE id = 7",
                LocalDateTime.class)).as("删除时间必须落库").isEqualTo(deletedTime);
        assertThat(jdbc.queryForObject("SELECT deleted FROM " + TYPE_TABLE + " WHERE id = 7", Boolean.class))
                .as("逻辑删除标记必须落库").isTrue();
        assertThat(dictTypeMapper.selectByType("sys_probe"))
                .as("删除后记录必须不可见").isNull();
    }

    /**
     * 软删除必须把操作人写成本次删除者，而不是沿用上一位操作人。
     *
     * <p>软删除走 {@code update(null, wrapper)}，空实体不触发 MyBatis-Plus 的
     * {@code updateFill}，所以 {@code updater} 必须在 wrapper 里显式写入。这里先用一位
     * 操作人插入并更新记录，再换另一位操作人删除，证明列值确实随本次操作人变化——
     * 若只断言"有操作人"，沿用旧值的缺陷仍会通过。</p>
     */
    @Test
    void updateToDeleteRecordsCurrentOperatorInsteadOfPreviousOne() {
        DictTypeDO dictType = dictType(9L, "sys_operator", "操作人", CommonStatusEnum.ENABLE.getStatus());
        dictTypeMapper.insert(dictType);
        // 先让记录带上一位操作人，模拟"上一位操作人留下的旧值"
        jdbc.update("UPDATE " + TYPE_TABLE + " SET updater = ? WHERE id = ?", "8001", 9L);
        assertThat(operatorOf(9L)).as("前置条件：旧操作人已就位").isEqualTo("8001");

        LocalDateTime deletedTime = LocalDateTime.of(2024, 6, 7, 8, 9, 10);
        dictTypeMapper.updateToDelete(9L, deletedTime, "8002");

        assertThat(operatorOf(9L)).as("删除必须记录本次操作人，而不是旧值").isEqualTo("8002");
        assertThat(dictTypeMapper.selectByType("sys_operator")).as("删除后记录必须不可见").isNull();
    }

    /**
     * 批量软删除同样把操作人写成本次删除者。
     *
     * @param id 字典类型编号
     * @return 该记录的 {@code updater} 列值
     */
    private String operatorOf(Long id) {
        return jdbc.queryForObject("SELECT updater FROM " + TYPE_TABLE + " WHERE id = " + id, String.class);
    }

    /**
     * 软删除后必须能用同一编码重建字典类型，被删记录仍按原编码留在表里。
     *
     * <p>回归契约：唯一索引只覆盖 {@code type} 时，被删记录会永久占用编码——业务预校验只查未删除行，
     * 因此"查不到旧记录、重建却撞唯一键"。修复后唯一索引为 {@code (type, alive)}，{@code alive}
     * 只对未删除行取值，同一编码可以"删一条、建一条"；历史行不得被删除或改写。</p>
     */
    @Test
    void updateToDeleteAllowsRecreatingTheSameTypeCode() {
        dictTypeMapper.insert(dictType(8L, "sys_recreate", "重建前", CommonStatusEnum.ENABLE.getStatus()));
        LocalDateTime deletedTime = LocalDateTime.of(2024, 3, 4, 5, 6, 7);

        dictTypeMapper.updateToDelete(8L, deletedTime, "9001");
        assertThat(dictTypeMapper.selectByType("sys_recreate"))
                .as("删除后原记录必须不可见").isNull();

        dictTypeMapper.insert(dictType(9L, "sys_recreate", "重建后", CommonStatusEnum.ENABLE.getStatus()));

        assertThat(dictTypeMapper.selectByType("sys_recreate").getId())
                .as("同一编码重建后必须命中新记录").isEqualTo(9L);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + TYPE_TABLE + " WHERE type = 'sys_recreate'",
                Long.class)).as("被删历史行必须保留").isEqualTo(2L);
        assertThat(jdbc.queryForObject("SELECT deleted FROM " + TYPE_TABLE + " WHERE id = 8", Boolean.class))
                .as("历史行的删除标记不得被重建改写").isTrue();
        assertThat(jdbc.queryForObject("SELECT type FROM " + TYPE_TABLE + " WHERE id = 8", String.class))
                .as("历史行的编码不得被改写").isEqualTo("sys_recreate");
    }

    /**
     * 同一编码必须能承受反复创建与删除，每次删除都留下独立历史行。
     *
     * <p>三次删除是关键边界：把唯一索引写成 {@code UNIQUE(type, deleted)} 时，第二次删除就会与第一条
     * 已删记录（{@code type, 1}）冲突而失败；这里三条历史行还共用同一个删除时间，证明复用不依赖
     * 删除时间互不相同，只依赖"存活标记对已删除行为空"。</p>
     */
    @Test
    void sameTypeCodeSurvivesRepeatedRecreationCycles() {
        String type = "sys_cycle";
        LocalDateTime deletedTime = LocalDateTime.of(2024, 4, 5, 6, 7, 8);
        for (int cycle = 1; cycle <= 3; cycle++) {
            dictTypeMapper.insert(dictType(200L + cycle, type, "第" + cycle + "代", CommonStatusEnum.ENABLE.getStatus()));
            dictTypeMapper.updateToDelete(200L + cycle, deletedTime, "9100");
            assertThat(dictTypeMapper.selectByType(type)).as("第 %s 次删除后编码必须不可见", cycle).isNull();
        }

        dictTypeMapper.insert(dictType(300L, type, "当前代", CommonStatusEnum.ENABLE.getStatus()));

        assertThat(jdbc.queryForList("SELECT id FROM " + TYPE_TABLE + " WHERE type = ? ORDER BY id", Long.class, type))
                .as("每次创建都必须留下独立历史行").containsExactly(201L, 202L, 203L, 300L);
        assertThat(jdbc.queryForList("SELECT deleted FROM " + TYPE_TABLE + " WHERE type = ? AND id < 300",
                Boolean.class, type)).as("三条历史行必须保持已删除").containsOnly(true);
        assertThat(jdbc.queryForList("SELECT DISTINCT type FROM " + TYPE_TABLE + " WHERE id < 300", String.class))
                .as("历史编码不得被改写").containsExactly(type);
        assertThat(dictTypeMapper.selectByType(type).getId()).as("存活记录必须是最近一次创建").isEqualTo(300L);
    }

    /**
     * 同一编码的第二条存活记录必须被唯一索引直接拒绝。
     *
     * <p>业务层的"先查后写"在并发下不可靠，编码唯一性最终只能由数据库保证；错误信息里必须出现
     * 覆盖存活行的索引名，便于运维按索引定位冲突。</p>
     */
    @Test
    void duplicateAliveTypeIsRejectedByUniqueIndex() {
        dictTypeMapper.insert(dictType(61L, "sys_dup", "第一条", CommonStatusEnum.ENABLE.getStatus()));

        assertThatThrownBy(() -> dictTypeMapper.insert(dictType(62L, "sys_dup", "第二条", CommonStatusEnum.ENABLE.getStatus())))
                .as("未删除行之间必须仍然唯一").isInstanceOf(DuplicateKeyException.class)
                .hasMessageContaining("uk_type_alive");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + TYPE_TABLE, Long.class)).isEqualTo(1L);
    }

    /**
     * 两个并发创建同一编码只能成功一个，另一个必须被唯一索引拒绝。
     *
     * <p>并发下两个请求都会通过"编码不存在"的预校验，唯一约束是最后一道防线；用例用两个真实线程在
     * 同一时刻插入同一编码，断言成功数恰好为 1、失败方是重复键异常、表里只剩一条存活记录。</p>
     *
     * @throws Exception 线程启动、等待或并发任务取值失败
     */
    @Test
    void concurrentCreationOfSameTypeAllowsExactlyOne() throws Exception {
        String type = "sys_race";
        CyclicBarrier startLine = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Callable<Object> insertSameType = () -> {
                startLine.await(10, TimeUnit.SECONDS);
                try {
                    dictTypeMapper.insert(dictType(null, type, "并发", CommonStatusEnum.ENABLE.getStatus()));
                    return "created";
                } catch (RuntimeException failure) {
                    return failure;
                }
            };
            Future<Object> first = pool.submit(insertSameType);
            Future<Object> second = pool.submit(insertSameType);
            List<Object> outcomes = List.of(first.get(30, TimeUnit.SECONDS), second.get(30, TimeUnit.SECONDS));

            assertThat(outcomes).as("并发创建同一编码必须恰好成功一次").containsOnlyOnce("created");
            Object rejected = outcomes.stream().filter(item -> !"created".equals(item)).findFirst().orElseThrow();
            assertThat(rejected).as("失败方必须是重复键异常").isInstanceOf(DuplicateKeyException.class);
            assertThat(jdbc.queryForObject(
                    "SELECT COUNT(*) FROM " + TYPE_TABLE + " WHERE type = ? AND deleted = b'0'", Long.class, type))
                    .as("唯一索引必须保证只剩一条存活记录").isEqualTo(1L);
        } finally {
            pool.shutdownNow();
        }
    }

    /**
     * 复用编码不得破坏字典数据与字典类型的关联。
     *
     * <p>字典数据按 {@code dict_type} 字符串关联类型、没有外键级联；重建类型会得到新编号，但编码不变，
     * 因此原字典数据必须仍按编码可查、可用，且不得被改写、复制或删除。这里同时核对类型侧新增一条
     * 历史行、数据侧两行原样保留。</p>
     */
    @Test
    void recreatingTypeKeepsHistoryAndDictDataAssociation() {
        dictTypeMapper.insert(dictType(41L, "sys_linked", "关联前", CommonStatusEnum.ENABLE.getStatus()));
        dictDataMapper.insert(dictData(51L, "男", "1", "sys_linked", 1));
        dictDataMapper.insert(dictData(52L, "女", "2", "sys_linked", 2));

        dictTypeMapper.updateToDelete(41L, LocalDateTime.of(2024, 8, 9, 10, 11, 12), "9200");
        dictTypeMapper.insert(dictType(42L, "sys_linked", "关联后", CommonStatusEnum.ENABLE.getStatus()));

        assertThat(dictTypeMapper.selectByType("sys_linked").getId())
                .as("同一编码必须指向本次重建的编号").isEqualTo(42L);
        assertThat(jdbc.queryForList("SELECT id FROM " + TYPE_TABLE + " WHERE type = ? ORDER BY id",
                Long.class, "sys_linked")).as("历史类型行与重建行必须并存").containsExactly(41L, 42L);
        assertThat(dictDataMapper.selectCountByDictType("sys_linked")).as("字典数据数量不得变化").isEqualTo(2L);
        assertThat(dictDataMapper.selectByDictTypeAndValue("sys_linked", "1").getLabel()).isEqualTo("男");
        assertThat(dictDataMapper.selectByDictTypeAndLabel("sys_linked", "女").getValue()).isEqualTo("2");
        assertThat(jdbc.queryForList("SELECT CONCAT(id, ':', dict_type) FROM " + DATA_TABLE + " ORDER BY id", String.class))
                .as("字典数据行不得被重建改写或复制").containsExactly("51:sys_linked", "52:sys_linked");
    }

    /**
     * schema 层契约：类型唯一索引必须覆盖存活标记，且不得存在只覆盖 {@code type} 的唯一索引。
     *
     * <p>这是本缺陷的根因位置。只要唯一索引退回 {@code UNIQUE(type)}，编码复用就会重新被拒；
     * 用例直接读 {@code information_schema}，让"只改注释或只改业务断言"的假修复无法通过。</p>
     */
    @Test
    void uniqueIndexCoversTypeAndAliveMarker() {
        assertThat(jdbc.queryForMap(
                "SELECT IS_NULLABLE, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
                        + "AND TABLE_NAME = ? AND COLUMN_NAME = 'alive'", TYPE_TABLE))
                .as("存活标记必须是可空生成列，否则已删除历史行无法共存")
                .containsEntry("IS_NULLABLE", "YES")
                .containsEntry("EXTRA", "VIRTUAL GENERATED");
        assertThat(jdbc.queryForList(
                "SELECT CONCAT(INDEX_NAME, ':', COLUMN_NAME) FROM information_schema.STATISTICS "
                        + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND NON_UNIQUE = 0 "
                        + "ORDER BY INDEX_NAME, SEQ_IN_INDEX", String.class, TYPE_TABLE))
                .as("唯一索引必须是主键与 (type, alive)，不得存在只覆盖 type 的唯一索引")
                .containsExactly("PRIMARY:id", "uk_type_alive:type", "uk_type_alive:alive");
    }

    /**
     * 批量软删除必须同时写入删除时间与逻辑删除标记，并按要求跳过空集合。
     *
     * <p>回归契约：与单条删除同源，{@code deleted} 必须落库、被删记录不可见、未指定记录不受影响。</p>
     */
    @Test
    void updateToDeleteByIdsMarksRecordsDeletedAndInvisible() {
        dictTypeMapper.insert(dictType(11L, "sys_a", "甲", CommonStatusEnum.ENABLE.getStatus()));
        dictTypeMapper.insert(dictType(12L, "sys_b", "乙", CommonStatusEnum.ENABLE.getStatus()));
        dictTypeMapper.insert(dictType(13L, "sys_c", "丙", CommonStatusEnum.ENABLE.getStatus()));
        LocalDateTime deletedTime = LocalDateTime.of(2024, 5, 6, 7, 8, 9);

        int affected = dictTypeMapper.updateToDeleteByIds(List.of(11L, 12L), deletedTime, "9002");

        assertThat(affected).as("返回真实更新行数").isEqualTo(2);
        assertThat(jdbc.queryForList("SELECT deleted_time FROM " + TYPE_TABLE + " WHERE id IN (11, 12)",
                LocalDateTime.class)).as("同批删除必须使用同一删除时间").containsOnly(deletedTime);
        assertThat(jdbc.queryForList("SELECT deleted FROM " + TYPE_TABLE + " WHERE id IN (11, 12)", Boolean.class))
                .as("批量删除的逻辑删除标记必须落库").containsOnly(true);
        assertThat(dictTypeMapper.selectByType("sys_a")).as("被删记录必须不可见").isNull();
        assertThat(dictTypeMapper.selectByType("sys_b")).as("被删记录必须不可见").isNull();
        assertThat(dictTypeMapper.selectByType("sys_c")).as("未指定的记录不得被删除").isNotNull();
        assertThat(dictTypeMapper.updateToDeleteByIds(List.of(), deletedTime, "9002"))
                .as("空集合必须直接返回 0").isZero();
        assertThat(dictTypeMapper.updateToDeleteByIds(null, deletedTime, "9002")).isZero();
        assertThat(dictTypeMapper.selectByType("sys_c")).isNotNull();
    }

    /** 字典数据按键值、标签与值集合查询时必须同时限定字典类型。 */
    @Test
    void dictDataLookupsAreScopedToDictType() {
        dictDataMapper.insert(dictData(1L, "男", "1", "sys_sex", 1));
        dictDataMapper.insert(dictData(2L, "女", "2", "sys_sex", 2));
        dictDataMapper.insert(dictData(3L, "启用", "1", "sys_status", 1));

        assertThat(dictDataMapper.selectByDictTypeAndValue("sys_sex", "1").getLabel()).isEqualTo("男");
        assertThat(dictDataMapper.selectByDictTypeAndLabel("sys_sex", "女").getValue()).isEqualTo("2");
        assertThat(dictDataMapper.selectByDictTypeAndValue("sys_status", "2"))
                .as("其它字典类型下的相同值不得命中").isNull();
        assertThat(dictDataMapper.selectByDictTypeAndLabel("sys_sex", "启用")).isNull();
        assertThat(dictDataMapper.selectByDictTypeAndValues("sys_sex", List.of("1", "2")))
                .extracting(DictDataDO::getLabel).containsExactlyInAnyOrder("男", "女");
        assertThat(dictDataMapper.selectByDictTypeAndValues("sys_status", List.of("2")))
                .as("值集合查询同样必须限定字典类型").isEmpty();
    }

    /** 按类型统计与按类型集合统计必须只统计对应范围。 */
    @Test
    void dictDataCountsAreScopedToGivenTypes() {
        dictDataMapper.insert(dictData(1L, "男", "1", "sys_sex", 1));
        dictDataMapper.insert(dictData(2L, "女", "2", "sys_sex", 2));
        dictDataMapper.insert(dictData(3L, "启用", "1", "sys_status", 1));

        assertThat(dictDataMapper.selectCountByDictType("sys_sex")).isEqualTo(2L);
        assertThat(dictDataMapper.selectCountByDictType("sys_absent")).isZero();
        assertThat(dictDataMapper.selectCountByDictTypes(List.of("sys_sex", "sys_status"))).isEqualTo(3L);
        assertThat(dictDataMapper.selectCountByDictTypes(List.of("sys_absent"))).isZero();
    }

    /**
     * 字典数据分页必须组合标签模糊、类型与状态条件，并按字典类型与排序值倒序。
     *
     * <p>排序口径决定前端下拉顺序：写错会让同一字典内的选项顺序随机变化。</p>
     */
    @Test
    void dictDataPageAppliesOptionalFiltersAndOrder() {
        dictDataMapper.insert(dictData(1L, "男", "1", "sys_sex", 1));
        dictDataMapper.insert(dictData(2L, "女", "2", "sys_sex", 2));
        dictDataMapper.insert(dictData(3L, "未知", "3", "sys_sex", 3));
        jdbc.update("UPDATE " + DATA_TABLE + " SET status = 1 WHERE id = 3");
        dictDataMapper.insert(dictData(4L, "启用", "1", "sys_status", 1));

        DictDataPageReqVO labelReq = new DictDataPageReqVO();
        labelReq.setLabel("女");
        assertThat(dictDataMapper.selectPage(labelReq).getList()).extracting(DictDataDO::getId)
                .containsExactly(2L);

        DictDataPageReqVO typeReq = new DictDataPageReqVO();
        typeReq.setDictType("sys_status");
        assertThat(dictDataMapper.selectPage(typeReq).getList()).extracting(DictDataDO::getId)
                .containsExactly(4L);

        DictDataPageReqVO statusReq = new DictDataPageReqVO();
        statusReq.setStatus(CommonStatusEnum.ENABLE.getStatus());
        PageResult<DictDataDO> statusPage = dictDataMapper.selectPage(statusReq);
        assertThat(statusPage.getTotal()).as("停用数据不得出现在启用筛选中").isEqualTo(3L);
        assertThat(statusPage.getList()).extracting(DictDataDO::getDictType)
                .as("按字典类型倒序、同类型按排序值倒序").containsExactly("sys_status", "sys_sex", "sys_sex");
        assertThat(statusPage.getList()).extracting(DictDataDO::getId).containsExactly(4L, 2L, 1L);

        DictDataPageReqVO noFilterReq = new DictDataPageReqVO();
        assertThat(dictDataMapper.selectPage(noFilterReq).getTotal()).as("无条件时必须返回全部").isEqualTo(4L);
    }

    /** 按状态与类型查询必须支持只给状态、只给类型与都不给三种口径。 */
    @Test
    void selectListByStatusAndDictTypeSupportsPartialConditions() {
        dictDataMapper.insert(dictData(1L, "男", "1", "sys_sex", 1));
        dictDataMapper.insert(dictData(2L, "女", "2", "sys_sex", 2));
        dictDataMapper.insert(dictData(3L, "未知", "3", "sys_sex", 3));
        jdbc.update("UPDATE " + DATA_TABLE + " SET status = 1 WHERE id = 3");

        assertThat(dictDataMapper.selectListByStatusAndDictType(CommonStatusEnum.ENABLE.getStatus(), null))
                .extracting(DictDataDO::getId).containsExactlyInAnyOrder(1L, 2L);
        assertThat(dictDataMapper.selectListByStatusAndDictType(null, "sys_sex"))
                .extracting(DictDataDO::getId).containsExactlyInAnyOrder(1L, 2L, 3L);
        assertThat(dictDataMapper.selectListByStatusAndDictType(CommonStatusEnum.DISABLE.getStatus(), "sys_sex"))
                .extracting(DictDataDO::getId).containsExactly(3L);
        assertThat(dictDataMapper.selectListByStatusAndDictType(null, null))
                .as("两个条件都为空时必须返回全部而不是空列表").hasSize(3);
        assertThat(dictDataMapper.selectListByStatusAndDictType(CommonStatusEnum.ENABLE.getStatus(), "sys_absent"))
                .isEmpty();
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
     * 登记生产 Mapper 到测试上下文。
     *
     * @param mapperType Mapper 接口类型
     * @param <T> Mapper 类型
     */
    private <T> void registerMapper(Class<T> mapperType) {
        context.registerBean(mapperType, () -> {
            try {
                MapperFactoryBean<T> factory = new MapperFactoryBean<>(mapperType);
                factory.setSqlSessionFactory(context.getBean(SqlSessionFactory.class));
                factory.afterPropertiesSet();
                return factory.getObject();
            } catch (Exception failure) {
                throw new IllegalStateException("测试 Mapper 创建失败：" + mapperType.getSimpleName(), failure);
            }
        });
    }

    /**
     * 构造字典类型记录。
     *
     * @param id 编号
     * @param type 类型编码
     * @param name 名称
     * @param status 状态
     * @return 字典类型记录
     */
    private static DictTypeDO dictType(Long id, String type, String name, Integer status) {
        DictTypeDO dictType = new DictTypeDO();
        dictType.setId(id);
        dictType.setType(type);
        dictType.setName(name);
        dictType.setStatus(status);
        return dictType;
    }

    /**
     * 构造字典数据记录。
     *
     * @param id 编号
     * @param label 标签
     * @param value 字典值
     * @param dictType 字典类型
     * @param sort 排序值
     * @return 字典数据记录
     */
    private static DictDataDO dictData(Long id, String label, String value, String dictType, Integer sort) {
        DictDataDO dictData = new DictDataDO();
        dictData.setId(id);
        dictData.setLabel(label);
        dictData.setValue(value);
        dictData.setDictType(dictType);
        dictData.setSort(sort);
        dictData.setStatus(CommonStatusEnum.ENABLE.getStatus());
        return dictData;
    }

    /** 缺失隔离环境时直接失败，避免退化成跳过真实数据库证据。 */
    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("缺少隔离测试环境变量 " + name);
        }
        return value;
    }

    /** 定位版本控制中的生产 DDL，不依赖测试进程从哪个模块启动。 */
    private static Path repositoryRoot() {
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
    private static SqlSessionFactory sqlSessionFactory(DataSource dataSource) {
        try {
            MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
            factory.setDataSource(dataSource);
            MybatisConfiguration configuration = new MybatisConfiguration();
            configuration.setMapUnderscoreToCamelCase(true);
            MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
            interceptor.addInnerInterceptor(new PaginationInnerInterceptor());
            configuration.addInterceptor(interceptor);
            factory.setConfiguration(configuration);
            GlobalConfig config = new GlobalConfig();
            config.setDbConfig(new GlobalConfig.DbConfig().setIdType(IdType.AUTO));
            config.setMetaObjectHandler(new DefaultDBFieldHandler());
            factory.setGlobalConfig(config);
            return factory.getObject();
        } catch (Exception failure) {
            throw new IllegalStateException("字典 Mapper 测试初始化失败", failure);
        }
    }

}
