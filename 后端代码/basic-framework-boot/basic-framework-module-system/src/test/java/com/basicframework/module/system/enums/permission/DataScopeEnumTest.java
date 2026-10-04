package com.basicframework.module.system.enums.permission;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 锁定数据权限范围的稳定编码与数组入口。
 *
 * <p>数据范围编码写入角色表并直接参与数据权限拼装：全部、指定部门、本部门、本部门及以下、
 * 仅本人分别对应 1 至 5。编码一旦变化，存量角色的可见范围会被静默放大或收缩，因此这里
 * 同时锁定取值与数组入口，数组入口供枚举范围校验使用。</p>
 *
 * @author shady2713
 */
class DataScopeEnumTest {

    /** 五种数据范围的编码与声明顺序必须稳定。 */
    @Test
    void constantsCarryStableScopeCodes() {
        assertThat(DataScopeEnum.values()).containsExactly(DataScopeEnum.ALL, DataScopeEnum.DEPT_CUSTOM,
                DataScopeEnum.DEPT_ONLY, DataScopeEnum.DEPT_AND_CHILD, DataScopeEnum.SELF);
        assertThat(DataScopeEnum.ALL.getScope()).as("全部数据权限").isEqualTo(1);
        assertThat(DataScopeEnum.DEPT_CUSTOM.getScope()).as("指定部门数据权限").isEqualTo(2);
        assertThat(DataScopeEnum.DEPT_ONLY.getScope()).as("本部门数据权限").isEqualTo(3);
        assertThat(DataScopeEnum.DEPT_AND_CHILD.getScope()).as("本部门及以下数据权限").isEqualTo(4);
        assertThat(DataScopeEnum.SELF.getScope()).as("仅本人数据权限").isEqualTo(5);
    }

    /** 数组入口必须返回全部合法数据范围值，供枚举范围校验使用。 */
    @Test
    void arrayExposesAllValidScopeCodes() {
        assertThat(DataScopeEnum.ALL.array()).containsExactly(1, 2, 3, 4, 5);
        assertThat(DataScopeEnum.SELF.array())
                .as("数组入口不随调用方枚举常量变化").containsExactly(1, 2, 3, 4, 5);
        assertThat(DataScopeEnum.ARRAYS).containsExactly(1, 2, 3, 4, 5);
    }

    /** 各数据范围编码必须互不相同，避免两类可见范围被合并。 */
    @Test
    void scopeCodesAreUnique() {
        assertThat(DataScopeEnum.values()).extracting(DataScopeEnum::getScope).doesNotHaveDuplicates();
    }
}
