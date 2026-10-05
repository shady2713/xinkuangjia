package com.basicframework.module.system.enums.permission;

import cn.hutool.core.util.ObjectUtil;
import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 角色标识枚举
 * @author 李杰
 */
@Getter
@AllArgsConstructor
public enum RoleCodeEnum {

    /** 超级管理员，角色标识 super_admin；初始化数据内置，角色接口拒绝创建同编码角色，并按该编码识别超级管理员。 */
    SUPER_ADMIN("super_admin", "超级管理员");

    /**
     * 角色编码
     */
    private final String code;
    /**
     * 名字
     */
    private final String name;

    /**
     * 判断Super管理端。
     *
     * @param code 编码
     * @return 是否满足条件
     */
    public static boolean isSuperAdmin(String code) {
        return ObjectUtil.equal(code, SUPER_ADMIN.getCode());
    }

}
