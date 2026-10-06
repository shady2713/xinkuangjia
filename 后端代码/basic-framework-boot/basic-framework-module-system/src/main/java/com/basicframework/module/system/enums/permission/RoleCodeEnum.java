package com.basicframework.module.system.enums.permission;

import cn.hutool.core.util.ObjectUtil;
import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 角色标识枚举
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/enums/permission/RoleCodeEnum.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 2 行，移除或改写上游 5 行；import 新增 1 行、移除 1 行；补充注释 6 行。
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
