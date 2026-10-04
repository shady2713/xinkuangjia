package com.basicframework.module.system.controller.admin.permission;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.permission.vo.role.RolePageReqVO;
import com.basicframework.module.system.controller.admin.permission.vo.role.RoleRespVO;
import com.basicframework.module.system.controller.admin.permission.vo.role.RoleSaveReqVO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.service.permission.RoleService;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证角色管理接口的平台归属强制、委派、响应转换与导出限制契约。
 *
 * <p>角色是授权的最小单位，其平台类型决定它属于哪套管理平台。客户端提交的平台类型不可信，
 * 写操作必须以当前登录平台覆盖；读取、修改与删除另一个平台的角色必须被拒绝，否则会出现
 * 跨平台越权授权。用例固定这些可观察行为，并覆盖导出上限与导出文件真实写出。</p>
 *
 * @author shady2713
 */
class RoleControllerTest {

    /** 被测控制器。 */
    private RoleController controller;
    /** 角色服务替身。 */
    private RoleService roleService;
    /** 用户服务替身，同时提供当前登录平台类型。 */
    private AdminUserService userService;

    /** 为每个用例装配独立控制器与替身。 */
    @BeforeEach
    void setUp() {
        controller = new RoleController();
        roleService = mock(RoleService.class);
        userService = mock(AdminUserService.class);
        ReflectionTestUtils.setField(controller, "roleService", roleService);
        ReflectionTestUtils.setField(controller, "userService", userService);
        when(userService.getLoginUserTypeOrDefault()).thenReturn(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
    }

    /**
     * 创建角色必须用当前登录平台覆盖客户端提交的平台类型，并返回新角色编号。
     */
    @Test
    void createRoleOverridesRoleTypeWithLoginPlatform() {
        RoleSaveReqVO reqVO = new RoleSaveReqVO();
        reqVO.setName("运营角色");
        reqVO.setRoleType(AdminPlatformTypeEnum.SUPER_ADMIN.getType());
        when(roleService.createRole(any(), any())).thenReturn(4096L);

        CommonResult<Long> result = controller.createRole(reqVO);

        assertThat(result.getData()).isEqualTo(4096L);
        assertThat(reqVO.getRoleType()).as("平台类型必须由服务端决定")
                .isEqualTo(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        verify(roleService).createRole(reqVO, null);
    }

    /**
     * 更新角色必须先校验平台归属，再覆盖平台类型并委派更新。
     */
    @Test
    void updateRoleValidatesPlatformThenOverridesRoleType() {
        RoleSaveReqVO reqVO = new RoleSaveReqVO();
        reqVO.setId(5L);
        reqVO.setRoleType(AdminPlatformTypeEnum.SUPER_ADMIN.getType());
        when(roleService.getRole(5L)).thenReturn(role(5L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));

        CommonResult<Boolean> result = controller.updateRole(reqVO);

        assertThat(result.getData()).isTrue();
        assertThat(reqVO.getRoleType()).isEqualTo(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        verify(roleService).updateRole(reqVO);
    }

    /**
     * 更新另一个平台的角色必须拒绝，且不得触发更新。
     */
    @Test
    void updateRoleRejectsOtherPlatformRole() {
        RoleSaveReqVO reqVO = new RoleSaveReqVO();
        reqVO.setId(5L);
        when(roleService.getRole(5L)).thenReturn(role(5L, AdminPlatformTypeEnum.SUPER_ADMIN.getType()));

        assertThatThrownBy(() -> controller.updateRole(reqVO))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
        verify(roleService, never()).updateRole(any());
    }

    /**
     * 删除单个角色必须先校验平台归属再删除。
     */
    @Test
    void deleteRoleValidatesPlatformThenDeletes() {
        when(roleService.getRole(5L)).thenReturn(role(5L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));

        CommonResult<Boolean> result = controller.deleteRole(5L);

        assertThat(result.getData()).isTrue();
        verify(roleService).deleteRole(5L);
    }

    /**
     * 批量删除必须逐个校验平台归属，任一角色越权时整批都不执行。
     */
    @Test
    void deleteRoleListValidatesEveryRoleBeforeDeleting() {
        when(roleService.getRole(5L)).thenReturn(role(5L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        when(roleService.getRole(6L)).thenReturn(role(6L, AdminPlatformTypeEnum.SUPER_ADMIN.getType()));

        assertThatThrownBy(() -> controller.deleteRoleList(List.of(5L, 6L)))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
        verify(roleService, never()).deleteRoleList(any());

        when(roleService.getRole(6L)).thenReturn(role(6L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        assertThat(controller.deleteRoleList(List.of(5L, 6L)).getData()).isTrue();
        verify(roleService).deleteRoleList(List.of(5L, 6L));
    }

    /**
     * 单条查询必须校验平台归属并转换为响应模型。
     */
    @Test
    void getRoleConvertsRecordAndValidatesPlatform() {
        RoleDO role = role(5L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        role.setName("运营角色");
        role.setCode("ops");
        role.setSort(3);
        when(roleService.getRole(5L)).thenReturn(role);

        CommonResult<RoleRespVO> result = controller.getRole(5L);

        assertThat(result.getData().getId()).isEqualTo(5L);
        assertThat(result.getData().getName()).isEqualTo("运营角色");
        assertThat(result.getData().getCode()).isEqualTo("ops");
        assertThat(result.getData().getSort()).isEqualTo(3);
    }

    /**
     * 分页查询必须把当前平台类型写入查询条件，并保留总数。
     */
    @Test
    void getRolePageScopesPlatformAndKeepsTotal() {
        RolePageReqVO pageReqVO = new RolePageReqVO();
        RoleDO role = role(5L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        role.setName("运营角色");
        when(roleService.getRolePage(any())).thenReturn(new PageResult<>(List.of(role), 11L));

        CommonResult<PageResult<RoleRespVO>> result = controller.getRolePage(pageReqVO);

        assertThat(pageReqVO.getRoleType()).as("查询必须限定当前平台")
                .isEqualTo(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        assertThat(result.getData().getTotal()).isEqualTo(11L);
        assertThat(result.getData().getList()).extracting(RoleRespVO::getName).containsExactly("运营角色");
    }

    /**
     * 导出必须改写分页口径为最大导出行数，并写出真实 Excel 附件。
     */
    @Test
    void exportWritesExcelWithExportPaging() throws Exception {
        RolePageReqVO reqVO = new RolePageReqVO();
        RoleDO role = role(5L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        role.setName("运营角色");
        when(roleService.getRolePage(any())).thenReturn(new PageResult<>(List.of(role), 1L));
        MockHttpServletResponse response = new MockHttpServletResponse();

        controller.export(response, reqVO);

        assertThat(reqVO.getPageNo()).isEqualTo(1);
        assertThat(reqVO.getPageSize()).isEqualTo(10_000);
        assertThat(reqVO.getRoleType()).isEqualTo(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        assertThat(response.getContentType()).isEqualTo("application/vnd.ms-excel;charset=UTF-8");
        assertThat(response.getHeader("Content-Disposition")).contains("attachment");
        assertThat(response.getContentAsByteArray()).as("必须写出真实 Excel 内容").isNotEmpty();
    }

    /**
     * 导出结果超过上限时必须拒绝生成文件，避免输出不完整数据。
     */
    @Test
    void exportRejectsResultOverLimit() {
        when(roleService.getRolePage(any())).thenReturn(new PageResult<>(List.of(), 10_001L));
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThatThrownBy(() -> controller.export(response, new RolePageReqVO()))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.SYSTEM_EXPORT_SIZE_EXCEEDED.getCode());
        assertThat(response.getContentAsByteArray()).isEmpty();
    }

    /**
     * 构造仅填充平台字段的角色对象。
     *
     * @param id 角色编号
     * @param roleType 角色平台类型
     * @return 角色持久对象
     */
    private static RoleDO role(Long id, String roleType) {
        RoleDO role = new RoleDO();
        role.setId(id);
        role.setRoleType(roleType);
        return role;
    }

}
