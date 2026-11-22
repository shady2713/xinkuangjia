package com.basicframework.module.system.enums.permission;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 系统角色类型枚举，用于区分内置角色与普通业务角色。
 *
 * @author 李杰
 */
@Getter
@AllArgsConstructor
public enum RoleTypeEnum {

    /**
     * 内置角色
     */
    SYSTEM(1),
    /**
     * 自定义角色
     */
    CUSTOM(2);

    private final Integer type;

}
