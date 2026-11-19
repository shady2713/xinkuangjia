package com.basicframework.framework.mybatis.core.interceptor;

import com.basicframework.framework.mybatis.core.dataobject.BaseDO;
import com.basicframework.framework.mybatis.core.dataobject.UniqueBaseDO;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import lombok.Data;
import lombok.EqualsAndHashCode;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 {@link SoftDeleteUniqueInnerInterceptor} 对逻辑删除 UPDATE 语句追加主键消歧赋值的准确性。
 *
 * @author shady2713
 */
class SoftDeleteUniqueInnerInterceptorTest {

    private final SoftDeleteUniqueInnerInterceptor interceptor = new SoftDeleteUniqueInnerInterceptor();

    /**
     * 初始化测试实体的 MyBatis-Plus {@code TableInfo} 元数据。
     */
    @BeforeAll
    static void initTableMetadata() {
        MybatisConfiguration configuration = new MybatisConfiguration();
        MapperBuilderAssistant assistant = new MapperBuilderAssistant(configuration, "");
        TableInfoHelper.initTableInfo(assistant, SampleUniqueEntity.class);
        TableInfoHelper.initTableInfo(assistant, SamplePlainEntity.class);
    }

    /**
     * 验证继承 {@link UniqueBaseDO} 的实体在执行逻辑删除时自动追加 {@code deleted_tag = id}。
     */
    @Test
    void appendsDeletedTagAssignmentOnLogicalDeleteForUniqueEntity() {
        String rewritten = interceptor.parserSingle(
                "UPDATE sample_unique_entity SET deleted = 1 WHERE id = 42 AND deleted = 0", null);

        assertThat(rewritten).containsIgnoringCase("deleted_tag = id");
    }

    /**
     * 验证普通业务字段更新不触发 {@code deleted_tag} 改写，且未继承 {@link UniqueBaseDO} 的表保持原样。
     */
    @Test
    void leavesRegularUpdatesAndPlainTablesUntouched() {
        String regularUpdate = interceptor.parserSingle(
                "UPDATE sample_unique_entity SET code = 'NEW_CODE' WHERE id = 42 AND deleted = 0", null);
        String plainDelete = interceptor.parserSingle(
                "UPDATE sample_plain_entity SET deleted = 1 WHERE id = 42 AND deleted = 0", null);

        assertThat(regularUpdate).doesNotContainIgnoringCase("deleted_tag");
        assertThat(plainDelete).doesNotContainIgnoringCase("deleted_tag");
    }

    /**
     * 验证将 {@code deleted} 显式置为 {@code 0} 或 {@code false} 的恢复/常规更新不得篡改 {@code deleted_tag = id}。
     */
    @Test
    void doesNotAppendDeletedTagWhenSettingDeletedToZeroOrFalse() {
        String restoreInt = interceptor.parserSingle(
                "UPDATE sample_unique_entity SET deleted = 0 WHERE id = 42", null);
        String restoreBool = interceptor.parserSingle(
                "UPDATE sample_unique_entity SET deleted = false WHERE id = 42", null);

        assertThat(restoreInt).doesNotContainIgnoringCase("deleted_tag");
        assertThat(restoreBool).doesNotContainIgnoringCase("deleted_tag");
    }

    /**
     * 含唯一键消歧字段的测试实体。
     */
    @TableName("sample_unique_entity")
    @Data
    @EqualsAndHashCode(callSuper = true)
    static class SampleUniqueEntity extends UniqueBaseDO {

        @TableId
        private Long id;

        private String code;

    }

    /**
     * 普通基础测试实体。
     */
    @TableName("sample_plain_entity")
    @Data
    @EqualsAndHashCode(callSuper = true)
    static class SamplePlainEntity extends BaseDO {

        @TableId
        private Long id;

        private String name;

    }

}
