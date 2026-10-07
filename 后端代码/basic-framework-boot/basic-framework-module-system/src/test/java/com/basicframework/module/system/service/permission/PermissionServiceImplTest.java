package com.basicframework.module.system.service.permission;

import cn.hutool.extra.spring.SpringUtil;
import com.basicframework.framework.common.biz.system.permission.dto.DeptDataPermissionRespDTO;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.dal.dataobject.permission.UserRoleDO;
import com.basicframework.module.system.dal.mysql.permission.UserRoleMapper;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.permission.DataScopeEnum;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContext;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证部门数据权限计算的角色筛选边界，以及数据范围写入的平台归属边界。
 *
 * <p>{@code system_role.data_scope} 在数据库里是 {@code NOT NULL DEFAULT 1}，因此正常写入路径
 * 造不出空数据范围；但该列历史上由人工脚本与老版本接口维护过，计算逻辑必须按“跳过该角色”
 * 处理，而不是把它当成“可查看全部数据”。用例用手搓角色对象覆盖这条守卫，
 * 并断言既不放行全部数据、也不去查询用户部门。</p>
 *
 * <p>同一组用例还锁定两条不可从结果反推的契约：数据范围写入必须先完成角色平台归属校验，
 * 拒绝路径上不得出现任何写入；启用角色查询只能过滤出启用角色，且不得就地修改共享缓存返回的集合。</p>
 *
 * <p><b>白盒直调：</b>{@code getEnableUserRoleListByUserIdFromCache} 与
 * {@code getDeptDataPermission} 都是生产代码用 {@code @VisibleForTesting} 显式声明的包级接缝，
 * 本用例与其同包；用户类型服务与持久层用替身注入，避免触达数据库与缓存。</p>
 *
 * @author shady2713
 */
class PermissionServiceImplTest {

    /** 被计算数据权限的用户编号。 */
    private static final Long USER_ID = 7L;

    /**
     * 角色数据范围为空时必须跳过该角色：既不放行全部数据，也不查询用户部门。
     *
     * <p>把空值当成“全部数据”会让历史脏数据变成越权读取；而“查询用户部门”本身是数据库与缓存开销，
     * 在没有任何可用数据范围时不应发生。用例同时断言这两点。</p>
     */
    @Test
    void roleWithoutDataScopeIsSkippedWithoutGrantingAll() {
        PermissionServiceImpl service = spy(new PermissionServiceImpl());
        AdminUserService userService = mock(AdminUserService.class);
        when(userService.getUserTypeOrDefault(USER_ID)).thenReturn(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        ReflectionTestUtils.setField(service, "userService", userService);
        doReturn(List.of(machineRoleWithoutDataScope())).when(service)
                .getEnableUserRoleListByUserIdFromCache(USER_ID);

        DeptDataPermissionRespDTO result = service.getDeptDataPermission(USER_ID);

        assertThat(result.getAll()).as("空数据范围不得解释为全部数据").isFalse();
        assertThat(result.getSelf()).as("空数据范围也不等于只看自己").isFalse();
        assertThat(result.getDeptIds()).as("不得追加任何可见部门").isEmpty();
        verify(userService, never()).getUser(anyLong());
    }

    /**
     * 构造一个已启用、同平台但没有数据范围的角色。
     *
     * @return 数据范围为空的角色
     */
    private static RoleDO machineRoleWithoutDataScope() {
        RoleDO role = new RoleDO();
        role.setId(1L);
        role.setCode("probe-role");
        role.setRoleType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        role.setStatus(CommonStatusEnum.ENABLE.getStatus());
        role.setDataScope(null);
        role.setDataScopeDeptIds(Set.of());
        return role;
    }

    /**
     * 分配数据范围必须先校验角色归属：跨平台角色被拒绝时不得写入任何数据范围。
     *
     * <p>{@code system_role.data_scope} 决定该角色的部门可见范围。跨平台角色如果被写入当前平台的
     * 数据范围，本平台管理员就能把一个原本不属于本平台的角色放大成"可见全部部门"，
     * 属于典型的越权提权。写入发生在校验之后，因此拒绝路径上必须完全没有 {@code updateRoleDataScope}
     * 调用——只看异常消息不足以证明没有半途写入。</p>
     */
    @Test
    void assignRoleDataScopeRejectsOtherPlatformRoleWithoutWriting() {
        PermissionServiceImpl service = new PermissionServiceImpl();
        AdminUserService userService = mock(AdminUserService.class);
        RoleService roleService = mock(RoleService.class);
        when(userService.getLoginUserTypeOrDefault()).thenReturn(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(roleService.getRole(5L)).thenReturn(role(5L, AdminPlatformTypeEnum.SUPER_ADMIN.getType()));
        ReflectionTestUtils.setField(service, "roleService", roleService);
        ReflectionTestUtils.setField(service, "userService", userService);

        assertThatThrownBy(() -> service.assignRoleDataScope(5L, DataScopeEnum.DEPT_AND_CHILD.getScope(), Set.of(1L)))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED.getCode());

        verify(roleService, never()).updateRoleDataScope(anyLong(), any(), any());
    }

    /**
     * 角色不存在时同样不得写入，避免把未找到的对象当成授权通过。
     */
    @Test
    void assignRoleDataScopeRejectsMissingRoleWithoutWriting() {
        PermissionServiceImpl service = new PermissionServiceImpl();
        RoleService roleService = mock(RoleService.class);
        when(roleService.getRole(5L)).thenReturn(null);
        ReflectionTestUtils.setField(service, "roleService", roleService);

        assertThatThrownBy(() -> service.assignRoleDataScope(5L, DataScopeEnum.ALL.getScope(), Set.of()))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.ROLE_NOT_EXISTS.getCode());

        verify(roleService, never()).updateRoleDataScope(anyLong(), any(), any());
    }

    /**
     * 同平台角色按调用方给的数据范围与部门编号原样委派，不改写任何一个参数。
     */
    @Test
    void assignRoleDataScopeForwardsArgumentsForSamePlatformRole() {
        PermissionServiceImpl service = new PermissionServiceImpl();
        AdminUserService userService = mock(AdminUserService.class);
        RoleService roleService = mock(RoleService.class);
        when(userService.getLoginUserTypeOrDefault()).thenReturn(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(roleService.getRole(5L)).thenReturn(role(5L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        ReflectionTestUtils.setField(service, "roleService", roleService);
        ReflectionTestUtils.setField(service, "userService", userService);

        service.assignRoleDataScope(5L, DataScopeEnum.DEPT_CUSTOM.getScope(), Set.of(7L, 8L));

        verify(roleService).updateRoleDataScope(5L, DataScopeEnum.DEPT_CUSTOM.getScope(), Set.of(7L, 8L));
    }

    /**
     * 数据权限计算只能看到启用角色，且不得就地修改缓存返回的角色集合。
     *
     * <p>{@code getRoleListFromCache} 返回的是共享缓存对象。若这里用 {@code removeIf} 一类就地过滤，
     * 第一个用户的数据权限计算就会把禁用角色从共享缓存里删掉，之后所有用户都看不到这些角色，
     * 且这种污染不会随缓存过期自行修复。用例既断言结果只剩启用角色，也断言替身返回的集合在调用后
     * 仍然完整，从而把"就地修改"这种写法挡在门外。</p>
     */
    @Test
    void enabledRoleLookupFiltersDisabledRolesWithoutMutatingCachedCollection() {
        PermissionServiceImpl service = new PermissionServiceImpl();
        RoleService roleService = mock(RoleService.class);
        UserRoleMapper userRoleMapper = mock(UserRoleMapper.class);
        when(userRoleMapper.selectListByUserId(USER_ID)).thenReturn(List.of(userRole(1L), userRole(2L)));
        RoleDO enabled = role(1L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        enabled.setStatus(CommonStatusEnum.ENABLE.getStatus());
        RoleDO disabled = role(2L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        disabled.setStatus(CommonStatusEnum.DISABLE.getStatus());
        List<RoleDO> cached = new ArrayList<>(List.of(disabled, enabled));
        when(roleService.getRoleListFromCache(Set.of(1L, 2L))).thenReturn(cached);
        ReflectionTestUtils.setField(service, "roleService", roleService);
        ReflectionTestUtils.setField(service, "userRoleMapper", userRoleMapper);

        List<RoleDO> result = callEnabledRoleLookup(service, USER_ID);

        assertThat(result).as("禁用角色不得参与数据权限计算")
                .extracting(RoleDO::getId).containsExactly(1L);
        assertThat(cached).as("共享缓存返回的集合不得被就地修改")
                .extracting(RoleDO::getId).containsExactly(2L, 1L);
        verify(roleService).getRoleListFromCache(Set.of(1L, 2L));
    }

    /**
     * 通过 {@code SpringUtil} 自代理调用启用角色查询，静态上下文按用例原样恢复。
     *
     * @param service 被测服务
     * @param userId  用户编号
     * @return 过滤后的启用角色列表
     */
    private List<RoleDO> callEnabledRoleLookup(PermissionServiceImpl service, Long userId) {
        Object previousContext = ReflectionTestUtils.getField(SpringUtil.class, "applicationContext");
        Object previousBeanFactory = ReflectionTestUtils.getField(SpringUtil.class, "beanFactory");
        ApplicationContext applicationContext = mock(ApplicationContext.class);
        when(applicationContext.getBean(PermissionServiceImpl.class)).thenReturn(service);
        ReflectionTestUtils.setField(SpringUtil.class, "applicationContext", applicationContext);
        ReflectionTestUtils.setField(SpringUtil.class, "beanFactory", null);
        try {
            return service.getEnableUserRoleListByUserIdFromCache(userId);
        } finally {
            ReflectionTestUtils.setField(SpringUtil.class, "applicationContext", previousContext);
            ReflectionTestUtils.setField(SpringUtil.class, "beanFactory", previousBeanFactory);
        }
    }

    /**
     * 构造指定编号与平台类型的角色对象。
     *
     * @param id       角色编号
     * @param roleType 平台类型
     * @return 角色对象
     */
    private static RoleDO role(Long id, String roleType) {
        RoleDO role = new RoleDO();
        role.setId(id);
        role.setRoleType(roleType);
        return role;
    }

    /**
     * 构造指向指定角色的用户角色关联行。
     *
     * @param roleId 角色编号
     * @return 用户角色关联对象
     */
    private static UserRoleDO userRole(Long roleId) {
        UserRoleDO relation = new UserRoleDO();
        relation.setUserId(USER_ID);
        relation.setRoleId(roleId);
        return relation;
    }

}
