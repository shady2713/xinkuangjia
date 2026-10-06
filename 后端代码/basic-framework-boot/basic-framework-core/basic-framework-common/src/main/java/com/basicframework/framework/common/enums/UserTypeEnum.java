package com.basicframework.framework.common.enums;

import cn.hutool.core.util.ArrayUtil;
import com.basicframework.framework.common.core.ArrayValuable;
import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.Arrays;

/**
 * 全局用户类型枚举
 *
 * @author 李杰
 * 署名验收：尚未验收
 */
@AllArgsConstructor
@Getter
public enum UserTypeEnum implements ArrayValuable<Integer> {

    /** 会员，值 1；面向 C 端的普通用户，框架当前未实现其用户信息读取。 */
    MEMBER(1, "会员"),
    /** 管理员，值 2；面向 B 端管理后台，用户编号对应系统用户表（AdminUserDO）。 */
    ADMIN(2, "管理员");

    public static final Integer[] ARRAYS = Arrays.stream(values()).map(UserTypeEnum::getValue).toArray(Integer[]::new);

    /**
     * 类型
     */
    private final Integer value;
    /**
     * 类型名
     */
    private final String name;

    /**
     * 根据用户类型值获取枚举。
     *
     * @param value 用户类型值
     * @return 用户类型枚举，不存在时返回 null
     */
    public static UserTypeEnum valueOf(Integer value) {
        return ArrayUtil.firstMatch(userType -> userType.getValue().equals(value), values());
    }

    /**
     * 返回全部用户类型值，用于枚举范围校验。
     *
     * @return 用户类型值数组
     */
    @Override
    public Integer[] array() {
        return ARRAYS;
    }
}
