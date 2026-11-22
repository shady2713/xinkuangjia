package com.basicframework.module.system.service.dept;

import com.basicframework.framework.common.biz.system.permission.dto.DeptDataPermissionRespDTO;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptSaveReqVO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.dal.mysql.dept.DeptMapper;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.service.permission.PermissionService;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;
import java.util.Set;

import static com.basicframework.module.system.enums.ErrorCodeConstants.DEPT_EXISTS_USER;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证 {@link DeptServiceImpl} 的根部门创建权限、平台隔离与活跃用户删除阻断逻辑。
 *
 * @author shady2713
 */
@ExtendWith(MockitoExtension.class)
class DeptServiceImplSecurityTest {

    @Mock
    private DeptMapper deptMapper;
    @Mock
    private ObjectProvider<AdminUserService> adminUserServiceProvider;
    @Mock
    private ObjectProvider<PermissionService> permissionServiceProvider;
    @Mock
    private AdminUserService adminUserService;
    @Mock
    private PermissionService permissionService;

    @InjectMocks
    private DeptServiceImpl deptService;

    /** 清理线程安全上下文。 */
    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    /** 验证无全量数据权限的管理员不允许创建顶级根部门。 */
    @Test
    void createDeptRejectsRootDeptForNonAllDataScopeOperator() {
        setLoginUser(20L);
        when(permissionServiceProvider.getIfAvailable()).thenReturn(permissionService);
        DeptDataPermissionRespDTO perm = new DeptDataPermissionRespDTO();
        perm.setAll(false);
        perm.setDeptIds(Set.of(100L));
        when(permissionService.getDeptDataPermission(20L)).thenReturn(perm);

        DeptSaveReqVO reqVO = new DeptSaveReqVO();
        reqVO.setParentId(DeptDO.PARENT_ID_ROOT);
        reqVO.setName("越权根部门");

        assertThatThrownBy(() -> deptService.createDept(reqVO))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        verify(deptMapper, never()).insert(any(DeptDO.class));
    }

    /** 验证部门下仍存在活跃用户时拒绝删除，避免产生孤儿部门归属。 */
    @Test
    void deleteDeptRejectsWhenActiveUsersExist() {
        setLoginUser(20L);
        DeptDO dept = new DeptDO();
        dept.setId(100L);
        dept.setRoleType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(deptMapper.selectById(100L)).thenReturn(dept);
        when(deptMapper.selectCountByParentId(100L)).thenReturn(0L);
        when(adminUserServiceProvider.getIfAvailable()).thenReturn(adminUserService);
        when(adminUserService.getLoginUserTypeOrDefault()).thenReturn(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(adminUserService.getUserListByDeptIds(List.of(100L))).thenReturn(List.of(new AdminUserDO()));

        assertThatThrownBy(() -> deptService.deleteDept(100L))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(DEPT_EXISTS_USER.getCode()));
        verify(deptMapper, never()).deleteById(100L);
    }

    /** 验证跨平台查询部门时被拒绝访问。 */
    @Test
    void getDeptRejectsCrossPlatformAccess() {
        setLoginUser(20L);
        DeptDO superDept = new DeptDO();
        superDept.setId(1L);
        superDept.setRoleType(AdminPlatformTypeEnum.SUPER_ADMIN.getType());
        when(deptMapper.selectById(1L)).thenReturn(superDept);
        when(adminUserServiceProvider.getIfAvailable()).thenReturn(adminUserService);
        when(adminUserService.getLoginUserTypeOrDefault()).thenReturn(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());

        assertThatThrownBy(() -> deptService.getDept(1L))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
    }

    /** 设置当前线程登录用户。 */
    private static void setLoginUser(Long userId) {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(userId);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(loginUser, null));
    }

}
