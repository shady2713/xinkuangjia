package com.basicframework.module.system.api.user;

import com.basicframework.module.system.api.user.dto.AdminUserRespDTO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.service.dept.DeptService;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证用户 API 实现的转换、下级用户范围计算与委派契约。
 *
 * <p>该 API 是跨模块读取用户的唯一入口：返回值必须是与持久对象解耦的 DTO；"我负责的用户"必须
 * 包含自己负责部门及其子部门下的用户、并排除本人，范围算错会让负责人看到不该看到的用户或漏掉下级；
 * 依据编号批量查询必须忽略数据权限（这些调用是数据拼接，不是列表浏览）。用例用替身服务记录真实调用参数，
 * 并断言返回的 DTO 内容与范围。</p>
 *
 * @author shady2713
 */
class AdminUserApiImplTest {

    /** 被测 API 实现。 */
    private AdminUserApiImpl adminUserApi;
    /** 用户服务替身。 */
    private AdminUserService userService;
    /** 部门服务替身。 */
    private DeptService deptService;

    /** 为每个用例装配独立实现与替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        adminUserApi = new AdminUserApiImpl();
        userService = mock(AdminUserService.class);
        deptService = mock(DeptService.class);
        ReflectionTestUtils.setField(adminUserApi, "userService", userService);
        ReflectionTestUtils.setField(adminUserApi, "deptService", deptService);
    }

    /** 单条用户查询必须转换为 DTO，并在用户不存在时返回 null。 */
    @Test
    void getUserConvertsToDto() {
        when(userService.getUser(1L)).thenReturn(user(1L, "DUMMY-张三", "13800000001", 10L));

        AdminUserRespDTO dto = adminUserApi.getUser(1L);

        assertThat(dto.getId()).isEqualTo(1L);
        assertThat(dto.getNickname()).isEqualTo("DUMMY-张三");
        assertThat(dto.getDeptId()).isEqualTo(10L);
        assertThat(adminUserApi.getUser(2L)).as("用户不存在时必须返回 null").isNull();
    }

    /** 没有负责部门时下级用户列表必须为空，且不得继续查询用户。 */
    @Test
    void getUserListBySubordinateReturnsEmptyWithoutDept() {
        when(deptService.getDeptListByLeaderUserId(7L)).thenReturn(List.of());

        assertThat(adminUserApi.getUserListBySubordinate(7L)).isEmpty();
        verify(userService, never()).getUserListByDeptIds(any());
    }

    /** 下级用户范围必须包含负责部门与子部门，并排除本人。 */
    @Test
    void getUserListBySubordinateIncludesChildDeptsAndExcludesSelf() {
        when(deptService.getDeptListByLeaderUserId(7L)).thenReturn(List.of(dept(10L, "研发部")));
        when(deptService.getChildDeptList(Set.of(10L))).thenReturn(List.of(dept(11L, "前端组")));
        when(userService.getUserListByDeptIds(any())).thenReturn(new ArrayList<>(List.of(
                user(7L, "DUMMY-负责人", "13800000007", 10L),
                user(8L, "DUMMY-下级", "13800000008", 11L))));

        List<AdminUserRespDTO> result = adminUserApi.getUserListBySubordinate(7L);

        assertThat(result).extracting(AdminUserRespDTO::getId).as("必须排除负责人本人").containsExactly(8L);
        verify(userService).getUserListByDeptIds(argThatContainsAll(10L, 11L));
    }

    /** 依据编号列表查询必须委派用户服务并转换为 DTO。 */
    @Test
    void getUserListConvertsSpecifiedIds() {
        when(userService.getUserList(List.of(1L, 2L))).thenReturn(List.of(
                user(1L, "DUMMY-甲", "13800000011", 10L),
                user(2L, "DUMMY-乙", "13800000012", 10L)));

        List<AdminUserRespDTO> result = adminUserApi.getUserList(List.of(1L, 2L));

        assertThat(result).extracting(AdminUserRespDTO::getNickname).containsExactly("DUMMY-甲", "DUMMY-乙");
        verify(userService).getUserList(List.of(1L, 2L));
    }

    /** 按部门与岗位查询以及批量校验必须原样委派给用户服务。 */
    @Test
    void deptPostAndValidationQueriesDelegate() {
        when(userService.getUserListByDeptIds(List.of(10L))).thenReturn(List.of(user(3L, "DUMMY-丙", "13800000013", 10L)));
        when(userService.getUserListByPostIds(List.of(20L))).thenReturn(List.of(user(4L, "DUMMY-丁", "13800000014", 10L)));

        assertThat(adminUserApi.getUserListByDeptIds(List.of(10L))).extracting(AdminUserRespDTO::getId)
                .containsExactly(3L);
        assertThat(adminUserApi.getUserListByPostIds(List.of(20L))).extracting(AdminUserRespDTO::getId)
                .containsExactly(4L);
        adminUserApi.validateUserList(List.of(1L, 2L));
        verify(userService).validateUserList(List.of(1L, 2L));
    }

    /**
     * 断言下传给用户服务的部门编号集合包含指定编号。
     *
     * @param expectedIds 期望包含的部门编号
     * @return 匹配器
     */
    private static java.util.Collection<Long> argThatContainsAll(Long... expectedIds) {
        return org.mockito.ArgumentMatchers.argThat(ids -> ids != null && ids.containsAll(List.of(expectedIds)));
    }

    /**
     * 构造用户持久对象。
     *
     * @param id 编号
     * @param nickname 昵称
     * @param mobile 手机号
     * @param deptId 部门编号
     * @return 用户持久对象
     */
    private static AdminUserDO user(Long id, String nickname, String mobile, Long deptId) {
        AdminUserDO user = new AdminUserDO();
        user.setId(id);
        user.setNickname(nickname);
        user.setMobile(mobile);
        user.setDeptId(deptId);
        return user;
    }

    /**
     * 构造部门持久对象。
     *
     * @param id 编号
     * @param name 名称
     * @return 部门持久对象
     */
    private static DeptDO dept(Long id, String name) {
        DeptDO dept = new DeptDO();
        dept.setId(id);
        dept.setName(name);
        return dept;
    }

}
