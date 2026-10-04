package com.basicframework.framework.mybatis.core.util;

import com.basicframework.framework.common.pojo.PageParam;
import com.basicframework.framework.common.pojo.SortingField;
import com.basicframework.framework.common.util.spring.SpringUtils;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.InnerInterceptor;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import net.sf.jsqlparser.expression.Alias;
import net.sf.jsqlparser.schema.Column;
import net.sf.jsqlparser.schema.Table;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.SQLException;
import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 验证 MyBatis 工具类的分页构建、排序注入、方言 SQL 与元信息读取契约。
 *
 * <p>这些方法是所有 Mapper 查询的公共拼装入口：分页参数决定返回的数据范围，排序字段与列名拼装是
 * SQL 注入防线的一部分，方言模板决定跨库部署时语句是否可执行。因此覆盖正常值、关键空值、
 * 非法字段与不支持的包装器四类输入，并逐条断言生成结果。</p>
 *
 * <p>方言判定依赖当前连接元数据，本用例只在数据源这一进程外边界使用替身，真实连接元数据读取
 * 由 {@code JdbcUtilsTest} 用隔离 MySQL 覆盖。结束时会还原进入用例前的 Spring 静态上下文。</p>
 *
 * @author shady2713
 */
class MyBatisUtilsTest {

    /** 进入用例前的静态 Spring 上下文，结束后原样恢复，避免污染同 JVM 其它测试。 */
    private ApplicationContext previousContext;
    /** 本用例创建的数据源容器，结束时关闭。 */
    private AnnotationConfigApplicationContext context;

    /** 排序字段解析用的探针类型，只用于方法引用取字段名。 */
    static class SortingProbe {

        /** 驼峰命名的实例字段，用于验证方法引用到列名的转换。 */
        private LocalDateTime createTime;

        /** @return 创建时间字段 */
        public LocalDateTime getCreateTime() {
            return createTime;
        }

        /** @param createTime 创建时间字段 */
        public void setCreateTime(LocalDateTime createTime) {
            this.createTime = createTime;
        }

    }

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

    /** 单参 buildPage 必须与无排序字段的构建结果一致：页码、条数原样带入且不生成排序。 */
    @Test
    void buildPageWithoutSortingKeepsPageParamOnly() {
        PageParam pageParam = new PageParam();
        pageParam.setPageNo(2);
        pageParam.setPageSize(20);

        Page<SortingProbe> page = MyBatisUtils.buildPage(pageParam);

        assertThat(page.getCurrent()).isEqualTo(2);
        assertThat(page.getSize()).isEqualTo(20);
        assertThat(page.orders()).isEmpty();
        assertThat(page.optimizeJoinOfCountSql()).as("关联查询的 count 优化必须关闭").isFalse();
    }

    /** 排序字段必须转成下划线列名，并按 asc/desc 生成真实排序项。 */
    @Test
    void buildPageConvertsSortingFieldsToUnderlineColumns() {
        PageParam pageParam = new PageParam();
        pageParam.setPageNo(1);
        pageParam.setPageSize(10);

        Page<SortingProbe> page = MyBatisUtils.buildPage(pageParam, List.of(
                new SortingField("createTime", SortingField.ORDER_ASC),
                new SortingField("id", SortingField.ORDER_DESC)));

        assertThat(page.orders()).hasSize(2);
        assertThat(page.orders().get(0).getColumn()).isEqualTo("create_time");
        assertThat(page.orders().get(0).isAsc()).isTrue();
        assertThat(page.orders().get(1).getColumn()).isEqualTo("id");
        assertThat(page.orders().get(1).isAsc()).isFalse();
    }

    /** 空排序集合不生成排序项，保持与未传排序一致。 */
    @Test
    void buildPageSkipsEmptySortingFields() {
        PageParam pageParam = new PageParam();
        pageParam.setPageNo(1);
        pageParam.setPageSize(10);

        assertThat(MyBatisUtils.buildPage(pageParam, Collections.emptyList()).orders()).isEmpty();
    }

    /**
     * 非法排序字段必须在构建分页时显式拒绝，不能把原始串拼进 SQL。
     *
     * <p>这是排序注入的拦截点：字段名含空格、引号或分号都必须在到达数据库前失败。</p>
     */
    @Test
    void buildPageRejectsIllegalSortingField() {
        PageParam pageParam = new PageParam();
        pageParam.setPageNo(1);
        pageParam.setPageSize(10);

        assertThatThrownBy(() -> MyBatisUtils.buildPage(pageParam,
                List.of(new SortingField("create_time; DROP TABLE x", SortingField.ORDER_ASC))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Invalid sorting field");
        assertThatThrownBy(() -> MyBatisUtils.buildPage(pageParam, List.of(new SortingField(null, SortingField.ORDER_ASC))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Invalid sorting field");
        assertThatThrownBy(() -> MyBatisUtils.buildPage(pageParam, List.of(new SortingField("", SortingField.ORDER_ASC))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Invalid sorting field");
    }

    /** 非法排序方向必须在构建分页时显式拒绝。 */
    @Test
    void buildPageRejectsIllegalSortingOrder() {
        PageParam pageParam = new PageParam();
        pageParam.setPageNo(1);
        pageParam.setPageSize(10);

        assertThatThrownBy(() -> MyBatisUtils.buildPage(pageParam,
                List.of(new SortingField("create_time", "asc; DELETE"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Invalid sorting order");
        assertThatThrownBy(() -> MyBatisUtils.buildPage(pageParam, List.of(new SortingField("create_time", null))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Invalid sorting order");
    }

    /**
     * QueryWrapper 版排序按字段顺序追加 ORDER BY，并把列名转成下划线命名。
     *
     * <p>方向判定用 {@code ORDER_ASC.equals(order)}：大写 {@code ASC} 会被当成降序，
     * 与 LambdaQueryWrapper 版用 {@code equalsIgnoreCase} 的口径不一致，这里锁定当前真实行为。</p>
     */
    @Test
    void addOrderAppendsQueryWrapperOrderBy() {
        QueryWrapper<SortingProbe> wrapper = new QueryWrapper<>();
        MyBatisUtils.addOrder(wrapper, List.of(
                new SortingField("createTime", SortingField.ORDER_ASC),
                new SortingField("id", SortingField.ORDER_DESC)));

        assertThat(wrapper.getTargetSql()).contains("ORDER BY create_time ASC,id DESC");

        QueryWrapper<SortingProbe> upperCase = new QueryWrapper<>();
        MyBatisUtils.addOrder(upperCase, List.of(new SortingField("createTime", "ASC")));
        assertThat(upperCase.getTargetSql()).as("大写 ASC 在当前实现下被排成降序")
                .contains("ORDER BY create_time DESC");
    }

    /**
     * LambdaQueryWrapper 版排序通过 last 拼接 ORDER BY，行为与字符串版一致但大小写口径更宽松。
     *
     * <p>大小写差异是已记录的既有不一致：字符串版把大写 {@code ASC} 当降序，
     * 方法引用版按 {@code equalsIgnoreCase} 判成升序；两处都必须保持真实可观察结果。</p>
     */
    @Test
    void addOrderAppendsLambdaWrapperOrderBy() {
        LambdaQueryWrapper<SortingProbe> wrapper = new LambdaQueryWrapper<>();
        MyBatisUtils.addOrder(wrapper, List.of(
                new SortingField("createTime", SortingField.ORDER_ASC),
                new SortingField("id", SortingField.ORDER_DESC)));

        assertThat(wrapper.getTargetSql()).contains("ORDER BY create_time ASC, id DESC");

        LambdaQueryWrapper<SortingProbe> upperCase = new LambdaQueryWrapper<>();
        MyBatisUtils.addOrder(upperCase, List.of(new SortingField("createTime", "ASC")));
        assertThat(upperCase.getTargetSql()).as("方法引用版按忽略大小写判定为升序")
                .contains("ORDER BY create_time ASC");
    }

    /** 空排序集合直接返回，不做任何拼接也不校验包装器类型。 */
    @Test
    void addOrderIgnoresEmptySortingFields() {
        MyBatisUtils.addOrder(new QueryWrapper<>(), Collections.emptyList());
        MyBatisUtils.addOrder(new QueryWrapper<>(), null);
        MyBatisUtils.addOrder(new UpdateWrapper<>(), Collections.emptyList());

        QueryWrapper<SortingProbe> wrapper = new QueryWrapper<>();
        MyBatisUtils.addOrder(wrapper, Collections.emptyList());
        assertThat(wrapper.getTargetSql()).isEmpty();
    }

    /** 不支持的包装器类型必须显式报错并带上实际类型名，避免排序被静默丢弃。 */
    @Test
    void addOrderRejectsUnsupportedWrapperType() {
        UpdateWrapper<SortingProbe> wrapper = new UpdateWrapper<>();
        assertThatThrownBy(() -> MyBatisUtils.addOrder(wrapper, List.of(new SortingField("create_time", "asc"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Unsupported wrapper type")
                .hasMessageContaining(UpdateWrapper.class.getName());
    }

    /** 拦截器按下标插入到链中，插入位置必须精确。 */
    @Test
    void addInterceptorInsertsAtIndex() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        InnerInterceptor first = mock(InnerInterceptor.class);
        InnerInterceptor second = mock(InnerInterceptor.class);
        InnerInterceptor third = mock(InnerInterceptor.class);

        MyBatisUtils.addInterceptor(interceptor, first, 0);
        MyBatisUtils.addInterceptor(interceptor, second, 0);
        MyBatisUtils.addInterceptor(interceptor, third, 1);

        assertThat(interceptor.getInterceptors()).containsExactly(second, third, first);
    }

    /** 表名必须去掉 MySQL 转义反引号，普通表名原样返回。 */
    @Test
    void getTableNameStripsMysqlEscapeCharacters() {
        assertThat(MyBatisUtils.getTableName(new Table("`t_xxx`"))).isEqualTo("t_xxx");
        assertThat(MyBatisUtils.getTableName(new Table("t_xxx"))).isEqualTo("t_xxx");
        assertThat(MyBatisUtils.getTableName(new Table("`t_xxx"))).as("只有一侧有反引号时不得截断表名")
                .isEqualTo("`t_xxx");
    }

    /** 列对象按"表名.字段名"构建，存在别名时必须改用别名限定。 */
    @Test
    void buildColumnPrefersTableAlias() {
        Column withoutAlias = MyBatisUtils.buildColumn("t_xxx", null, "dept_id");
        assertThat(withoutAlias.getFullyQualifiedName()).isEqualTo("t_xxx.dept_id");

        Column withAlias = MyBatisUtils.buildColumn("t_xxx", new Alias("u"), "dept_id");
        assertThat(withAlias.getFullyQualifiedName()).isEqualTo("u.dept_id");

        Column withNullColumn = MyBatisUtils.buildColumn("t_xxx", null, null);
        assertThat(withNullColumn.getFullyQualifiedName())
                .as("字段名为 null 时按字符串拼接成非法标识符 t_xxx.null，当前实现不校验")
                .isEqualTo("t_xxx.null");
    }

    /** findInSet 必须按方言生成模板，未支持的方言与 null 值都要显式失败或按契约转字符串。 */
    @Test
    void findInSetUsesDialectTemplate() throws SQLException {
        installDatabaseProductName("MySQL");
        assertThat(MyBatisUtils.findInSet("dept_id", 1)).isEqualTo("FIND_IN_SET('1', dept_id) <> 0");

        installDatabaseProductName("PostgreSQL");
        assertThat(MyBatisUtils.findInSet("dept_id", 1)).isEqualTo("POSITION('1' IN dept_id) <> 0");

        installDatabaseProductName("MySQL");
        assertThat(MyBatisUtils.findInSet("dept_id", null)).as("null 值按字符串 null 拼接")
                .isEqualTo("FIND_IN_SET('null', dept_id) <> 0");

        installDatabaseProductName("H2");
        assertThatThrownBy(() -> MyBatisUtils.findInSet("dept_id", 1))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("数据库类型不支持 FIND_IN_SET: H2");
    }

    /** 方法引用必须转成下划线列名，已经带下划线的字段保持不变。 */
    @Test
    void toUnderlineCaseConvertsCamelFieldName() {
        assertThat(MyBatisUtils.toUnderlineCase(SortingProbe::getCreateTime)).isEqualTo("create_time");
    }

    /**
     * 工具类未声明私有构造，实例化不得改变静态入口行为。
     *
     * <p>该类没有实例状态，构造方法属于真实可调用面；断言实例化后静态入口仍按同一规则工作，
     * 防止未来把共享状态放进实例导致两条路径读到不同结果。</p>
     */
    @Test
    void instantiationKeepsStaticEntryBehaviour() {
        new MyBatisUtils();

        assertThat(MyBatisUtils.getTableName(new Table("`t_xxx`"))).isEqualTo("t_xxx");
        assertThat(MyBatisUtils.toUnderlineCase(SortingProbe::getCreateTime)).isEqualTo("create_time");
    }

    /**
     * 用替身数据源把容器内的数据库产品名固定为指定值。
     *
     * <p>数据源、连接与元数据属进程外边界，这里只控制"读到的产品名"，
     * 让 {@code JdbcUtils.getDbType()} 与 {@code DbTypeEnum} 走真实判定逻辑。</p>
     *
     * @param productName JDBC 元数据报告的产品名
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
