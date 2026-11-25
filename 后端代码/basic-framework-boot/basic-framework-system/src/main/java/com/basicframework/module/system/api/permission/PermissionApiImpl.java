package com.basicframework.module.system.api.permission;

import com.basicframework.framework.common.biz.system.permission.PermissionCommonApi;
import com.basicframework.framework.common.biz.system.permission.dto.DeptDataPermissionRespDTO;
import com.basicframework.module.system.service.permission.PermissionService;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;

/**
 * 权限校验核心 SPI 实现，供 core 层安全鉴权与部门数据权限引擎调用。
 *
 * @author shady
 */
@Service
public class PermissionApiImpl implements PermissionCommonApi {

    @Resource
    private PermissionService permissionService;

    /**
     * 判断用户是否拥有指定权限中的任意一项。
     *
     * @param userId 用户编号
     * @param permissions 权限标识列表
     * @return 拥有任意一项权限时返回 true
     */
    @Override
    public boolean hasAnyPermissions(Long userId, String... permissions) {
        return permissionService.hasAnyPermissions(userId, permissions);
    }

    /**
     * 判断用户是否拥有指定角色中的任意一项。
     *
     * @param userId 用户编号
     * @param roles 角色编码列表
     * @return 拥有任意一项角色时返回 true
     */
    @Override
    public boolean hasAnyRoles(Long userId, String... roles) {
        return permissionService.hasAnyRoles(userId, roles);
    }

    /**
     * 获取当前登录用户的部门数据权限范围。
     *
     * @param userId 用户编号
     * @return 部门数据权限配置
     */
    @Override
    public DeptDataPermissionRespDTO getDeptDataPermission(Long userId) {
        return permissionService.getDeptDataPermission(userId);
    }

}
