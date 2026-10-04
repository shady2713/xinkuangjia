package com.basicframework.framework.mybatis.core.query;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 {@link LambdaQueryWrapperX} 基于方法引用的"值存在才拼接"条件契约。
 *
 * <p>与字符串列名版不同，本类通过 {@code SFunction} 解析实体字段到列名：解析依赖 MyBatis-Plus 的
 * 实体元信息缓存，因此用例先按生产启动路径注册实体表信息，再断言生成条件使用的**列名**与条件本身。
 * 列名映射错误会静默查询到别的列，是本层最危险的失败形态。</p>
 *
 * @author shady2713
 */
class LambdaQueryWrapperXTest {

    /** 用例内的探针实体，字段覆盖列名映射需要的驼峰场景。 */
    @TableName("bf_lambda_probe")
    static class LambdaProbeEntity {

        /** 主键，用于确认元信息注册成功。 */
        @TableId(type = IdType.AUTO)
        private Long id;

        /** 文本字段，映射列 {@code name}。 */
        private String name;

        /** 数值字段，映射列 {@code age}。 */
        private Integer age;

        /** 驼峰字段，映射列 {@code create_time}。 */
        private LocalDateTime createTime;

        /** @return 主键 */
        public Long getId() {
            return id;
        }

        /** @param id 主键 */
        public void setId(Long id) {
            this.id = id;
        }

        /** @return 文本字段 */
        public String getName() {
            return name;
        }

        /** @param name 文本字段 */
        public void setName(String name) {
            this.name = name;
        }

        /** @return 数值字段 */
        public Integer getAge() {
            return age;
        }

        /** @param age 数值字段 */
        public void setAge(Integer age) {
            this.age = age;
        }

        /** @return 创建时间字段 */
        public LocalDateTime getCreateTime() {
            return createTime;
        }

        /** @param createTime 创建时间字段 */
        public void setCreateTime(LocalDateTime createTime) {
            this.createTime = createTime;
        }

    }

    /**
     * 按生产启动路径注册探针实体的表信息，使方法引用能解析出列名。
     *
     * <p>缓存按类全局共享，只需注册一次；这也是 MyBatis-Plus 真实启动时
     * {@code TableInfoHelper} 建立映射的同一条路径。</p>
     */
    @BeforeAll
    static void registerTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), LambdaProbeEntity.class);
    }

    /** like 条件只在文本有效时拼接，并解析为真实列名。 */
    @Test
    void likeIfPresentAppendsOnlyForText() {
        LambdaQueryWrapperX<LambdaProbeEntity> wrapper = new LambdaQueryWrapperX<>();
        assertThat(wrapper.likeIfPresent(LambdaProbeEntity::getName, "DUMMY-NAME"))
                .as("必须返回当前包装器以支持链式调用").isSameAs(wrapper);
        assertThat(wrapper.getTargetSql()).contains("name LIKE");

        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>().likeIfPresent(LambdaProbeEntity::getName, " ").getTargetSql())
                .as("空白串不拼接").isEmpty();
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>().likeIfPresent(LambdaProbeEntity::getName, null).getTargetSql())
                .as("null 不拼接").isEmpty();
    }

    /** 集合版 in 条件在集合为空或为 null 时跳过，并在非空时解析列名。 */
    @Test
    void inIfPresentCollectionSkipsEmptyOrNull() {
        LambdaQueryWrapperX<LambdaProbeEntity> withValues = new LambdaQueryWrapperX<>();
        assertThat(withValues.inIfPresent(LambdaProbeEntity::getId, List.of(1L, 2L))).isSameAs(withValues);
        assertThat(withValues.getTargetSql()).contains("id IN");

        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>().inIfPresent(LambdaProbeEntity::getId, List.<Long>of()).getTargetSql())
                .as("空集合不拼接").isEmpty();
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>()
                .inIfPresent(LambdaProbeEntity::getId, (Collection<Long>) null).getTargetSql())
                .as("null 集合不拼接且不抛错").isEmpty();
    }

    /** 变长参数版 in 条件在数组为空时跳过。 */
    @Test
    void inIfPresentVarargsSkipsEmptyArray() {
        LambdaQueryWrapperX<LambdaProbeEntity> withValues = new LambdaQueryWrapperX<>();
        assertThat(withValues.inIfPresent(LambdaProbeEntity::getId, 1L, 2L)).isSameAs(withValues);
        assertThat(withValues.getTargetSql()).contains("id IN");

        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>().inIfPresent(LambdaProbeEntity::getId).getTargetSql())
                .as("无变长参数时不拼接").isEmpty();
    }

    /**
     * eq / ne 条件按 Hutool 的"非空"口径跳过空串与 null。
     *
     * <p>与字符串列名版 {@code QueryWrapperX} 的 {@code val != null} 口径不同：本类用
     * {@code ObjectUtil.isNotEmpty}，空串同样被跳过。这是两个重载包装器的既有差异，
     * 用例按真实行为断言，避免调用方误以为空串会参与过滤。</p>
     */
    @Test
    void eqAndNeIfPresentSkipNullOnly() {
        LambdaQueryWrapperX<LambdaProbeEntity> eqWrapper = new LambdaQueryWrapperX<>();
        assertThat(eqWrapper.eqIfPresent(LambdaProbeEntity::getName, "DUMMY-NAME")).isSameAs(eqWrapper);
        assertThat(eqWrapper.getTargetSql()).contains("name =");
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>().eqIfPresent(LambdaProbeEntity::getName, "").getTargetSql())
                .as("按非空口径，空串被跳过（与字符串列名版不同）").isEmpty();
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>().eqIfPresent(LambdaProbeEntity::getName, null).getTargetSql())
                .as("null 跳过").isEmpty();

        LambdaQueryWrapperX<LambdaProbeEntity> neWrapper = new LambdaQueryWrapperX<>();
        assertThat(neWrapper.neIfPresent(LambdaProbeEntity::getName, "DUMMY-NAME")).isSameAs(neWrapper);
        assertThat(neWrapper.getTargetSql()).contains("name <>");
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>().neIfPresent(LambdaProbeEntity::getName, null).getTargetSql())
                .as("null 跳过").isEmpty();
    }

    /** 比较类条件只跳过 null，并按各自运算符拼接。 */
    @Test
    void comparisonIfPresentSkipNullOnly() {
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>().gtIfPresent(LambdaProbeEntity::getAge, 18).getTargetSql())
                .contains("age >");
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>().geIfPresent(LambdaProbeEntity::getAge, 18).getTargetSql())
                .contains("age >=");
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>().ltIfPresent(LambdaProbeEntity::getAge, 18).getTargetSql())
                .contains("age <");
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>().leIfPresent(LambdaProbeEntity::getAge, 18).getTargetSql())
                .contains("age <=");

        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>().gtIfPresent(LambdaProbeEntity::getAge, null).getTargetSql()).isEmpty();
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>().geIfPresent(LambdaProbeEntity::getAge, null).getTargetSql()).isEmpty();
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>().ltIfPresent(LambdaProbeEntity::getAge, null).getTargetSql()).isEmpty();
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>().leIfPresent(LambdaProbeEntity::getAge, null).getTargetSql()).isEmpty();
    }

    /** 区间条件按缺失的一端降级为单边比较，两端都缺省时不产生条件。 */
    @Test
    void betweenIfPresentDegradesByMissingBound() {
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>()
                .betweenIfPresent(LambdaProbeEntity::getAge, 18, 30).getTargetSql()).contains("age BETWEEN");
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>()
                .betweenIfPresent(LambdaProbeEntity::getAge, 18, null).getTargetSql()).contains("age >=");
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>()
                .betweenIfPresent(LambdaProbeEntity::getAge, null, 30).getTargetSql()).contains("age <=");
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>()
                .betweenIfPresent(LambdaProbeEntity::getAge, null, null).getTargetSql()).isEmpty();
    }

    /** 数组版区间条件对 null 数组与空数组都按无值处理，不抛下标越界。 */
    @Test
    void betweenIfPresentArrayHandlesMissingBounds() {
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>()
                .betweenIfPresent(LambdaProbeEntity::getAge, new Object[]{18, 30}).getTargetSql()).contains("age BETWEEN");
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>()
                .betweenIfPresent(LambdaProbeEntity::getAge, new Object[]{18}).getTargetSql()).contains("age >=");
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>()
                .betweenIfPresent(LambdaProbeEntity::getAge, new Object[]{null, 30}).getTargetSql()).contains("age <=");
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>()
                .betweenIfPresent(LambdaProbeEntity::getAge, new Object[0]).getTargetSql()).isEmpty();
        assertThat(new LambdaQueryWrapperX<LambdaProbeEntity>()
                .betweenIfPresent(LambdaProbeEntity::getAge, (Object[]) null).getTargetSql()).isEmpty();
    }

    /** 重写的父类链式方法返回当前包装器，并把条件按真实列名拼进 SQL。 */
    @Test
    void fluentOverridesReturnSameWrapperAndResolveColumns() {
        LambdaQueryWrapperX<LambdaProbeEntity> wrapper = new LambdaQueryWrapperX<>();
        assertThat(wrapper.eq(true, LambdaProbeEntity::getName, "DUMMY-NAME")).isSameAs(wrapper);
        assertThat(wrapper.eq(false, LambdaProbeEntity::getAge, 18)).as("condition=false 时不拼接但仍返回自身").isSameAs(wrapper);
        assertThat(wrapper.eq(LambdaProbeEntity::getName, "DUMMY-NAME")).isSameAs(wrapper);
        assertThat(wrapper.in(LambdaProbeEntity::getId, List.of(1L, 2L))).isSameAs(wrapper);
        assertThat(wrapper.orderByDesc(LambdaProbeEntity::getCreateTime)).isSameAs(wrapper);
        assertThat(wrapper.last("LIMIT 1")).isSameAs(wrapper);

        String sql = wrapper.getTargetSql();
        assertThat(sql).contains("name =").contains("id IN")
                .contains("ORDER BY create_time DESC").contains("LIMIT 1");
        assertThat(sql).as("condition=false 的条件不得出现在 SQL 中").doesNotContain("age");
    }

}
