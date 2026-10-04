package com.basicframework.module.system.enums.common;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证管理后台平台类型的默认值兜底、相等判定与合法性校验契约。
 *
 * <p>平台类型决定账号、角色与菜单的隔离边界：历史数据没有类型时必须归到业务管理平台，
 * 两个平台类型相同才允许互相引用；平台类型还必须限定在固定枚举内，
 * 否则非法值会写库并让账号在两个平台间串用。</p>
 *
 * @author shady2713
 */
class AdminPlatformTypeEnumTest {

    /** 平台类型编码必须与数据库既有取值一致。 */
    @Test
    void platformTypesAreStable() {
        assertThat(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()).isEqualTo("business_admin");
        assertThat(AdminPlatformTypeEnum.SUPER_ADMIN.getType()).isEqualTo("super_admin");
    }

    /** 缺失或空白的平台类型必须兜底为业务管理平台，保证历史账号与菜单继续可用。 */
    @Test
    void missingTypeFallsBackToBusinessAdmin() {
        assertThat(AdminPlatformTypeEnum.defaultType(null)).isEqualTo("business_admin");
        assertThat(AdminPlatformTypeEnum.defaultType("")).isEqualTo("business_admin");
        assertThat(AdminPlatformTypeEnum.defaultType("   ")).isEqualTo("business_admin");
        assertThat(AdminPlatformTypeEnum.defaultType("super_admin")).isEqualTo("super_admin");
    }

    /**
     * 相等判定必须先做默认值兜底。
     *
     * <p>缺失类型与显式 business_admin 表示同一个平台，判为不同会让历史账号被拒绝；
     * 反过来把两个不同平台判为相同会直接打破隔离。</p>
     */
    @Test
    void sameComparisonUsesDefaultTypeFallback() {
        assertThat(AdminPlatformTypeEnum.isSame(null, "business_admin")).isTrue();
        assertThat(AdminPlatformTypeEnum.isSame("business_admin", "")).isTrue();
        assertThat(AdminPlatformTypeEnum.isSame("super_admin", "super_admin")).isTrue();
        assertThat(AdminPlatformTypeEnum.isSame("super_admin", "business_admin")).isFalse();
        assertThat(AdminPlatformTypeEnum.isSame(null, "super_admin")).isFalse();
    }

    /** 只有固定枚举值合法，大小写不同、空白与 null 都必须被拒绝。 */
    @Test
    void validityIsLimitedToDeclaredTypes() {
        assertThat(AdminPlatformTypeEnum.isValid("business_admin")).isTrue();
        assertThat(AdminPlatformTypeEnum.isValid("super_admin")).isTrue();
        assertThat(AdminPlatformTypeEnum.isValid("admin")).isFalse();
        assertThat(AdminPlatformTypeEnum.isValid("SUPER_ADMIN")).isFalse();
        assertThat(AdminPlatformTypeEnum.isValid(" business_admin ")).isFalse();
        assertThat(AdminPlatformTypeEnum.isValid(null)).isFalse();
    }

}
