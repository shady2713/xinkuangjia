package com.basicframework.module.system.enums.permission;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证菜单类型枚举的稳定编码。
 *
 * <p>菜单类型写入菜单表并决定前端渲染成目录、菜单还是按钮，编码漂移会让既有菜单结构错乱，
 * 因此锁定每个常量对应的持久化取值。</p>
 *
 * @author shady2713
 */
class MenuTypeEnumTest {

    /** 目录、菜单与按钮的编码必须与数据库既有取值一致。 */
    @Test
    void menuTypeCodesAreStable() {
        assertThat(MenuTypeEnum.DIR.getType()).isEqualTo(1);
        assertThat(MenuTypeEnum.MENU.getType()).isEqualTo(2);
        assertThat(MenuTypeEnum.BUTTON.getType()).isEqualTo(3);

        assertThat(MenuTypeEnum.values()).extracting(MenuTypeEnum::getType).doesNotHaveDuplicates();
    }

}
