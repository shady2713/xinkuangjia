package com.basicframework.module.system.api.permission;

import com.basicframework.framework.common.biz.system.permission.dto.DeptDataPermissionRespDTO;
import com.basicframework.module.system.service.permission.PermissionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证权限跨模块 API 的转发契约。
 *
 * <p>该实现是纯委托：其它模块经它判断权限、角色与部门数据范围。转发必须保持参数原样
 * （改写参数会让鉴权结论与真实授权不一致）、返回值原样（吞掉 false 会放行未授权操作）、
 * 异常原样传播（把依赖失败当成"无权限"会掩盖故障，当成"有权限"则是越权）。
 * 因此本用例对每个方法都同时锁定参数、返回值与异常三条路径。</p>
 *
 * @author shady2713
 */
class PermissionApiImplTest {

    /** 被测 API 实现。 */
    private PermissionApiImpl permissionApi;
    /** 下游权限服务替身，用于观察真实转发参数。 */
    private PermissionService permissionService;

    /** 为每个用例创建独立 API 与下游替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        permissionApi = new PermissionApiImpl();
        permissionService = mock(PermissionService.class);
        ReflectionTestUtils.setField(permissionApi, "permissionService", permissionService);
    }

    /** 角色编号集合必须原样转发，返回值原样返回。 */
    @Test
    void getUserRoleIdListByRoleIdsForwardsSameCollection() {
        List<Long> roleIds = List.of(1L, 2L);
        Set<Long> expected = Set.of(7L, 8L);
        when(permissionService.getUserRoleIdListByRoleId(roleIds)).thenReturn(expected);

        assertThat(permissionApi.getUserRoleIdListByRoleIds(roleIds)).isSameAs(expected);

        verify(permissionService).getUserRoleIdListByRoleId(roleIds);
        verifyNoMoreInteractions(permissionService);
    }

    /** 权限判定必须原样传递用户编号与权限表达式数组，并原样返回真值。 */
    @Test
    void hasAnyPermissionsForwardsUserIdAndExpressions() {
        when(permissionService.hasAnyPermissions(7L, "system:user:query", "system:user:create")).thenReturn(true);

        assertThat(permissionApi.hasAnyPermissions(7L, "system:user:query", "system:user:create")).isTrue();

        verify(permissionService).hasAnyPermissions(7L, "system:user:query", "system:user:create");
        verifyNoMoreInteractions(permissionService);
    }

    /**
     * 权限判定为假时必须原样返回 false，不得被改写为放行。
     *
     * <p>调用方按返回值决定是否继续；把 false 变成 true 等于放行越权操作。</p>
     */
    @Test
    void hasAnyPermissionsReturnsFalseUnchanged() {
        when(permissionService.hasAnyPermissions(7L, "system:user:query")).thenReturn(false);

        assertThat(permissionApi.hasAnyPermissions(7L, "system:user:query")).isFalse();

        verify(permissionService).hasAnyPermissions(7L, "system:user:query");
    }

    /** 不传权限表达式时按空数组转发，不得变成 null 或跳过调用。 */
    @Test
    void hasAnyPermissionsForwardsEmptyExpressionArray() {
        when(permissionService.hasAnyPermissions(7L)).thenReturn(false);

        assertThat(permissionApi.hasAnyPermissions(7L)).isFalse();

        verify(permissionService).hasAnyPermissions(7L);
    }

    /** 角色判定必须原样传递用户编号与角色编码数组，并原样返回真值。 */
    @Test
    void hasAnyRolesForwardsUserIdAndRoleCodes() {
        when(permissionService.hasAnyRoles(9L, "super_admin")).thenReturn(true);

        assertThat(permissionApi.hasAnyRoles(9L, "super_admin")).isTrue();

        verify(permissionService).hasAnyRoles(9L, "super_admin");
        verifyNoMoreInteractions(permissionService);
    }

    /** 部门数据权限必须原样返回下游对象，不得复制或改写范围。 */
    @Test
    void getDeptDataPermissionReturnsDownstreamObject() {
        DeptDataPermissionRespDTO expected = new DeptDataPermissionRespDTO();
        expected.setAll(true);
        when(permissionService.getDeptDataPermission(7L)).thenReturn(expected);

        assertThat(permissionApi.getDeptDataPermission(7L)).isSameAs(expected);

        verify(permissionService).getDeptDataPermission(7L);
        verifyNoMoreInteractions(permissionService);
    }

    /** 下游返回 null 时必须原样返回，不得伪造空权限对象掩盖数据缺失。 */
    @Test
    void getDeptDataPermissionReturnsNullWhenAbsent() {
        assertThat(permissionApi.getDeptDataPermission(7L)).isNull();

        verify(permissionService).getDeptDataPermission(7L);
    }

    /** 下游异常必须原样传播，不能转成"无权限"而掩盖真实故障。 */
    @Test
    void downstreamFailuresPropagateUnchanged() {
        IllegalStateException failure = new IllegalStateException("synthetic-permission-failure");
        doThrow(failure).when(permissionService).hasAnyPermissions(7L, "system:user:query");

        assertThatThrownBy(() -> permissionApi.hasAnyPermissions(7L, "system:user:query")).isSameAs(failure);
    }
}
