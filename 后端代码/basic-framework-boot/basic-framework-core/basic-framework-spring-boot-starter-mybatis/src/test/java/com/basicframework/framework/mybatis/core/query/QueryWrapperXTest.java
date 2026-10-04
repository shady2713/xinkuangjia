package com.basicframework.framework.mybatis.core.query;

import com.basicframework.framework.common.util.spring.SpringUtils;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.SQLException;
import java.util.Collection;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 验证 {@link QueryWrapperX} 的"值存在才拼接"条件契约与数据库方言分页契约。
 *
 * <p>这些 xxxIfPresent 方法是各业务 Mapper 拼接动态查询条件的唯一入口：多拼一个条件会把查询结果错误收窄，
 * 少拼一个条件会越过调用方要求的过滤，因此逐个方法锁定"什么值参与拼接、什么值被跳过、拼接后的 SQL 片段形态"。</p>
 *
 * <p>分页方法 {@code limitN} 依赖当前连接的数据库类型，本用例只在数据源这一进程外边界使用替身，
 * 通过替换容器内的 DataSource 让方言判定走真实 {@code JdbcUtils} 逻辑；真实连接元数据读取已由
 * {@code JdbcUtilsTest} 用隔离 MySQL 覆盖。结束时会还原进入用例前的 Spring 静态上下文。</p>
 *
 * @author shady2713
 */
class QueryWrapperXTest {

    /** 进入用例前的静态 Spring 上下文，结束后原样恢复，避免污染同 JVM 其它测试。 */
    private ApplicationContext previousContext;
    /** 本用例创建的数据源容器，结束时关闭。 */
    private AnnotationConfigApplicationContext context;

    /** 记录静态上下文，供结束后还原。 */
    @BeforeEach
    void setUp() {
        previousContext = SpringUtils.getApplicationContext();
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

    /**
     * like 条件只在文本有效时拼接。
     *
     * <p>空白串拼接会生成 {@code LIKE ' '} 之类永远匹配不到数据的条件，必须按"无值"处理；
     * 方法还要返回同一个包装器以支持链式调用。</p>
     */
    @Test
    void likeIfPresentAppendsOnlyForText() {
        QueryWrapperX<Object> wrapper = new QueryWrapperX<>();
        assertThat(wrapper.likeIfPresent("name", "DUMMY-NAME")).as("必须返回当前包装器以支持链式调用").isSameAs(wrapper);
        assertThat(wrapper.getTargetSql()).contains("name LIKE");

        assertThat(new QueryWrapperX<Object>().likeIfPresent("name", "").getTargetSql()).as("空串不拼接").isEmpty();
        assertThat(new QueryWrapperX<Object>().likeIfPresent("name", "   ").getTargetSql()).as("空白串不拼接").isEmpty();
        assertThat(new QueryWrapperX<Object>().likeIfPresent("name", null).getTargetSql()).as("null 不拼接").isEmpty();
    }

    /** 集合版 in 条件在集合为空或为 null 时跳过，非空时按原集合拼接。 */
    @Test
    void inIfPresentCollectionSkipsEmptyOrNull() {
        QueryWrapperX<Object> withValues = new QueryWrapperX<>();
        assertThat(withValues.inIfPresent("id", List.of(1, 2))).isSameAs(withValues);
        assertThat(withValues.getTargetSql()).contains("id IN");

        assertThat(new QueryWrapperX<Object>().inIfPresent("id", List.<Integer>of()).getTargetSql())
                .as("空集合不拼接").isEmpty();
        assertThat(new QueryWrapperX<Object>().inIfPresent("id", (Collection<Integer>) null).getTargetSql())
                .as("null 集合不拼接且不抛错").isEmpty();
    }

    /** 变长参数版 in 条件在数组为空时跳过，非空时按原值拼接。 */
    @Test
    void inIfPresentVarargsSkipsEmptyArray() {
        QueryWrapperX<Object> withValues = new QueryWrapperX<>();
        assertThat(withValues.inIfPresent("id", 1, 2)).isSameAs(withValues);
        assertThat(withValues.getTargetSql()).contains("id IN");

        assertThat(new QueryWrapperX<Object>().inIfPresent("id").getTargetSql())
                .as("无变长参数时不拼接").isEmpty();
    }

    /** eq / ne 条件只跳过 null，空串按真实值参与拼接。 */
    @Test
    void eqAndNeIfPresentSkipNullOnly() {
        QueryWrapperX<Object> eqWrapper = new QueryWrapperX<>();
        assertThat(eqWrapper.eqIfPresent("name", "DUMMY-NAME")).isSameAs(eqWrapper);
        assertThat(eqWrapper.getTargetSql()).contains("name =");
        assertThat(new QueryWrapperX<Object>().eqIfPresent("name", "").getTargetSql())
                .as("空串是有效值，必须拼接").contains("name =");
        assertThat(new QueryWrapperX<Object>().eqIfPresent("name", null).getTargetSql()).as("null 跳过").isEmpty();

        QueryWrapperX<Object> neWrapper = new QueryWrapperX<>();
        assertThat(neWrapper.neIfPresent("name", "DUMMY-NAME")).isSameAs(neWrapper);
        assertThat(neWrapper.getTargetSql()).contains("name <>");
        assertThat(new QueryWrapperX<Object>().neIfPresent("name", null).getTargetSql()).as("null 跳过").isEmpty();
    }

    /** 比较类条件只跳过 null，并按各自运算符拼接。 */
    @Test
    void comparisonIfPresentSkipNullOnly() {
        assertThat(new QueryWrapperX<Object>().gtIfPresent("age", 18).getTargetSql()).contains("age >");
        assertThat(new QueryWrapperX<Object>().geIfPresent("age", 18).getTargetSql()).contains("age >=");
        assertThat(new QueryWrapperX<Object>().ltIfPresent("age", 18).getTargetSql()).contains("age <");
        assertThat(new QueryWrapperX<Object>().leIfPresent("age", 18).getTargetSql()).contains("age <=");

        assertThat(new QueryWrapperX<Object>().gtIfPresent("age", null).getTargetSql()).isEmpty();
        assertThat(new QueryWrapperX<Object>().geIfPresent("age", null).getTargetSql()).isEmpty();
        assertThat(new QueryWrapperX<Object>().ltIfPresent("age", null).getTargetSql()).isEmpty();
        assertThat(new QueryWrapperX<Object>().leIfPresent("age", null).getTargetSql()).isEmpty();
        assertThat(new QueryWrapperX<Object>().gtIfPresent("age", 0).getTargetSql())
                .as("数值 0 是有效边界值，不得被当成空值").contains("age >");
    }

    /**
     * 区间条件的三种降级形态。
     *
     * <p>两端都有值时用 BETWEEN；只给左端退化为大于等于；只给右端退化为小于等于；
     * 两端都缺省时不产生任何条件。</p>
     */
    @Test
    void betweenIfPresentDegradesByMissingBound() {
        assertThat(new QueryWrapperX<Object>().betweenIfPresent("age", 18, 30).getTargetSql()).contains("age BETWEEN");
        assertThat(new QueryWrapperX<Object>().betweenIfPresent("age", 18, null).getTargetSql()).contains("age >=");
        assertThat(new QueryWrapperX<Object>().betweenIfPresent("age", null, 30).getTargetSql()).contains("age <=");
        assertThat(new QueryWrapperX<Object>().betweenIfPresent("age", null, null).getTargetSql()).isEmpty();
    }

    /**
     * 数组版区间条件按数组内容降级，空数组与 null 数组都视为无值。
     *
     * <p>该重载直接下标读取 {@code values[1]}：长度为 1 的数组会抛
     * {@link ArrayIndexOutOfBoundsException}，这是当前实现的可观察行为，属已发现的健壮性缺陷，
     * 本用例锁定现状以便修复时能看到契约变化，不代表该行为合理。</p>
     */
    @Test
    void betweenIfPresentArrayHandlesBoundsAndSingleElementDefect() {
        assertThat(new QueryWrapperX<Object>().betweenIfPresent("age", new Object[]{18, 30}).getTargetSql())
                .contains("age BETWEEN");
        assertThat(new QueryWrapperX<Object>().betweenIfPresent("age", new Object[]{18, null}).getTargetSql())
                .contains("age >=");
        assertThat(new QueryWrapperX<Object>().betweenIfPresent("age", new Object[]{null, 30}).getTargetSql())
                .contains("age <=");
        assertThat(new QueryWrapperX<Object>().betweenIfPresent("age", new Object[0]).getTargetSql()).isEmpty();
        assertThat(new QueryWrapperX<Object>().betweenIfPresent("age", (Object[]) null).getTargetSql()).isEmpty();

        assertThatThrownBy(() -> new QueryWrapperX<Object>().betweenIfPresent("age", new Object[]{18}))
                .as("单元素数组缺少 values[1]，当前实现直接下标越界")
                .isInstanceOf(ArrayIndexOutOfBoundsException.class);
    }

    /** 重写的父类链式方法必须返回当前包装器，并把条件真实拼进 SQL。 */
    @Test
    void fluentOverridesReturnSameWrapperAndAppendConditions() {
        QueryWrapperX<Object> wrapper = new QueryWrapperX<>();
        assertThat(wrapper.eq(true, "name", "DUMMY-NAME")).isSameAs(wrapper);
        assertThat(wrapper.eq(false, "age", 18)).as("condition=false 时不拼接但仍返回自身").isSameAs(wrapper);
        assertThat(wrapper.eq("code", "DUMMY-CODE")).isSameAs(wrapper);
        assertThat(wrapper.in("id", List.of(1, 2))).isSameAs(wrapper);
        assertThat(wrapper.orderByDesc("create_time")).isSameAs(wrapper);
        assertThat(wrapper.last("LIMIT 1")).isSameAs(wrapper);

        String sql = wrapper.getTargetSql();
        assertThat(sql).contains("name =").contains("code =").contains("id IN")
                .contains("ORDER BY create_time DESC").contains("LIMIT 1");
        assertThat(sql).as("condition=false 的条件不得出现在 SQL 中").doesNotContain("age");
    }

    /** limitN 必须按当前连接的数据库方言生成限制语法。 */
    @Test
    void limitNGeneratesDialectSpecificSyntax() throws SQLException {
        installDatabaseProductName("MySQL");
        assertThat(new QueryWrapperX<Object>().limitN(5).getTargetSql()).as("MySQL 走 LIMIT").contains("LIMIT 5");

        installDatabaseProductName("Oracle");
        assertThat(new QueryWrapperX<Object>().limitN(5).getTargetSql())
                .as("Oracle 走 ROWNUM 条件").contains("ROWNUM <=");

        installDatabaseProductName("Microsoft SQL Server");
        assertThat(new QueryWrapperX<Object>().limitN(5).getSqlSelect())
                .as("SQL Server 只能靠 SELECT TOP 限制条数").isEqualTo("TOP 5 *");
    }

    /**
     * 用替身数据源把容器内的数据库产品名固定为指定值。
     *
     * <p>Data Source/Connection/Metadata 属进程外边界，这里只控制"读到的产品名"，
     * 让 {@code JdbcUtils.getDbType()} 与 {@code DbTypeEnum.find} 走真实判定逻辑。</p>
     *
     * @param productName JDBC 元数据报告的产品名，例如 MySQL、Oracle、Microsoft SQL Server
     * @throws SQLException 替身桩设置失败时抛出，表示测试夹具本身不可用
     */
    private void installDatabaseProductName(String productName) throws SQLException {
        if (context != null) {
            context.close();
        }
        DataSource dataSource = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        DatabaseMetaData metaData = mock(DatabaseMetaData.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.getMetaData()).thenReturn(metaData);
        when(metaData.getDatabaseProductName()).thenReturn(productName);
        context = new AnnotationConfigApplicationContext();
        context.registerBean(DataSource.class, () -> dataSource);
        context.refresh();
        new SpringUtils().setApplicationContext(context);
    }

}
