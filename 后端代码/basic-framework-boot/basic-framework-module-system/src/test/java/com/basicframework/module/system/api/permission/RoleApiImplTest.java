package com.basicframework.module.system.api.permission;

import com.basicframework.module.system.service.permission.RoleService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;

/**
 * 验证角色跨模块 API 的有效性校验转发契约。
 *
 * <p>其它模块在写入用户角色、修改菜单授权前调用该入口确认角色可用；实现只做转发，
 * 因此必须锁定：编号集合原样传递（改写会让校验结果与真实写入的角色不一致）、
 * 校验失败原样传播（吞掉异常会把无效角色写入关联表）。</p>
 *
 * @author shady2713
 */
class RoleApiImplTest {

    /** 被测 API 实现。 */
    private RoleApiImpl roleApi;
    /** 下游角色服务替身，用于观察真实转发参数。 */
    private RoleService roleService;

    /** 为每个用例创建独立 API 与下游替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        roleApi = new RoleApiImpl();
        roleService = mock(RoleService.class);
        ReflectionTestUtils.setField(roleApi, "roleService", roleService);
    }

    /** 角色编号集合必须原样转发给角色服务。 */
    @Test
    void validRoleListDelegatesSameIds() {
        List<Long> roleIds = List.of(1L, 2L);

        roleApi.validRoleList(roleIds);

        verify(roleService).validateRoleList(roleIds);
        verifyNoMoreInteractions(roleService);
    }

    /** 校验失败必须原样传播，避免无效角色被写入关联关系。 */
    @Test
    void serviceFailurePropagatesUnchanged() {
        List<Long> roleIds = List.of(99L);
        IllegalStateException failure = new IllegalStateException("synthetic-invalid-role");
        doThrow(failure).when(roleService).validateRoleList(roleIds);

        assertThatThrownBy(() -> roleApi.validRoleList(roleIds)).isSameAs(failure);
    }

}
