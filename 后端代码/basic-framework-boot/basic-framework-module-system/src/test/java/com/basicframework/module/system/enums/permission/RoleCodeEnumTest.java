package com.basicframework.module.system.enums.permission;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证超级管理员角色标识的判定契约。
 *
 * <p>{@code isSuperAdmin} 用于跳过角色校验与保护内置角色，判定错误会让普通角色获得超级管理员
 * 待遇，或让真正的超管账号被当作业务角色处理。因此同时锁定角色编码常量与 null/不匹配输入的
 * 否定结果——比较实现必须容忍 null，不能抛空指针。</p>
 *
 * @author shady2713
 */
class RoleCodeEnumTest {

    /** 超管角色编码与名称必须与数据库既有数据一致。 */
    @Test
    void superAdminCodeAndNameAreStable() {
        assertThat(RoleCodeEnum.SUPER_ADMIN.getCode()).isEqualTo("super_admin");
        assertThat(RoleCodeEnum.SUPER_ADMIN.getName()).isEqualTo("超级管理员");
    }

    /** 只有超管编码返回 true；其它编码、空串与 null 都必须返回 false。 */
    @Test
    void onlySuperAdminCodeIsRecognized() {
        assertThat(RoleCodeEnum.isSuperAdmin("super_admin")).isTrue();
        assertThat(RoleCodeEnum.isSuperAdmin("business_admin")).isFalse();
        assertThat(RoleCodeEnum.isSuperAdmin("")).isFalse();
        assertThat(RoleCodeEnum.isSuperAdmin(null)).as("未提供编码时必须安全返回 false").isFalse();
        assertThat(RoleCodeEnum.isSuperAdmin("SUPER_ADMIN")).as("角色编码区分大小写").isFalse();
    }

}
