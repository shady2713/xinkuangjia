package com.basicframework.module.system.controller.admin.user;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.module.system.controller.admin.user.vo.profile.UserProfileRespVO;
import com.basicframework.module.system.controller.admin.user.vo.profile.UserProfileUpdatePasswordReqVO;
import com.basicframework.module.system.controller.admin.user.vo.profile.UserProfileUpdateReqVO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.dal.dataobject.dept.PostDO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.service.dept.DeptService;
import com.basicframework.module.system.service.dept.PostService;
import com.basicframework.module.system.service.permission.PermissionService;
import com.basicframework.module.system.service.permission.RoleService;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证个人中心接口按登录身份聚合资料，并在缺少部门或岗位时跳过查询。
 *
 * <p>个人中心只能读写当前登录用户的数据，用户编号必须取自登录上下文而不是入参，否则任何
 * 登录用户都能改他人资料或口令。资料聚合需要角色、部门与岗位三类关联：部门与岗位缺失时
 * 必须返回 null 而不是发起无意义查询（也不得抛错），这是既有空部门账号的真实形态。</p>
 *
 * @author shady2713
 */
class UserProfileControllerTest {

    /** 测试用登录用户编号。 */
    private static final long LOGIN_USER_ID = 1024L;

    /** 被测 Controller，依赖服务按外部边界替换为替身。 */
    private UserProfileController controller;
    /** 用户服务替身。 */
    private AdminUserService userService;
    /** 部门服务替身。 */
    private DeptService deptService;
    /** 岗位服务替身。 */
    private PostService postService;
    /** 权限服务替身。 */
    private PermissionService permissionService;
    /** 角色服务替身。 */
    private RoleService roleService;

    /** 为每个用例创建独立 Controller 与替身，并绑定登录身份。 */
    @BeforeEach
    void setUp() {
        controller = new UserProfileController();
        userService = mock(AdminUserService.class);
        deptService = mock(DeptService.class);
        postService = mock(PostService.class);
        permissionService = mock(PermissionService.class);
        roleService = mock(RoleService.class);
        ReflectionTestUtils.setField(controller, "userService", userService);
        ReflectionTestUtils.setField(controller, "deptService", deptService);
        ReflectionTestUtils.setField(controller, "postService", postService);
        ReflectionTestUtils.setField(controller, "permissionService", permissionService);
        ReflectionTestUtils.setField(controller, "roleService", roleService);
        bindLoginUser(LOGIN_USER_ID);
    }

    /** 清理安全上下文，避免登录身份泄漏到同 JVM 的其它测试。 */
    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    /** 资料必须按登录身份聚合角色、部门与岗位，并使用真实关联数据。 */
    @Test
    void profileAggregatesRolesDeptAndPosts() {
        AdminUserDO user = user(LOGIN_USER_ID, "张三", 100L, Set.of(1L, 2L));
        when(userService.getUser(LOGIN_USER_ID)).thenReturn(user);
        when(permissionService.getUserRoleIdListByUserId(LOGIN_USER_ID)).thenReturn(Set.of(9L));
        when(roleService.getRoleListFromCache(Set.of(9L))).thenReturn(List.of(role(9L, "超级管理员")));
        when(deptService.getDept(100L)).thenReturn(dept(100L, "研发部"));
        when(postService.getPostList(Set.of(1L, 2L))).thenReturn(List.of(post(1L, "组长"), post(2L, "工程师")));

        CommonResult<UserProfileRespVO> result = controller.getUserProfile();

        assertThat(result.getCode()).isZero();
        UserProfileRespVO profile = result.getData();
        assertThat(profile.getId()).isEqualTo(LOGIN_USER_ID);
        assertThat(profile.getNickname()).isEqualTo("张三");
        assertThat(profile.getRoles()).hasSize(1);
        assertThat(profile.getRoles().get(0).getName()).isEqualTo("超级管理员");
        assertThat(profile.getDept().getId()).isEqualTo(100L);
        assertThat(profile.getDept().getName()).isEqualTo("研发部");
        assertThat(profile.getPosts()).extracting(post -> post.getName())
                .containsExactly("组长", "工程师");
    }

    /** 没有部门与岗位的账号必须返回 null 关联，且不得发起多余查询。 */
    @Test
    void profileSkipsDeptAndPostLookupsWhenAbsent() {
        when(userService.getUser(LOGIN_USER_ID)).thenReturn(user(LOGIN_USER_ID, "无部门用户", null, null));
        when(permissionService.getUserRoleIdListByUserId(LOGIN_USER_ID)).thenReturn(Set.of());

        CommonResult<UserProfileRespVO> result = controller.getUserProfile();

        assertThat(result.getData().getDept()).isNull();
        assertThat(result.getData().getPosts()).isNull();
        verify(deptService, never()).getDept(any());
        verify(postService, never()).getPostList(any());
    }

    /** 修改资料必须使用登录用户编号，返回成功标记。 */
    @Test
    void updateProfileUsesLoginUserId() {
        UserProfileUpdateReqVO reqVO = new UserProfileUpdateReqVO();

        CommonResult<Boolean> result = controller.updateUserProfile(reqVO);

        verify(userService).updateUserProfile(LOGIN_USER_ID, reqVO);
        assertThat(result.getData()).isTrue();
    }

    /** 修改口令必须使用登录用户编号，返回成功标记。 */
    @Test
    void updatePasswordUsesLoginUserId() {
        UserProfileUpdatePasswordReqVO reqVO = new UserProfileUpdatePasswordReqVO();

        CommonResult<Boolean> result = controller.updateUserProfilePassword(reqVO);

        verify(userService).updateUserPassword(LOGIN_USER_ID, reqVO);
        assertThat(result.getData()).isTrue();
    }

    /** 把指定编号的登录用户绑定到安全上下文。 */
    private static void bindLoginUser(Long userId) {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(userId);
        SecurityContextHolder.setContext(SecurityContextHolder.createEmptyContext());
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(loginUser, null));
    }

    /** 构造样例用户。 */
    private static AdminUserDO user(Long id, String nickname, Long deptId, Set<Long> postIds) {
        AdminUserDO user = new AdminUserDO();
        user.setId(id);
        user.setNickname(nickname);
        user.setDeptId(deptId);
        user.setPostIds(postIds);
        return user;
    }

    /** 构造样例角色。 */
    private static RoleDO role(Long id, String name) {
        RoleDO role = new RoleDO();
        role.setId(id);
        role.setName(name);
        return role;
    }

    /** 构造样例部门。 */
    private static DeptDO dept(Long id, String name) {
        DeptDO dept = new DeptDO();
        dept.setId(id);
        dept.setName(name);
        return dept;
    }

    /** 构造样例岗位。 */
    private static PostDO post(Long id, String name) {
        PostDO post = new PostDO();
        post.setId(id);
        post.setName(name);
        return post;
    }
}
