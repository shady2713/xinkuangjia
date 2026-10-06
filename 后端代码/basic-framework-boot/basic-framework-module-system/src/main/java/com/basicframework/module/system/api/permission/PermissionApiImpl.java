package com.basicframework.module.system.api.permission;

import com.basicframework.framework.common.biz.system.permission.dto.DeptDataPermissionRespDTO;
import com.basicframework.module.system.service.permission.PermissionService;
import org.springframework.stereotype.Service;

import jakarta.annotation.Resource;
import java.util.Collection;
import java.util.Set;

/**
 * 权限 API 实现类
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@Service
public class PermissionApiImpl implements PermissionApi {

    @Resource
    private PermissionService permissionService;

    /**
     * 获取用户角色IdListBy角色Ids。
     *
     * @param roleIds roleIds 编号集合
     * @return 查询或转换后的结果
     */
    @Override
    public Set<Long> getUserRoleIdListByRoleIds(Collection<Long> roleIds) {
        return permissionService.getUserRoleIdListByRoleId(roleIds);
    }

    /**
     * 判断任一Permissions 是否满足业务条件。
     *
     * @param userId 用户编号
     * @param permissions permissions 参数
     * @return 业务条件成立时返回 true，否则返回 false
     */
    @Override
    public boolean hasAnyPermissions(Long userId, String... permissions) {
        return permissionService.hasAnyPermissions(userId, permissions);
    }

    /**
     * 判断任一Roles 是否满足业务条件。
     *
     * @param userId 用户编号
     * @param roles roles 参数
     * @return 业务条件成立时返回 true，否则返回 false
     */
    @Override
    public boolean hasAnyRoles(Long userId, String... roles) {
        return permissionService.hasAnyRoles(userId, roles);
    }

    /**
     * 获取部门数据权限。
     *
     * @param userId 用户编号
     * @return 查询或转换后的结果
     */
    @Override
    public DeptDataPermissionRespDTO getDeptDataPermission(Long userId) {
        return permissionService.getDeptDataPermission(userId);
    }

}
