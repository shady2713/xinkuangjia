package com.basicframework.module.system.api.permission;

import com.basicframework.module.system.service.permission.RoleService;
import org.springframework.stereotype.Service;

import jakarta.annotation.Resource;
import java.util.Collection;

/**
 * 角色 API 实现类
 *
 * @author 李杰
 */
@Service
public class RoleApiImpl implements RoleApi {

    @Resource
    private RoleService roleService;

    /**
     * 筛选有效角色List。
     *
     * @param ids ids 编号集合
     */
    @Override
    public void validRoleList(Collection<Long> ids) {
        roleService.validateRoleList(ids);
    }
}
