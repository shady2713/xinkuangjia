package com.basicframework.module.system.enums.permission;

import com.basicframework.framework.common.core.ArrayValuable;
import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.Arrays;

/**
 * 菜单类型枚举类
 *
 * @author shady
 */
@Getter
@AllArgsConstructor
public enum MenuTypeEnum implements ArrayValuable<Integer> {

    /** 目录 */
    DIR(1),
    /** 菜单 */
    MENU(2),
    /** 按钮 */
    BUTTON(3)
    ;

    public static final Integer[] ARRAYS = Arrays.stream(values()).map(MenuTypeEnum::getType).toArray(Integer[]::new);

    /**
     * 类型
     */
    private final Integer type;

    @Override
    public Integer[] array() {
        return ARRAYS;
    }

}
