package com.basicframework.framework.security.core.service;

import cn.hutool.core.collection.CollUtil;
import com.basicframework.framework.common.biz.system.permission.PermissionCommonApi;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import lombok.AllArgsConstructor;

import java.util.Arrays;

import static com.basicframework.framework.security.core.util.SecurityFrameworkUtils.getLoginUserId;
import static com.basicframework.framework.security.core.util.SecurityFrameworkUtils.skipPermissionCheck;

/**
 * 默认的 {@link SecurityFrameworkService} 实现类
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@AllArgsConstructor
public class SecurityFrameworkServiceImpl implements SecurityFrameworkService {

    private final PermissionCommonApi permissionApi;

    /**
     * 判断权限 是否满足业务条件。
     *
     * @param permission permission 参数
     * @return 业务条件成立时返回 true，否则返回 false
     */
    @Override
    public boolean hasPermission(String permission) {
        return hasAnyPermissions(permission);
    }

    /**
     * 判断任一Permissions 是否满足业务条件。
     *
     * @param permissions permissions 参数
     * @return 业务条件成立时返回 true，否则返回 false
     */
    @Override
    public boolean hasAnyPermissions(String... permissions) {
        // 特殊：跨租户访问
        if (skipPermissionCheck()) {
            return true;
        }

        // 权限校验
        Long userId = getLoginUserId();
        if (userId == null) {
            return false;
        }
        return permissionApi.hasAnyPermissions(userId, permissions);
    }

    /**
     * 判断角色 是否满足业务条件。
     *
     * @param role role 参数
     * @return 业务条件成立时返回 true，否则返回 false
     */
    @Override
    public boolean hasRole(String role) {
        return hasAnyRoles(role);
    }

    /**
     * 判断任一Roles 是否满足业务条件。
     *
     * @param roles roles 参数
     * @return 业务条件成立时返回 true，否则返回 false
     */
    @Override
    public boolean hasAnyRoles(String... roles) {
        // 特殊：跨租户访问
        if (skipPermissionCheck()) {
            return true;
        }

        // 权限校验
        Long userId = getLoginUserId();
        if (userId == null) {
            return false;
        }
        return permissionApi.hasAnyRoles(userId, roles);
    }

    /**
     * 判断Scope 是否满足业务条件。
     *
     * @param scope scope 参数
     * @return 业务条件成立时返回 true，否则返回 false
     */
    @Override
    public boolean hasScope(String scope) {
        return hasAnyScopes(scope);
    }

    /**
     * 判断任一Scopes 是否满足业务条件。
     *
     * @param scope scope 参数
     * @return 业务条件成立时返回 true，否则返回 false
     */
    @Override
    public boolean hasAnyScopes(String... scope) {
        // 特殊：跨租户访问
        if (skipPermissionCheck()) {
            return true;
        }

        // 权限校验
        LoginUser user = SecurityFrameworkUtils.getLoginUser();
        if (user == null) {
            return false;
        }
        return CollUtil.containsAny(user.getScopes(), Arrays.asList(scope));
    }

}
