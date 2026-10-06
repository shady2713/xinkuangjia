package com.basicframework.module.system.enums.permission;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 菜单类型枚举类
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@Getter
@AllArgsConstructor
public enum MenuTypeEnum {

    /** 目录 */
    DIR(1),
    /** 菜单 */
    MENU(2),
    /** 按钮 */
    BUTTON(3)
    ;

    /**
     * 类型
     */
    private final Integer type;

}
