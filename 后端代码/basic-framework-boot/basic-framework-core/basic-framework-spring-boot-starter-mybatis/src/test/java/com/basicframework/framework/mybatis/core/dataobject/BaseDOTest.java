package com.basicframework.framework.mybatis.core.dataobject;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证基础实体清理审计字段的契约。
 *
 * <p>{@code clean()} 用于更新入参落库前移除前端提交的审计字段：创建人、创建时间、更新人、
 * 更新时间由 {@code MetaObjectHandler} 统一填充，若允许前端直接提交就会绕过审计，
 * 让记录显示成他人创建或伪造时间。因此清理必须彻底，且不得顺手改动其他字段——
 * 逻辑删除标记参与查询条件，被一起清空会让记录“复活”。</p>
 *
 * @author shady2713
 */
class BaseDOTest {

    /** 四个审计字段必须全部清空，遗漏任意一个都会让前端提交值覆盖真实审计信息。 */
    @Test
    void cleanRemovesEveryAuditField() {
        SampleDO sample = populated();

        sample.clean();

        assertThat(sample.getCreator()).as("创建人必须清空，交由填充器按当前身份重写").isNull();
        assertThat(sample.getCreateTime()).as("创建时间必须清空，不得由前端指定").isNull();
        assertThat(sample.getUpdater()).as("更新人必须清空，交由填充器按当前身份重写").isNull();
        assertThat(sample.getUpdateTime()).as("更新时间必须清空，不得由前端指定").isNull();
    }

    /** 清理只针对审计字段，业务字段与逻辑删除标记必须原样保留。 */
    @Test
    void cleanKeepsBusinessFieldsAndLogicDeleteFlag() {
        SampleDO sample = populated();

        sample.clean();

        assertThat(sample.getId()).isEqualTo(1024L);
        assertThat(sample.getName()).isEqualTo("样例数据");
        assertThat(sample.getDeleted()).as("逻辑删除标记参与查询条件，不得被清理改动").isTrue();
    }

    /** 重复清理必须保持幂等，多次调用不产生其他副作用。 */
    @Test
    void cleanIsIdempotent() {
        SampleDO sample = populated();

        sample.clean();
        sample.clean();

        assertThat(sample.getCreator()).isNull();
        assertThat(sample.getCreateTime()).isNull();
        assertThat(sample.getUpdater()).isNull();
        assertThat(sample.getUpdateTime()).isNull();
        assertThat(sample.getDeleted()).isTrue();
    }

    /**
     * 构造带完整审计字段与业务字段的样例实体。
     *
     * @return 所有字段均已赋值的样例实体
     */
    private static SampleDO populated() {
        SampleDO sample = new SampleDO();
        sample.setId(1024L);
        sample.setName("样例数据");
        sample.setCreator("1001");
        sample.setCreateTime(LocalDateTime.of(2026, 9, 30, 12, 34, 56));
        sample.setUpdater("1002");
        sample.setUpdateTime(LocalDateTime.of(2026, 10, 1, 8, 0, 0));
        sample.setDeleted(true);
        return sample;
    }

    /** 用于观察 {@link BaseDO#clean()} 行为的最小实体。 */
    static class SampleDO extends BaseDO {

        /** 主键。 */
        private Long id;

        /** 业务字段，用于确认清理不误伤其他字段。 */
        private String name;

        /** 读取主键。 */
        public Long getId() {
            return id;
        }

        /** 写入主键。 */
        public void setId(Long id) {
            this.id = id;
        }

        /** 读取业务字段。 */
        public String getName() {
            return name;
        }

        /** 写入业务字段。 */
        public void setName(String name) {
            this.name = name;
        }
    }
}
