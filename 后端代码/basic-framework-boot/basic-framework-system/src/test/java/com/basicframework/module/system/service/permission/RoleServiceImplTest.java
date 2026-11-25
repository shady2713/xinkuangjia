package com.basicframework.module.system.service.permission;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.module.system.controller.admin.permission.vo.role.RoleSaveReqVO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.dal.dataobject.permission.UserRoleDO;
import com.basicframework.module.system.dal.mysql.permission.RoleMapper;
import com.basicframework.module.system.dal.mysql.permission.UserRoleMapper;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.permission.RoleTypeEnum;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证 {@link RoleServiceImpl} 删除与批量删除角色时的用户引用一致校验，与停用逻辑保持同步。
 *
 * @author shady2713
 */
@ExtendWith(MockitoExtension.class)
class RoleServiceImplTest {

    /** 被测角色服务实现。 */
    @InjectMocks
    private RoleServiceImpl roleService;

    /** 延迟获取的权限服务提供者，用于在无引用删除时级联清理角色关联缓存。 */
    @Mock
    private ObjectProvider<PermissionService> permissionServiceProvider;

    /** 模拟权限服务实例。 */
    @Mock
    private PermissionService permissionService;

    /** 模拟用户服务提供者，用于校验操作者平台边界。 */
    @Mock
    private ObjectProvider<AdminUserService> adminUserServiceProvider;

    /** 模拟用户服务实例。 */
    @Mock
    private AdminUserService adminUserService;

    /** 模拟角色数据访问层。 */
    @Mock
    private RoleMapper roleMapper;

    /** 模拟用户-角色关联数据访问层。 */
    @Mock
    private UserRoleMapper userRoleMapper;

    @BeforeEach
    void setUpOperator() {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(1L);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(loginUser, null));
        lenient().when(adminUserServiceProvider.getIfAvailable()).thenReturn(adminUserService);
        lenient().when(adminUserService.getLoginUserTypeOrDefault())
                .thenReturn(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    /** 仍被用户绑定的自定义角色在单删与批量删除时均应拒绝并保留原记录。 */
    @Test
    void deleteRoleAndBatchRejectReferencedRole() {
        RoleDO role = customRole(10L, "运营专员");
        when(roleMapper.selectById(10L)).thenReturn(role);
        when(userRoleMapper.selectListByRoleIds(List.of(10L)))
                .thenReturn(List.of(new UserRoleDO()));

        ServiceException singleEx = assertThrows(ServiceException.class, () -> roleService.deleteRole(10L));
        assertEquals(ErrorCodeConstants.ROLE_IS_REFERENCED.getCode(), singleEx.getCode());
        verify(roleMapper, never()).deleteById(any(Long.class));

        ServiceException batchEx = assertThrows(
                ServiceException.class, () -> roleService.deleteRoleList(List.of(10L)));
        assertEquals(ErrorCodeConstants.ROLE_IS_REFERENCED.getCode(), batchEx.getCode());
        verify(roleMapper, never()).deleteByIds(any());
    }

    /** 未被任何用户引用的自定义角色可正常逻辑删除并清理权限关联。 */
    @Test
    void deleteRoleAndBatchSucceedWhenUnreferenced() {
        RoleDO role1 = customRole(20L, "临时角色1");
        RoleDO role2 = customRole(21L, "临时角色2");
        when(roleMapper.selectById(20L)).thenReturn(role1);
        when(roleMapper.selectById(21L)).thenReturn(role2);
        when(userRoleMapper.selectListByRoleIds(any())).thenReturn(Collections.emptyList());
        when(permissionServiceProvider.getObject()).thenReturn(permissionService);

        roleService.deleteRole(20L);
        verify(roleMapper).deleteById(20L);
        verify(permissionService).processRoleDeleted(20L);

        roleService.deleteRoleList(List.of(20L, 21L));
        verify(roleMapper).deleteByIds(List.of(20L, 21L));
        verify(permissionService).processRoleDeleted(21L);
    }

    /** 缺失登录上下文时应 fail-closed 拒绝创建与删除角色。 */
    @Test
    void writeOperationsFailClosedWithoutOperatorContext() {
        SecurityContextHolder.clearContext();
        RoleSaveReqVO createReqVO = new RoleSaveReqVO();
        createReqVO.setName("越权角色");
        createReqVO.setCode("unauth_role");
        createReqVO.setRoleType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());

        ServiceException createEx = assertThrows(ServiceException.class,
                () -> roleService.createRole(createReqVO, RoleTypeEnum.CUSTOM.getType()));
        assertEquals(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED.getCode(), createEx.getCode());

        RoleDO role = customRole(30L, "目标角色");
        when(roleMapper.selectById(30L)).thenReturn(role);
        ServiceException deleteEx = assertThrows(ServiceException.class, () -> roleService.deleteRole(30L));
        assertEquals(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED.getCode(), deleteEx.getCode());
        verify(roleMapper, never()).deleteById(any(Long.class));
    }

    /** 跨平台角色写操作在服务层应直接拒绝，空编号返回角色不存在。 */
    @Test
    void deleteRoleRejectsCrossPlatformAndNullId() {
        RoleDO superRole = customRole(40L, "超管平台角色");
        superRole.setRoleType(AdminPlatformTypeEnum.SUPER_ADMIN.getType());
        when(roleMapper.selectById(40L)).thenReturn(superRole);

        ServiceException crossEx = assertThrows(ServiceException.class, () -> roleService.deleteRole(40L));
        assertEquals(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED.getCode(), crossEx.getCode());

        ServiceException nullEx = assertThrows(ServiceException.class, () -> roleService.deleteRole(null));
        assertEquals(ErrorCodeConstants.ROLE_NOT_EXISTS.getCode(), nullEx.getCode());
    }

    /**
     * 构造自定义可编辑角色样本。
     *
     * @param id   角色编号
     * @param name 角色名称
     * @return 自定义角色对象
     */
    private static RoleDO customRole(Long id, String name) {
        RoleDO role = new RoleDO();
        role.setId(id);
        role.setName(name);
        role.setType(RoleTypeEnum.CUSTOM.getType());
        role.setRoleType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        return role;
    }

}
