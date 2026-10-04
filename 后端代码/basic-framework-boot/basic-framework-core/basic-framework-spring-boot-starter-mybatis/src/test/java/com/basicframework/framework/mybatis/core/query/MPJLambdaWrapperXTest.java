package com.basicframework.framework.mybatis.core.query;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import lombok.Data;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.Collection;
import java.util.List;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * 验证 {@link MPJLambdaWrapperX} 的条件拼接、投影与连表扩展契约。
 *
 * <p>该类是 MyBatis Plus Join 的框架扩展，唯一职责是"按调用参数生成 SQL 片段并保持链式类型"：
 * {@code xxxIfPresent} 系列必须在参数无效时完全不拼条件（否则列表页会把 null 当成空串参与过滤），
 * 重写的方法必须返回扩展类型本身（否则链式调用会在 {@code MPJLambdaWrapper} 处丢失 {@code xxxIfPresent}
 * 能力）。因此断言直接落在包装器实际生成的 SQL 文本与返回对象身份上，而不是内部字段。</p>
 *
 * <p>本类不连接数据库：被验证的是 SQL 生成契约，SQL 的语义正确性由真实连表查询用例
 * （{@code BaseMapperXMySqlIT}）与业务 Mapper 用例覆盖。实体元数据通过 MyBatis Plus 的
 * {@code TableInfoHelper} 显式注册，避免测试依赖运行期 Mapper 扫描。</p>
 *
 * @author shady2713
 */
class MPJLambdaWrapperXTest {

    /** 注册两个探针实体的表元数据，让连表与列名渲染不依赖运行期 Mapper 扫描。 */
    @BeforeAll
    static void registerEntityMetadata() {
        MapperBuilderAssistant assistant = new MapperBuilderAssistant(new MybatisConfiguration(), "");
        assertThat(TableInfoHelper.initTableInfo(assistant, ProbeUser.class)).isNotNull();
        assertThat(TableInfoHelper.initTableInfo(assistant, ProbeDept.class)).isNotNull();
        assertThat(TableInfoHelper.initTableInfo(assistant, ProbeUserView.class)).isNotNull();
    }

    /** 文本条件为空或空白时不得拼接 LIKE，有文本时必须按 LIKE 拼接。 */
    @Test
    void likeIfPresentOnlyAppendsConditionForText() {
        MPJLambdaWrapperX<ProbeUser> blank = wrapper();
        assertThat(blank.likeIfPresent(ProbeUser::getName, "  ")).isSameAs(blank);
        assertThat(blank.getTargetSql()).as("空白文本不得参与 LIKE").doesNotContain("LIKE");

        MPJLambdaWrapperX<ProbeUser> present = wrapper();
        assertThat(present.likeIfPresent(ProbeUser::getName, "alpha")).isSameAs(present);
        assertThat(present.getTargetSql()).contains("name").contains("LIKE");
    }

    /**
     * 集合条件为空时必须完全不拼 IN，非空集合必须拼出 IN 条件。
     *
     * <p>集合重载与变长参数重载在实参为裸 {@code null} 或空参数时存在二义性，
     * 调用方必须显式声明 {@code Collection} 类型；用例按可编译的真实调用方式覆盖空集合分支。</p>
     */
    @Test
    void inIfPresentCollectionOnlyAppendsConditionForNonEmptyValues() {
        Collection<Long> noValues = null;
        MPJLambdaWrapperX<ProbeUser> empty = wrapper();
        assertThat(empty.inIfPresent(ProbeUser::getId, List.of())).isSameAs(empty);
        assertThat(empty.inIfPresent(ProbeUser::getId, noValues)).isSameAs(empty);
        assertThat(empty.getTargetSql()).as("空集合不得拼出 IN 条件").doesNotContain("IN");

        MPJLambdaWrapperX<ProbeUser> present = wrapper();
        assertThat(present.inIfPresent(ProbeUser::getId, List.of(1L, 2L))).isSameAs(present);
        assertThat(present.getTargetSql()).contains("IN").contains("id");
    }

    /** 变长参数条件为空时必须完全不拼 IN，有元素时必须拼出 IN 条件。 */
    @Test
    void inIfPresentVarargsOnlyAppendsConditionForNonEmptyValues() {
        MPJLambdaWrapperX<ProbeUser> empty = wrapper();
        assertThat(empty.inIfPresent(ProbeUser::getId, new Object[0])).isSameAs(empty);
        assertThat(empty.getTargetSql()).doesNotContain("IN");

        MPJLambdaWrapperX<ProbeUser> present = wrapper();
        assertThat(present.inIfPresent(ProbeUser::getId, 1L, 2L)).isSameAs(present);
        assertThat(present.getTargetSql()).contains("IN").contains("id");
    }

    /** 等值与不等条件只接受非空参数，null 必须被忽略。 */
    @Test
    void eqAndNeIfPresentIgnoreNullValues() {
        MPJLambdaWrapperX<ProbeUser> eqWrapper = wrapper();
        assertThat(eqWrapper.eqIfPresent(ProbeUser::getName, "alpha")).isSameAs(eqWrapper);
        assertThat(eqWrapper.getTargetSql()).contains("name").contains("=");
        MPJLambdaWrapperX<ProbeUser> eqNull = wrapper();
        assertThat(eqNull.eqIfPresent(ProbeUser::getName, null)).isSameAs(eqNull);
        assertThat(eqNull.getTargetSql()).isEmpty();

        MPJLambdaWrapperX<ProbeUser> neWrapper = wrapper();
        assertThat(neWrapper.neIfPresent(ProbeUser::getName, "alpha")).isSameAs(neWrapper);
        assertThat(neWrapper.getTargetSql()).contains("name").contains("<>");
        MPJLambdaWrapperX<ProbeUser> neNull = wrapper();
        assertThat(neNull.neIfPresent(ProbeUser::getName, null)).isSameAs(neNull);
        assertThat(neNull.getTargetSql()).isEmpty();
    }

    /** 四种范围条件只接受非空参数，null 必须被忽略且不产生任何比较符号。 */
    @Test
    void rangeIfPresentMethodsIgnoreNullValues() {
        MPJLambdaWrapperX<ProbeUser> gtWrapper = wrapper();
        assertThat(gtWrapper.gtIfPresent(ProbeUser::getId, 1L)).isSameAs(gtWrapper);
        assertThat(gtWrapper.getTargetSql()).contains(">");
        MPJLambdaWrapperX<ProbeUser> geWrapper = wrapper();
        assertThat(geWrapper.geIfPresent(ProbeUser::getId, 1L)).isSameAs(geWrapper);
        assertThat(geWrapper.getTargetSql()).contains(">=");
        MPJLambdaWrapperX<ProbeUser> ltWrapper = wrapper();
        assertThat(ltWrapper.ltIfPresent(ProbeUser::getId, 1L)).isSameAs(ltWrapper);
        assertThat(ltWrapper.getTargetSql()).contains("<");
        MPJLambdaWrapperX<ProbeUser> leWrapper = wrapper();
        assertThat(leWrapper.leIfPresent(ProbeUser::getId, 1L)).isSameAs(leWrapper);
        assertThat(leWrapper.getTargetSql()).contains("<=");

        MPJLambdaWrapperX<ProbeUser> none = wrapper();
        assertThat(none.gtIfPresent(ProbeUser::getId, null)).isSameAs(none);
        assertThat(none.geIfPresent(ProbeUser::getId, null)).isSameAs(none);
        assertThat(none.ltIfPresent(ProbeUser::getId, null)).isSameAs(none);
        assertThat(none.leIfPresent(ProbeUser::getId, null)).isSameAs(none);
        assertThat(none.getTargetSql()).as("全部为 null 时不得产生条件").isEmpty();
    }

    /** 数组区间条件必须按元素个数退化为 BETWEEN、单边范围或不拼条件。 */
    @Test
    void betweenIfPresentArrayHandlesMissingBounds() {
        MPJLambdaWrapperX<ProbeUser> both = wrapper();
        assertThat(both.betweenIfPresent(ProbeUser::getId, new Object[] {1L, 9L})).isSameAs(both);
        assertThat(both.getTargetSql()).contains("BETWEEN");

        MPJLambdaWrapperX<ProbeUser> lowerOnly = wrapper();
        assertThat(lowerOnly.betweenIfPresent(ProbeUser::getId, new Object[] {1L})).isSameAs(lowerOnly);
        assertThat(lowerOnly.getTargetSql()).contains(">=").doesNotContain("BETWEEN");

        MPJLambdaWrapperX<ProbeUser> empty = wrapper();
        assertThat(empty.betweenIfPresent(ProbeUser::getId, null)).isSameAs(empty);
        assertThat(empty.getTargetSql()).as("数组缺失时不得拼出区间条件").isEmpty();
    }

    /** 双参数区间条件必须覆盖双边界、仅下界、仅上界与都为空四种分支。 */
    @Test
    void betweenIfPresentObjectsFallsBackToSingleBound() {
        MPJLambdaWrapperX<ProbeUser> both = wrapper();
        assertThat(both.betweenIfPresent(ProbeUser::getId, 1L, 9L)).isSameAs(both);
        assertThat(both.getTargetSql()).contains("BETWEEN");

        MPJLambdaWrapperX<ProbeUser> lowerOnly = wrapper();
        assertThat(lowerOnly.betweenIfPresent(ProbeUser::getId, 1L, null)).isSameAs(lowerOnly);
        assertThat(lowerOnly.getTargetSql()).contains(">=").doesNotContain("BETWEEN");

        MPJLambdaWrapperX<ProbeUser> upperOnly = wrapper();
        assertThat(upperOnly.betweenIfPresent(ProbeUser::getId, null, 9L)).isSameAs(upperOnly);
        assertThat(upperOnly.getTargetSql()).contains("<=").doesNotContain("BETWEEN");

        MPJLambdaWrapperX<ProbeUser> none = wrapper();
        assertThat(none.betweenIfPresent(ProbeUser::getId, null, null)).isSameAs(none);
        assertThat(none.getTargetSql()).isEmpty();
    }

    /** 等值、排序、尾部 SQL 与集合范围的重写方法必须返回扩展类型本身并真实生效。 */
    @Test
    void comparisonAndOrderOverridesReturnExtensionType() {
        MPJLambdaWrapperX<ProbeUser> conditional = newWrapper();
        assertThat(conditional.eq(false, ProbeUser::getName, "alpha")).isSameAs(conditional);
        assertThat(conditional.getTargetSql()).as("条件为 false 时不得拼接").isEmpty();
        assertThat(conditional.eq(true, ProbeUser::getName, "alpha")).isSameAs(conditional);
        assertThat(conditional.getTargetSql()).contains("name").contains("=");

        MPJLambdaWrapperX<ProbeUser> plain = newWrapper();
        assertThat(plain.eq(ProbeUser::getDeptId, 10L)).isSameAs(plain);
        assertThat(plain.getTargetSql()).contains("dept_id").contains("=");

        MPJLambdaWrapperX<ProbeUser> ordered = newWrapper();
        assertThat(ordered.orderByDesc(ProbeUser::getName)).isSameAs(ordered);
        assertThat(ordered.orderByAsc(ProbeUser::getId)).isSameAs(ordered);
        assertThat(ordered.getTargetSql()).contains("ORDER BY").contains("DESC").contains("ASC");

        MPJLambdaWrapperX<ProbeUser> tail = newWrapper();
        assertThat(tail.last("LIMIT 1")).isSameAs(tail);
        assertThat(tail.getTargetSql()).contains("LIMIT 1");

        MPJLambdaWrapperX<ProbeUser> inWrapper = newWrapper();
        assertThat(inWrapper.in(ProbeUser::getId, List.of(1L, 2L))).isSameAs(inWrapper);
        assertThat(inWrapper.getTargetSql()).contains("IN").contains("id");
    }

    /** 查询列重写方法必须返回扩展类型本身，并把列与别名真实写入 SELECT 片段。 */
    @Test
    void selectProjectionOverridesReturnExtensionType() {
        MPJLambdaWrapperX<ProbeUser> all = new MPJLambdaWrapperX<>();
        assertThat(all.selectAll(ProbeUser.class)).isSameAs(all);
        assertThat(all.getSqlSelect()).contains("name").contains("dept_id");

        MPJLambdaWrapperX<ProbeUser> prefixed = new MPJLambdaWrapperX<>();
        assertThat(prefixed.selectAll(ProbeUser.class, "u")).isSameAs(prefixed);
        assertThat(prefixed.getSqlSelect()).contains("u.");

        MPJLambdaWrapperX<ProbeUser> asString = new MPJLambdaWrapperX<>();
        assertThat(asString.selectAs(ProbeUser::getName, "user_name")).isSameAs(asString);
        assertThat(asString.getSqlSelect()).contains("AS").contains("user_name");

        MPJLambdaWrapperX<ProbeUser> rawColumn = new MPJLambdaWrapperX<>();
        assertThat(rawColumn.selectAs("id", ProbeUser::getDeptId)).isSameAs(rawColumn);
        assertThat(rawColumn.getSqlSelect()).contains("id").contains("AS").contains("deptId");

        MPJLambdaWrapperX<ProbeUser> asFunction = new MPJLambdaWrapperX<>();
        assertThat(asFunction.selectAs(ProbeUser::getName, ProbeUserView::getDeptName)).isSameAs(asFunction);
        assertThat(asFunction.getSqlSelect()).contains("AS").contains("deptName");

        MPJLambdaWrapperX<ProbeUser> indexed = new MPJLambdaWrapperX<>();
        assertThat(indexed.selectAs("1", ProbeUser::getName, ProbeUserView::getDeptName)).isSameAs(indexed);
        assertThat(indexed.getSqlSelect()).contains("AS").contains("deptName");

        MPJLambdaWrapperX<ProbeUser> asClass = new MPJLambdaWrapperX<>();
        assertThat(asClass.selectAsClass(ProbeUser.class, ProbeUserAliasView.class)).isSameAs(asClass);
        // 真实行为：按属性名匹配来源字段并投影其列名，不额外生成 AS 别名；
        // 结果映射依赖列名到属性的下划线转换，因此目标视图属性名必须与来源属性名一致。
        assertThat(asClass.getSqlSelect()).contains("id").contains("name").contains("dept_id")
                .doesNotContain("AS");

        MPJLambdaWrapperX<ProbeUser> sub = new MPJLambdaWrapperX<>();
        assertThat(sub.selectSub(ProbeDept.class, child -> child.selectCount(ProbeDept::getId),
                ProbeUserView::getDeptName)).isSameAs(sub);
        assertThat(sub.getSqlSelect()).contains("SELECT").contains("AS").contains("deptName");

        MPJLambdaWrapperX<ProbeUser> subWithAlias = new MPJLambdaWrapperX<>();
        assertThat(subWithAlias.selectSub(ProbeDept.class, "d", child -> child.selectCount(ProbeDept::getId),
                ProbeUserView::getDeptName)).isSameAs(subWithAlias);
        assertThat(subWithAlias.getSqlSelect()).contains("SELECT").contains("AS").contains("deptName");
    }

    /** 聚合查询列重写方法必须返回扩展类型本身，并写入对应聚合函数。 */
    @Test
    void aggregateOverridesReturnExtensionType() {
        MPJLambdaWrapperX<ProbeUser> count = new MPJLambdaWrapperX<>();
        assertThat(count.selectCount(ProbeUser::getId)).isSameAs(count);
        assertThat(count.getSqlSelect()).contains("COUNT(");
        MPJLambdaWrapperX<ProbeUser> countWithRawAlias = new MPJLambdaWrapperX<>();
        assertThat(countWithRawAlias.selectCount("id", "total")).isSameAs(countWithRawAlias);
        assertThat(countWithRawAlias.getSqlSelect()).contains("COUNT(").contains("total");
        MPJLambdaWrapperX<ProbeUser> countWithFunctionAlias = new MPJLambdaWrapperX<>();
        assertThat(countWithFunctionAlias.selectCount("id", ProbeUserView::getDeptName)).isSameAs(countWithFunctionAlias);
        assertThat(countWithFunctionAlias.getSqlSelect()).contains("COUNT(").contains("deptName");
        MPJLambdaWrapperX<ProbeUser> countFunctionAndRawAlias = new MPJLambdaWrapperX<>();
        assertThat(countFunctionAndRawAlias.selectCount(ProbeUser::getId, "total")).isSameAs(countFunctionAndRawAlias);
        assertThat(countFunctionAndRawAlias.getSqlSelect()).contains("COUNT(").contains("total");
        MPJLambdaWrapperX<ProbeUser> countFunctionAndFunctionAlias = new MPJLambdaWrapperX<>();
        assertThat(countFunctionAndFunctionAlias.selectCount(ProbeUser::getId, ProbeUserView::getDeptName))
                .isSameAs(countFunctionAndFunctionAlias);
        assertThat(countFunctionAndFunctionAlias.getSqlSelect()).contains("COUNT(").contains("deptName");

        MPJLambdaWrapperX<ProbeUser> sum = new MPJLambdaWrapperX<>();
        assertThat(sum.selectSum(ProbeUser::getId)).isSameAs(sum);
        assertThat(sum.getSqlSelect()).contains("SUM(");
        MPJLambdaWrapperX<ProbeUser> sumWithRawAlias = new MPJLambdaWrapperX<>();
        assertThat(sumWithRawAlias.selectSum(ProbeUser::getId, "total")).isSameAs(sumWithRawAlias);
        assertThat(sumWithRawAlias.getSqlSelect()).contains("SUM(").contains("total");
        MPJLambdaWrapperX<ProbeUser> sumWithFunctionAlias = new MPJLambdaWrapperX<>();
        assertThat(sumWithFunctionAlias.selectSum(ProbeUser::getId, ProbeUserView::getDeptName))
                .isSameAs(sumWithFunctionAlias);
        assertThat(sumWithFunctionAlias.getSqlSelect()).contains("SUM(").contains("deptName");

        MPJLambdaWrapperX<ProbeUser> max = new MPJLambdaWrapperX<>();
        assertThat(max.selectMax(ProbeUser::getId)).isSameAs(max);
        assertThat(max.getSqlSelect()).contains("MAX(");
        MPJLambdaWrapperX<ProbeUser> maxWithRawAlias = new MPJLambdaWrapperX<>();
        assertThat(maxWithRawAlias.selectMax(ProbeUser::getId, "total")).isSameAs(maxWithRawAlias);
        assertThat(maxWithRawAlias.getSqlSelect()).contains("MAX(").contains("total");
        MPJLambdaWrapperX<ProbeUser> maxWithFunctionAlias = new MPJLambdaWrapperX<>();
        assertThat(maxWithFunctionAlias.selectMax(ProbeUser::getId, ProbeUserView::getDeptName))
                .isSameAs(maxWithFunctionAlias);
        assertThat(maxWithFunctionAlias.getSqlSelect()).contains("MAX(").contains("deptName");

        MPJLambdaWrapperX<ProbeUser> min = new MPJLambdaWrapperX<>();
        assertThat(min.selectMin(ProbeUser::getId)).isSameAs(min);
        assertThat(min.getSqlSelect()).contains("MIN(");
        MPJLambdaWrapperX<ProbeUser> minWithRawAlias = new MPJLambdaWrapperX<>();
        assertThat(minWithRawAlias.selectMin(ProbeUser::getId, "total")).isSameAs(minWithRawAlias);
        assertThat(minWithRawAlias.getSqlSelect()).contains("MIN(").contains("total");
        MPJLambdaWrapperX<ProbeUser> minWithFunctionAlias = new MPJLambdaWrapperX<>();
        assertThat(minWithFunctionAlias.selectMin(ProbeUser::getId, ProbeUserView::getDeptName))
                .isSameAs(minWithFunctionAlias);
        assertThat(minWithFunctionAlias.getSqlSelect()).contains("MIN(").contains("deptName");

        MPJLambdaWrapperX<ProbeUser> avg = new MPJLambdaWrapperX<>();
        assertThat(avg.selectAvg(ProbeUser::getId)).isSameAs(avg);
        assertThat(avg.getSqlSelect()).contains("AVG(");
        MPJLambdaWrapperX<ProbeUser> avgWithRawAlias = new MPJLambdaWrapperX<>();
        assertThat(avgWithRawAlias.selectAvg(ProbeUser::getId, "total")).isSameAs(avgWithRawAlias);
        assertThat(avgWithRawAlias.getSqlSelect()).contains("AVG(").contains("total");
        MPJLambdaWrapperX<ProbeUser> avgWithFunctionAlias = new MPJLambdaWrapperX<>();
        assertThat(avgWithFunctionAlias.selectAvg(ProbeUser::getId, ProbeUserView::getDeptName))
                .isSameAs(avgWithFunctionAlias);
        assertThat(avgWithFunctionAlias.getSqlSelect()).contains("AVG(").contains("deptName");

        MPJLambdaWrapperX<ProbeUser> len = new MPJLambdaWrapperX<>();
        assertThat(len.selectLen(ProbeUser::getName)).isSameAs(len);
        assertThat(len.getSqlSelect()).contains("LEN(");
        MPJLambdaWrapperX<ProbeUser> lenWithRawAlias = new MPJLambdaWrapperX<>();
        assertThat(lenWithRawAlias.selectLen(ProbeUser::getName, "total")).isSameAs(lenWithRawAlias);
        assertThat(lenWithRawAlias.getSqlSelect()).contains("LEN(").contains("total");
        MPJLambdaWrapperX<ProbeUser> lenWithFunctionAlias = new MPJLambdaWrapperX<>();
        assertThat(lenWithFunctionAlias.selectLen(ProbeUser::getName, ProbeUserView::getDeptName))
                .isSameAs(lenWithFunctionAlias);
        assertThat(lenWithFunctionAlias.getSqlSelect()).contains("LEN(").contains("deptName");
    }

    /** 三种连表重写方法必须返回扩展类型本身，并把真实连接类型与从表写入 SQL。 */
    @Test
    void joinOverridesReturnExtensionTypeAndRenderJoinClause() {
        MPJLambdaWrapperX<ProbeUser> left = wrapper();
        assertThat(left.leftJoin(ProbeDept.class, ProbeDept::getId, ProbeUser::getDeptId)).isSameAs(left);
        assertThat(sqlText(left)).contains("LEFT JOIN").contains(ProbeDept.TABLE);

        MPJLambdaWrapperX<ProbeUser> right = wrapper();
        assertThat(right.rightJoin(ProbeDept.class, ProbeDept::getId, ProbeUser::getDeptId)).isSameAs(right);
        assertThat(sqlText(right)).contains("RIGHT JOIN").contains(ProbeDept.TABLE);

        MPJLambdaWrapperX<ProbeUser> inner = wrapper();
        assertThat(inner.innerJoin(ProbeDept.class, ProbeDept::getId, ProbeUser::getDeptId)).isSameAs(inner);
        assertThat(sqlText(inner)).contains("INNER JOIN").contains(ProbeDept.TABLE);
    }

    /**
     * 带扩展回调的连表方法必须在回调中补条件；回调为空时必须安全返回而不是抛错。
     *
     * <p>扩展回调的类型是框架自有的 {@code Consumer<MPJLambdaWrapperX<T>>}，与父接口
     * {@code MFunction} 重载在实参为 null 时存在二义性，调用方必须显式声明回调类型；
     * 用例显式声明后验证真实行为，而不是依赖编译器的隐式选择。</p>
     */
    @Test
    void joinWithExtensionConsumerAppliesCallbackOrToleratesNull() {
        Consumer<MPJLambdaWrapperX<ProbeUser>> ext =
                child -> child.eq(ProbeDept::getDeptName, "研发");

        MPJLambdaWrapperX<ProbeUser> applied = wrapper();
        assertThat(applied.leftJoin(ProbeDept.class, ProbeDept::getId, ProbeUser::getDeptId, ext)).isSameAs(applied);
        assertThat(sqlText(applied)).contains("LEFT JOIN").contains("dept_name");

        MPJLambdaWrapperX<ProbeUser> rightApplied = wrapper();
        assertThat(rightApplied.rightJoin(ProbeDept.class, ProbeDept::getId, ProbeUser::getDeptId, ext))
                .isSameAs(rightApplied);
        assertThat(sqlText(rightApplied)).contains("RIGHT JOIN").contains("dept_name");

        MPJLambdaWrapperX<ProbeUser> innerApplied = wrapper();
        assertThat(innerApplied.innerJoin(ProbeDept.class, ProbeDept::getId, ProbeUser::getDeptId, ext))
                .isSameAs(innerApplied);
        assertThat(sqlText(innerApplied)).contains("INNER JOIN").contains("dept_name");

        Consumer<MPJLambdaWrapperX<ProbeUser>> noExtension = null;
        MPJLambdaWrapperX<ProbeUser> nullLeft = wrapper();
        assertThatCode(() -> nullLeft.leftJoin(ProbeDept.class, ProbeDept::getId, ProbeUser::getDeptId, noExtension))
                .doesNotThrowAnyException();
        MPJLambdaWrapperX<ProbeUser> nullRight = wrapper();
        assertThatCode(() -> nullRight.rightJoin(ProbeDept.class, ProbeDept::getId, ProbeUser::getDeptId, noExtension))
                .doesNotThrowAnyException();
        MPJLambdaWrapperX<ProbeUser> nullInner = wrapper();
        assertThatCode(() -> nullInner.innerJoin(ProbeDept.class, ProbeDept::getId, ProbeUser::getDeptId, noExtension))
                .doesNotThrowAnyException();
        assertThat(sqlText(nullLeft)).contains("LEFT JOIN");
    }

    /**
     * 建立只带主表查询列的包装器，让条件断言不受 SELECT 片段影响。
     *
     * @return 已声明主表实体与查询列的包装器
     */
    private MPJLambdaWrapperX<ProbeUser> wrapper() {
        return new MPJLambdaWrapperX<ProbeUser>().selectAll(ProbeUser.class);
    }

    /** 建立未声明查询列的包装器，用于验证重写方法的返回值与投影片段。 */
    private MPJLambdaWrapperX<ProbeUser> newWrapper() {
        return new MPJLambdaWrapperX<>();
    }

    /**
     * 汇总包装器当前可观察的 SQL 片段，供连表断言使用。
     *
     * <p>连表条件可能落在 WHERE/ON 片段或 FROM 片段，断言只关心"连接类型与从表是否出现"，
     * 因此把各公开片段拼接后统一匹配。</p>
     *
     * @param wrapper 目标包装器
     * @return 以竖线分隔的 SQL 片段文本
     */
    private static String sqlText(MPJLambdaWrapperX<ProbeUser> wrapper) {
        return String.join(" | ", nullSafe(wrapper.getSqlSelect()), nullSafe(wrapper.getSqlSegment()),
                nullSafe(wrapper.getFrom()), nullSafe(wrapper.getTargetSql()));
    }

    /** 把可能为 null 的 SQL 片段归一成空串，避免拼接时出现 "null" 影响 contains 断言。 */
    private static String nullSafe(String value) {
        return value == null ? "" : value;
    }

    /**
     * 用户探针实体，字段覆盖列名、别名与聚合目标。
     *
     * @author shady2713
     */
    @Data
    @TableName(ProbeUser.TABLE)
    static class ProbeUser {

        /** 探针表名，供连表 SQL 断言使用。 */
        static final String TABLE = "bf_query_probe_user";

        /** 主键。 */
        @TableId(type = IdType.AUTO)
        private Long id;

        /** 用户名，用于文本与范围条件。 */
        private String name;

        /** 部门编号，用于连表关联列。 */
        private Long deptId;

    }

    /**
     * 部门探针实体，作为连表与子查询的从表。
     *
     * @author shady2713
     */
    @Data
    @TableName(ProbeDept.TABLE)
    static class ProbeDept {

        /** 探针表名，供连表 SQL 断言使用。 */
        static final String TABLE = "bf_query_probe_dept";

        /** 主键，与用户表的部门编号关联。 */
        @TableId(type = IdType.AUTO)
        private Long id;

        /** 部门名称，用于连表扩展条件。 */
        private String deptName;

    }

    /**
     * 别名探针视图：字段名与来源实体属性一致，用于验证列名与属性名不同时必须生成别名。
     *
     * @author shady2713
     */
    @Data
    static class ProbeUserAliasView {

        /** 用户主键，列名与属性名一致。 */
        private Long id;

        /** 用户名，列名与属性名一致。 */
        private String name;

        /** 部门编号，列名为 dept_id，与属性名不同，必须生成别名。 */
        private Long deptId;

    }

    /**
     * 展示用探针视图，字段名与用户/部门列名对齐，用于验证列映射与别名。
     *
     * @author shady2713
     */
    @Data
    static class ProbeUserView {

        /** 用户主键。 */
        private Long id;

        /** 用户名。 */
        private String name;

        /** 部门名称，来自连表或子查询。 */
        @TableField(exist = false)
        private String deptName;

    }

}
