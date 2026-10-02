package com.basicframework.module.system.enums.permission;

import com.basicframework.framework.common.core.ArrayValuable;
import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.Arrays;

/**
 * 数据权限范围的枚举
 *
 * 用于实现数据级别的权限
 *
 * @author 李杰
 */
@Getter
@AllArgsConstructor
public enum DataScopeEnum implements ArrayValuable<Integer> {

    /** 全部数据权限 */
    ALL(1),

    /** 指定部门数据权限 */
    DEPT_CUSTOM(2),
    /** 部门数据权限 */
    DEPT_ONLY(3),
    /** 部门及以下数据权限 */
    DEPT_AND_CHILD(4),

    /** 仅本人数据权限 */
    SELF(5);

    /**
     * 范围
     */
    private final Integer scope;

    public static final Integer[] ARRAYS = Arrays.stream(values()).map(DataScopeEnum::getScope).toArray(Integer[]::new);

    /**
     * 将输入值规范化为数组形式。
     *
     * @return 当前查询包装器
     */
    @Override
    public Integer[] array() {
        return ARRAYS;
    }

}
