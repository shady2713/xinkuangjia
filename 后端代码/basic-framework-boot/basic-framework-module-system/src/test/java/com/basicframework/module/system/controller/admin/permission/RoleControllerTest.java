package com.basicframework.module.system.controller.admin.permission;

import cn.hutool.core.bean.BeanUtil;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.module.system.controller.admin.permission.vo.role.RoleSimpleRespVO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.service.permission.RoleService;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 验证角色下拉只返回表单所需字段，不带出数据权限范围。
 *
 * @author shady2713
 */
class RoleControllerTest {

    /**
     * 验证精简列表保留状态供前端禁用停用角色，并丢掉数据范围字段。
     */
    @Test
    void simpleRoleListOmitsDataScope() {
        RoleService roleService = mock(RoleService.class);
        AdminUserService userService = mock(AdminUserService.class);
        RoleController controller = new RoleController();
        ReflectionTestUtils.setField(controller, "roleService", roleService);
        ReflectionTestUtils.setField(controller, "userService", userService);
        when(userService.getLoginUserTypeOrDefault()).thenReturn("admin");
        RoleDO role = new RoleDO();
        role.setId(8L);
        role.setName("审计员");
        role.setSort(1);
        role.setStatus(1);
        role.setDataScope(2);
        role.setDataScopeDeptIds(Set.of(3L));
        when(roleService.getRoleListByRoleType("admin")).thenReturn(new ArrayList<>(List.of(role)));

        CommonResult<List<RoleSimpleRespVO>> result = controller.getSimpleRoleList();

        assertThat(result.getData()).hasSize(1);
        RoleSimpleRespVO simple = result.getData().get(0);
        assertThat(simple.getId()).isEqualTo(8L);
        assertThat(simple.getName()).isEqualTo("审计员");
        assertThat(simple.getStatus()).isEqualTo(1);
        Map<String, Object> payload = BeanUtil.beanToMap(simple);
        assertThat(payload).doesNotContainKey("dataScope");
        assertThat(payload).doesNotContainKey("dataScopeDeptIds");
    }

}
