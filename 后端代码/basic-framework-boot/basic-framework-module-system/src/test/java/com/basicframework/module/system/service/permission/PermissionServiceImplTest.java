package com.basicframework.module.system.service.permission;

import com.basicframework.framework.common.biz.system.permission.dto.DeptDataPermissionRespDTO;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证部门数据权限计算对“角色未配置数据范围”的处理。
 *
 * <p>{@code system_role.data_scope} 在数据库里是 {@code NOT NULL DEFAULT 1}，因此正常写入路径
 * 造不出空数据范围；但该列历史上由人工脚本与老版本接口维护过，计算逻辑必须按“跳过该角色”
 * 处理，而不是把它当成“可查看全部数据”。用例用手搓角色对象覆盖这条守卫，
 * 并断言既不放行全部数据、也不去查询用户部门。</p>
 *
 * <p><b>白盒直调：</b>{@code getEnableUserRoleListByUserIdFromCache} 是生产代码用
 * {@code @VisibleForTesting} 显式声明的包级接缝，本用例与其同包，用 {@code spy} 打桩返回手搓角色；
 * 用户类型服务用替身注入，避免触达数据库与缓存。</p>
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

}
