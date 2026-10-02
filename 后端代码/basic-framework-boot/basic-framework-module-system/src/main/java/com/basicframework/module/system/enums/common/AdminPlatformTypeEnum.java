package com.basicframework.module.system.enums.common;

import cn.hutool.core.util.StrUtil;
import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.Arrays;
import java.util.Objects;

/**
 * 管理后台账号所属平台类型。
 *
 * <p>当前服务同时支撑业务管理平台和新管理平台，用户、角色、菜单都需要按该类型隔离，避免两个平台账号串用。</p>
 * @author 李杰
 */
@Getter
@AllArgsConstructor
public enum AdminPlatformTypeEnum {

    /**
     * 当前业务管理平台。
     */
    BUSINESS_ADMIN("business_admin"),

    /**
     * 新管理平台。
     */
    SUPER_ADMIN("super_admin");

    private final String type;

    /**
     * 老数据没有平台类型时，统一归到当前业务管理平台，保证历史账号和菜单继续可用。
     */
    public static String defaultType(String type) {
        return StrUtil.blankToDefault(type, BUSINESS_ADMIN.getType());
    }

    /**
     * 判断两个平台类型是否一致，比较前先做历史默认值兜底。
     */
    public static boolean isSame(String left, String right) {
        return Objects.equals(defaultType(left), defaultType(right));
    }

    /**
     * 校验平台类型是否为系统允许的固定枚举值。
     */
    public static boolean isValid(String type) {
        return Arrays.stream(values()).anyMatch(item -> Objects.equals(item.getType(), type));
    }

}
