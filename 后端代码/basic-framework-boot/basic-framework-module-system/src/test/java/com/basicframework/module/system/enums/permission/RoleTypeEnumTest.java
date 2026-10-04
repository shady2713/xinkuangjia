package com.basicframework.module.system.enums.permission;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证角色类型枚举的稳定编码。
 *
 * <p>角色类型写入角色表，用于区分内置角色与自定义角色；编码漂移会让内置角色被当作可删除的
 * 业务角色处理，因此锁定持久化取值。</p>
 *
 * @author shady2713
 */
class RoleTypeEnumTest {

    /** 内置角色为 1、自定义角色为 2，与数据库既有取值一致。 */
    @Test
    void roleTypeCodesAreStable() {
        assertThat(RoleTypeEnum.SYSTEM.getType()).isEqualTo(1);
        assertThat(RoleTypeEnum.CUSTOM.getType()).isEqualTo(2);

        assertThat(RoleTypeEnum.values()).extracting(RoleTypeEnum::getType).doesNotHaveDuplicates();
    }

}
