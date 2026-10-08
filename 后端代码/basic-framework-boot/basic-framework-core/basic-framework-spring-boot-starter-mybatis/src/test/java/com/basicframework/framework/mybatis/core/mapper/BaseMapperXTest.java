package com.basicframework.framework.mybatis.core.mapper;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.framework.common.pojo.PageParam;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.pojo.SortablePageParam;
import com.basicframework.framework.common.pojo.SortingField;
import com.basicframework.framework.common.util.spring.SpringUtils;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.framework.mybatis.core.query.MPJLambdaWrapperX;
import com.github.yulichang.interfaces.MPJBaseJoin;
import lombok.Data;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContext;
import org.springframework.context.support.GenericApplicationContext;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Answers.CALLS_REAL_METHODS;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证 {@link BaseMapperX} 通用默认方法的分支口径。
 *
 * <p>业务 Mapper 的查询条件拼装由这里统一提供，真正决定数据边界的有三类分支：</p>
 * <ul>
 *   <li>每页条数为 {@link PageParam#PAGE_SIZE_NONE} 时必须退化为全量查询，并让总数等于实际返回条数，
 *       而不是被截断的首页条数——导出场景依赖这个口径。</li>
 *   <li>集合条件为空时必须直接返回空结果，不得拼出 {@code IN ()}，也不得退化成全量查询。</li>
 *   <li>批量写入按数据库方言分流：SQL Server 无法在批量插入后取回自增主键，必须逐条插入。</li>
 * </ul>
 *
 * <p>这些分支只依赖 MyBatis-Plus 的条件拼装与方言判断，因此用保留默认方法真实执行的替身即可验证；
 * 真实 SQL 在 MySQL 上的执行结果由 {@code BaseMapperXMySqlIT} 承担。</p>
 *
 * @author shady2713
 */
class BaseMapperXTest {

    /** SQL Server 方言的产品名，用于驱动逐条插入分支。 */
    private static final String SQL_SERVER_PRODUCT = "Microsoft SQL Server";
    /** 与默认方言一致的产品名。 */
    private static final String MYSQL_PRODUCT = "MySQL";

    /** 记录最近一次列表查询交给持久化层的条件对象。 */
    private AbstractWrapper<ProbeRecord, ?, ?> listWrapper;
    /** 记录最近一次单条或计数查询交给持久化层的条件对象。 */
    private AbstractWrapper<ProbeRecord, ?, ?> oneWrapper;
    /** 记录最近一次删除交给持久化层的条件对象。 */
    private AbstractWrapper<ProbeRecord, ?, ?> deleteWrapper;
    /** 记录最近一次按条件更新交给持久化层的条件对象。 */
    private AbstractWrapper<ProbeRecord, ?, ?> updateWrapper;
    /** 记录最近一次连表查询交给持久化层的连接条件。 */
    private MPJBaseJoin<ProbeRecord> joinWrapperRef;
    /** 记录最近一次分页查询交给分页插件的分页对象。 */
    private IPage<ProbeRecord> pageRef;
    /** 列表查询要返回的记录。 */
    private List<ProbeRecord> listResult;
    /** 列表查询要返回的记录数量，用于验证总数口径。 */
    private List<ProbeRecord> joinListResult;
    /** 删除与更新要返回的影响行数。 */
    private int affectedRows;
    /** 计数查询要返回的数量。 */
    private long countResult;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录参数。 */
    private ProbeMapper mapper;
    /** 替换全局 Spring 上下文期间保存的原上下文。 */
    private ApplicationContext previousContext;
    /** 本用例建立的容器，只为向方言判断提供数据源元数据。 */
    private GenericApplicationContext dialectContext;

    /**
     * 初始化探针实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), ProbeRecord.class);
    }

    /** 为每个用例创建独立替身，并让抽象方法按用例设定的方式回放真实副作用。 */
    @BeforeEach
    void setUp() {
        listWrapper = null;
        oneWrapper = null;
        deleteWrapper = null;
        updateWrapper = null;
        joinWrapperRef = null;
        pageRef = null;
        listResult = List.of();
        joinListResult = List.of();
        affectedRows = 0;
        countResult = 0L;
        mapper = mock(ProbeMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            listWrapper = invocation.getArgument(0);
            return listResult;
        }).when(mapper).selectList(any(Wrapper.class));
        doAnswer(invocation -> {
            oneWrapper = invocation.getArgument(0);
            return null;
        }).when(mapper).selectOne(any(Wrapper.class));
        doAnswer(invocation -> {
            oneWrapper = invocation.getArgument(0);
            return countResult;
        }).when(mapper).selectCount(any(Wrapper.class));
        doAnswer(invocation -> {
            deleteWrapper = invocation.getArgument(0);
            return affectedRows;
        }).when(mapper).delete(any(Wrapper.class));
        doAnswer(invocation -> {
            pageRef = invocation.getArgument(0);
            listWrapper = invocation.getArgument(1);
            pageRef.setRecords(listResult);
            pageRef.setTotal((long) listResult.size());
            return pageRef;
        }).when(mapper).selectPage(any(IPage.class), any(Wrapper.class));
        doAnswer(invocation -> {
            updateWrapper = invocation.getArgument(1);
            return affectedRows;
        }).when(mapper).update(any(ProbeRecord.class), any(Wrapper.class));
        doAnswer(invocation -> {
            joinWrapperRef = invocation.getArgument(1);
            return joinListResult;
        }).when(mapper).selectJoinList(any(Class.class), any(MPJBaseJoin.class));
        doAnswer(invocation -> {
            pageRef = invocation.getArgument(0);
            joinWrapperRef = invocation.getArgument(2);
            pageRef.setRecords(joinListResult);
            pageRef.setTotal((long) joinListResult.size());
            return pageRef;
        }).when(mapper).selectJoinPage(any(IPage.class), any(Class.class), any(MPJBaseJoin.class));
    }

    /** 用例结束后关闭容器并还原全局 Spring 上下文，避免影响同 JVM 的其它用例。 */
    @AfterEach
    void restoreContext() {
        if (dialectContext != null) {
            dialectContext.close();
            dialectContext = null;
        }
        if (previousContext != null) {
            new SpringUtils().setApplicationContext(previousContext);
            previousContext = null;
        }
    }

    /**
     * 建立只承载数据源元数据的容器，把方言判断固定为指定数据库。
     *
     * @param productName JDBC 元数据返回的数据库产品名
     */
    private void useDialect(String productName) {
        try {
            DataSource dataSource = mock(DataSource.class);
            Connection connection = mock(Connection.class);
            DatabaseMetaData metaData = mock(DatabaseMetaData.class);
            when(dataSource.getConnection()).thenReturn(connection);
            when(connection.getMetaData()).thenReturn(metaData);
            when(metaData.getDatabaseProductName()).thenReturn(productName);
            previousContext = SpringUtils.getApplicationContext();
            dialectContext = new GenericApplicationContext();
            dialectContext.registerBean(DataSource.class, () -> dataSource);
            dialectContext.refresh();
            new SpringUtils().setApplicationContext(dialectContext);
        } catch (Exception failure) {
            throw new IllegalStateException("方言替身装配失败", failure);
        }
    }

    /** 常规分页必须把页码与每页条数交给分页插件，总数取自查询结果而不是当前页条数。 */
    @Test
    void selectPageForwardsPagingParametersAndReportsRealTotal() {
        listResult = List.of(record(1L), record(2L));

        PageResult<ProbeRecord> result = mapper.selectPage(new PageParam(), new WrapperX());

        assertThat(result.getList()).hasSize(2);
        assertThat(result.getTotal()).isEqualTo(2L);
        assertThat(pageRef.getCurrent()).isEqualTo(1);
        assertThat(pageRef.getSize()).isEqualTo(10);
        assertThat(pageRef.searchCount()).isTrue();
    }

    /** 每页条数为不分页时必须全量返回，总数等于实际条数，且不执行分页查询。 */
    @Test
    void selectPageWithNoneSizeReturnsEveryMatchWithoutPaging() {
        listResult = List.of(record(1L), record(2L), record(3L));
        PageParam pageParam = new PageParam();
        pageParam.setPageSize(PageParam.PAGE_SIZE_NONE);

        PageResult<ProbeRecord> result = mapper.selectPage(pageParam, new WrapperX());

        assertThat(result.getList()).hasSize(3);
        assertThat(result.getTotal()).as("不分页时总数必须是实际返回条数").isEqualTo(3L);
        assertThat(pageRef).as("不分页分支不得走分页查询").isNull();
    }

    /** 可排序分页在不分页时仍必须带上排序字段，否则导出的顺序与页面看到的不同。 */
    @Test
    void selectPageWithNoneSizeStillAppliesSorting() {
        listResult = List.of(record(1L));
        SortablePageParam pageParam = new SortablePageParam();
        pageParam.setPageSize(PageParam.PAGE_SIZE_NONE);
        pageParam.setSortingFields(List.of(new SortingField("name", SortingField.ORDER_DESC)));
        WrapperX wrapper = new WrapperX();

        mapper.selectPage(pageParam, wrapper);

        assertThat(wrapper.getTargetSql()).contains("ORDER BY name DESC");
        assertThat(listWrapper).isSameAs(wrapper);
    }

    /** 不带排序的普通分页参数入口必须等价于"无排序字段"，排序条件不得被当成筛选条件。 */
    @Test
    void selectPageWithPlainParamAppliesNoOrdering() {
        WrapperX wrapper = new WrapperX();

        mapper.selectPage(new PageParam(), wrapper);

        assertThat(wrapper.getTargetSql()).as("无排序字段时不得凭空产生 ORDER BY").isEmpty();
        assertThat(listWrapper).isSameAs(wrapper);
    }

    /** 连表不分页分支必须全量返回并以实际条数作为总数。 */
    @Test
    void selectJoinPageWithNoneSizeReturnsEveryJoinedRow() {
        joinListResult = List.of(record(1L), record(2L));
        PageParam pageParam = new PageParam();
        pageParam.setPageSize(PageParam.PAGE_SIZE_NONE);

        MPJLambdaWrapperX<ProbeRecord> wrapper = new MPJLambdaWrapperX<>();

        PageResult<ProbeRecord> result = mapper.selectJoinPage(pageParam, ProbeRecord.class, wrapper);

        assertThat(result.getList()).hasSize(2);
        assertThat(result.getTotal()).isEqualTo(2L);
        assertThat(joinWrapperRef).isSameAs(wrapper);
        assertThat(pageRef).as("不分页分支不得走连表分页").isNull();
    }

    /** 连表分页必须把页码与每页条数交给分页插件，总数取自连接结果。 */
    @Test
    void selectJoinPageForwardsPagingParameters() {
        PageParam pageParam = new PageParam();
        pageParam.setPageNo(2);
        pageParam.setPageSize(5);

        mapper.selectJoinPage(pageParam, ProbeRecord.class, new MPJLambdaWrapperX<>());

        assertThat(pageRef.getCurrent()).isEqualTo(2);
        assertThat(pageRef.getSize()).isEqualTo(5);
    }

    /** 可排序参数的连表分页入口必须存在独立分支：不分页时全量返回，分页时把排序字段带进构建过程。 */
    @Test
    void selectJoinPageWithSortableParamHasItsOwnBranch() {
        SortablePageParam pageable = new SortablePageParam();
        pageable.setPageSize(PageParam.PAGE_SIZE_NONE);
        MPJLambdaWrapperX<ProbeRecord> wrapper = new MPJLambdaWrapperX<>();

        PageResult<ProbeRecord> result = mapper.selectJoinPage(pageable, ProbeRecord.class, wrapper);

        assertThat(result.getList()).isEmpty();
        assertThat(result.getTotal()).isZero();
        assertThat(joinWrapperRef).isSameAs(wrapper);
        assertThat(pageRef).as("可排序入口的不分页分支同样不走连表分页").isNull();
    }

    /** 以连接条件接口静态类型传入时必须走同一个连表分页路径，连接条件原样下传。 */
    @Test
    void selectJoinPageAcceptsJoinInterfaceStaticType() {
        MPJBaseJoin<ProbeRecord> wrapper = new MPJLambdaWrapperX<>();
        PageParam pageParam = new PageParam();
        pageParam.setPageSize(50);

        mapper.selectJoinPage(pageParam, ProbeRecord.class, wrapper);

        assertThat(pageRef.getSize()).isEqualTo(50);
        assertThat(joinWrapperRef).isSameAs(wrapper);
    }

    /** 以连接条件接口传入的连表分页与具体包装器同样走同一条分页路径，且必须原样下传连接条件。 */
    @Test
    void selectJoinPageAcceptsJoinInterfaceOverload() {
        MPJLambdaWrapperX<ProbeRecord> wrapper = new MPJLambdaWrapperX<>();

        mapper.selectJoinPage(new PageParam(), ProbeRecord.class, wrapper);

        assertThat(pageRef).isNotNull();
        assertThat(pageRef.getSize()).isEqualTo(10);
        assertThat(joinWrapperRef).isSameAs(wrapper);
    }

    /** 按列名与按 Lambda 查询单条都必须生成等值条件，并原样返回持久层结果。 */
    @Test
    void selectOneByColumnNameAndByLambdaBuildEqualityConditions() {
        mapper.selectOne("name", "alpha");
        assertThat(oneWrapper.getTargetSql()).contains("name =");

        mapper.selectOne(ProbeRecord::getName, "alpha");
        assertThat(oneWrapper.getTargetSql()).contains("name =");
        assertThat(oneWrapper.getParamNameValuePairs().values()).containsExactly("alpha");
    }

    /** 双条件与三条件查询单条时所有条件都必须同时生效，漏掉一个就会命中别的记录。 */
    @Test
    void selectOneWithMultipleConditionsAppliesEveryCondition() {
        mapper.selectOne("name", "alpha", "dept_id", 10L);
        assertThat(oneWrapper.getTargetSql()).contains("name =").contains("dept_id =");

        mapper.selectOne(ProbeRecord::getName, "alpha", ProbeRecord::getDeptId, 10L,
                ProbeRecord::getId, 1L);
        assertThat(oneWrapper.getTargetSql()).contains("name =").contains("dept_id =").contains("id =");
        assertThat(oneWrapper.getParamNameValuePairs().values()).containsExactlyInAnyOrder("alpha", 10L, 1L);
    }

    /** 取首条必须返回多条命中中的第一条，用于并发插入导致重复的场景。 */
    @Test
    void selectFirstOneReturnsFirstMatchedRecord() {
        listResult = List.of(record(7L), record(8L));

        assertThat(mapper.selectFirstOne(ProbeRecord::getName, "alpha")).isSameAs(listResult.get(0));
        assertThat(oneWrapper).as("取首条走列表查询而不是单条查询").isNull();
        assertThat(listWrapper.getTargetSql()).contains("name =");
    }

    /** 没有命中时取首条必须返回 null，而不是空对象或异常。 */
    @Test
    void selectFirstOneReturnsNullWhenNothingMatches() {
        listResult = List.of();

        assertThat(mapper.selectFirstOne(ProbeRecord::getName, "alpha",
                ProbeRecord::getDeptId, 10L)).isNull();
        assertThat(listWrapper.getTargetSql()).contains("name =").contains("dept_id =");
    }

    /** 双 Lambda 条件查询单条必须同时生效，漏掉一个就会命中别的记录。 */
    @Test
    void selectOneWithTwoLambdaConditionsAppliesBothConditions() {
        mapper.selectOne(ProbeRecord::getName, "alpha", ProbeRecord::getDeptId, 10L);

        assertThat(oneWrapper.getTargetSql()).contains("name =").contains("dept_id =");
        assertThat(oneWrapper.getParamNameValuePairs().values()).containsExactlyInAnyOrder("alpha", 10L);
    }

    /** 三条件取首条必须同时应用三个条件。 */
    @Test
    void selectFirstOneWithThreeConditionsAppliesEveryCondition() {
        mapper.selectFirstOne(ProbeRecord::getName, "alpha", ProbeRecord::getDeptId, 10L,
                ProbeRecord::getId, 1L);

        assertThat(listWrapper.getTargetSql()).contains("name =").contains("dept_id =").contains("id =");
        assertThat(listWrapper.getParamNameValuePairs().values()).containsExactlyInAnyOrder("alpha", 10L, 1L);
    }

    /** 计数的三种入口都必须生成等值条件并原样返回持久层结果。 */
    @Test
    void selectCountSupportsAllConditionForms() {
        countResult = 3L;

        assertThat(mapper.selectCount()).isEqualTo(3L);
        assertThat(mapper.selectCount("dept_id", 10L)).isEqualTo(3L);
        assertThat(mapper.selectCount(ProbeRecord::getDeptId, 10L)).isEqualTo(3L);
        assertThat(oneWrapper.getTargetSql()).contains("dept_id =");
        assertThat(oneWrapper.getParamNameValuePairs().values()).containsExactly(10L);
    }

    /** 列表的集合条件为空时必须直接返回空列表且完全不查库，避免退化成全量查询。 */
    @Test
    void selectListWithEmptyCollectionShortCircuits() {
        assertThat(mapper.selectList("dept_id", List.of())).isEmpty();
        assertThat(mapper.selectList(ProbeRecord::getDeptId, List.of())).isEmpty();
        assertThat(mapper.selectList(ProbeRecord::getDeptId, (Collection<?>) null)).isEmpty();

        verify(mapper, never()).selectList(any(Wrapper.class));
        assertThat(listWrapper).as("短路路径不得拼出任何条件").isNull();
    }

    /** 单值条件必须生成等值条件，列名与 Lambda 两种入口都要覆盖到。 */
    @Test
    void selectListWithSingleValueBuildsEqualityCondition() {
        mapper.selectList("dept_id", 10L);
        assertThat(listWrapper.getTargetSql()).contains("dept_id =");
        assertThat(listWrapper.getParamNameValuePairs().values()).containsExactly(10L);

        mapper.selectList(ProbeRecord::getDeptId, 20L);
        assertThat(listWrapper.getTargetSql()).contains("dept_id =");
        assertThat(listWrapper.getParamNameValuePairs().values()).containsExactly(20L);
    }

    /** 集合条件非空时必须生成 IN 条件并透传全部取值；列名入口同样要走到。 */
    @Test
    void selectListWithColumnNameCollectionBuildsInCondition() {
        mapper.selectList("name", List.of("alpha", "bravo"));

        assertThat(listWrapper.getTargetSql()).contains("name IN");
        assertThat(listWrapper.getParamNameValuePairs().values()).containsExactlyInAnyOrder("alpha", "bravo");
    }

    /** 集合条件非空时必须生成 IN 条件并透传全部取值。 */
    @Test
    void selectListWithCollectionBuildsInCondition() {
        mapper.selectList(ProbeRecord::getDeptId, List.of(10L, 20L));

        assertThat(listWrapper.getTargetSql()).contains("dept_id IN");
        assertThat(listWrapper.getParamNameValuePairs().values()).containsExactlyInAnyOrder(10L, 20L);
    }

    /** 无参列表入口按全量查询，双条件入口必须同时应用两个条件。 */
    @Test
    void selectListSupportsNoArgumentAndTwoConditionForms() {
        mapper.selectList();
        assertThat(listWrapper.getTargetSql()).isEmpty();

        mapper.selectList(ProbeRecord::getDeptId, 10L, ProbeRecord::getName, "alpha");
        assertThat(listWrapper.getTargetSql()).contains("dept_id =").contains("name =");
        assertThat(listWrapper.getParamNameValuePairs().values()).containsExactlyInAnyOrder(10L, "alpha");
    }

    /** SQL Server 方言下批量插入必须逐条执行，否则批量写入后取不回自增主键。 */
    @Test
    void insertBatchOnSqlServerDialectInsertsOneByOne() {
        useDialect(SQL_SERVER_PRODUCT);
        ProbeRecord first = record(1L);
        ProbeRecord second = record(2L);
        List<ProbeRecord> entities = List.of(first, second);

        Boolean result = mapper.insertBatch(entities);

        assertThat(result).isTrue();
        verify(mapper).insert(first);
        verify(mapper).insert(second);
    }

    /** SQL Server 方言下的空集合返回 false，不产生任何写入。 */
    @Test
    void insertBatchOnSqlServerDialectWithEmptyCollectionWritesNothing() {
        useDialect(SQL_SERVER_PRODUCT);

        assertThat(mapper.insertBatch(List.of())).isFalse();
        assertThat(mapper.insertBatch(List.of(), 10)).isFalse();

        verify(mapper, never()).insert(any(ProbeRecord.class));
    }

    /**
     * 常规方言下批量插入交给 MyBatis-Plus 的静态助手，而不是逐条插入。
     *
     * <p>该助手依赖容器装配出的会话工厂，单测环境无法提供；断言的是"没有走逐条插入分支"这一可观察
     * 事实：逐条插入分支不会抛异常，而静态助手在缺少会话工厂时会失败。真实批量写入结果由
     * {@code BaseMapperXMySqlIT} 在真实数据库上验证。</p>
     */
    @Test
    void insertBatchOnRegularDialectDelegatesToBatchHelper() {
        useDialect(MYSQL_PRODUCT);
        List<ProbeRecord> entities = List.of(record(1L));

        assertThatThrownBy(() -> mapper.insertBatch(entities))
                .isInstanceOf(RuntimeException.class);
        verify(mapper, never()).insert(any(ProbeRecord.class));
    }

    /** 按实体的批量更新无条件更新整表，必须原样把更新实体与空条件交给持久层。 */
    @Test
    void updateBatchByEntityUpdatesEveryRowWithEmptyCondition() {
        affectedRows = 4;
        ProbeRecord update = new ProbeRecord();
        update.setDeptId(30L);

        int updated = mapper.updateBatch(update);

        assertThat(updated).isEqualTo(4);
        assertThat(updateWrapper).as("整表更新刻意使用空条件").isNotNull();
        assertThat(updateWrapper.getTargetSql()).isEmpty();
    }

    /** 按主键的批量更新委托给 MyBatis-Plus 静态助手，单测环境未装配会话工厂时必然失败。 */
    @Test
    void updateBatchByEntitiesDelegatesToBatchHelper() {
        List<ProbeRecord> entities = new ArrayList<>();
        entities.add(record(1L));

        assertThatThrownBy(() -> mapper.updateBatch(entities))
                .isInstanceOf(RuntimeException.class);
        assertThatThrownBy(() -> mapper.updateBatch(entities, 2))
                .isInstanceOf(RuntimeException.class);
    }

    /** 按列名与按 Lambda 删除都必须生成等值条件并返回真实影响行数。 */
    @Test
    void deleteByColumnNameAndByLambdaBuildEqualityConditions() {
        affectedRows = 1;

        assertThat(mapper.delete("name", "orphan")).isEqualTo(1);
        assertThat(deleteWrapper.getTargetSql()).contains("name =");

        assertThat(mapper.delete(ProbeRecord::getDeptId, 10L)).isEqualTo(1);
        assertThat(deleteWrapper.getTargetSql()).contains("dept_id =");
        assertThat(deleteWrapper.getParamNameValuePairs().values()).containsExactly(10L);
    }

    /** 批量删除的集合为空时必须返回 0 且完全不查库，不得退化成全表删除。 */
    @Test
    void deleteBatchWithEmptyCollectionRemovesNothing() {
        assertThat(mapper.deleteBatch(ProbeRecord::getDeptId, List.of())).isZero();

        verify(mapper, never()).delete(any(Wrapper.class));
        assertThat(deleteWrapper).isNull();
    }

    /** 批量删除的集合非空时必须生成 IN 条件并返回真实影响行数。 */
    @Test
    void deleteBatchWithValuesUsesInCondition() {
        affectedRows = 2;

        assertThat(mapper.deleteBatch(ProbeRecord::getName, List.of("alpha", "bravo"))).isEqualTo(2);
        assertThat(deleteWrapper.getTargetSql()).contains("name IN");
        assertThat(deleteWrapper.getParamNameValuePairs().values()).containsExactlyInAnyOrder("alpha", "bravo");
    }

    /**
     * 构造探针实体。
     *
     * @param id 主键
     * @return 探针实体
     */
    private static ProbeRecord record(Long id) {
        ProbeRecord record = new ProbeRecord();
        record.setId(id);
        return record;
    }

    /**
     * 探针实体，仅用于验证 {@link BaseMapperX} 的通用默认方法，不代表任何业务对象。
     *
     * @author shady2713
     */
    @Data
    @TableName("probe_record")
    static class ProbeRecord {

        /** 主键。 */
        @TableId(type = IdType.AUTO)
        private Long id;

        /** 名称。 */
        private String name;

        /** 所属部门编号。 */
        private Long deptId;

    }

    /**
     * 探针查询条件，只使用框架提供的默认扩展方法。
     *
     * @author shady2713
     */
    static class WrapperX extends LambdaQueryWrapperX<ProbeRecord> {
    }

    /**
     * 探针 Mapper，直接继承 {@link BaseMapperX} 以获得全部待验证的默认方法。
     *
     * @author shady2713
     */
    interface ProbeMapper extends BaseMapperX<ProbeRecord> {
    }

}