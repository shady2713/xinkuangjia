package com.basicframework.module.system.controller.admin.oauth2;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.basicframework.module.system.controller.admin.oauth2.vo.user.OAuth2UserInfoRespVO;
import com.basicframework.module.system.controller.admin.oauth2.vo.user.OAuth2UserUpdateReqVO;
import com.basicframework.module.system.controller.admin.user.vo.profile.UserProfileUpdateReqVO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.dal.dataobject.dept.PostDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.service.dept.DeptService;
import com.basicframework.module.system.service.dept.PostService;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证 OAuth2 用户信息入口的字段组装与资料更新委派契约。
 *
 * <p>该入口供第三方应用读取当前授权用户：身份必须来自认证上下文而不是请求参数，
 * 否则任意应用都能读取他人资料。部门与岗位按需补充，用户未设置部门或岗位时不得返回空对象，
 * 否则前端会渲染出空部门；部门被删除时保持不返回部门而不是返回错误数据。</p>
 *
 * <p>更新入口必须把请求模型转换为个人资料更新模型并交给用户服务，且不得顺手带上请求里没有的字段。</p>
 *
 * @author shady2713
 */
class OAuth2UserControllerTest {

    /** 被测控制器。 */
    private final OAuth2UserController controller = new OAuth2UserController();

    /** 用户服务替身。 */
    private final AdminUserService userService = mock(AdminUserService.class);
    /** 部门服务替身。 */
    private final DeptService deptService = mock(DeptService.class);
    /** 岗位服务替身。 */
    private final PostService postService = mock(PostService.class);

    /** 清理安全上下文，避免登录用户状态跨用例残留。 */
    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    /** 已设置部门与岗位时补充对应信息，身份取自认证上下文。 */
    @Test
    void userInfoFillsDeptAndPostsFromLoginIdentity() {
        injectDependencies(1L);
        AdminUserDO user = user(1L, "张三", 10L, Set.of(2L, 3L));
        when(userService.getUser(1L)).thenReturn(user);
        when(deptService.getDept(10L)).thenReturn(dept(10L, "研发部"));
        when(postService.getPostList(Set.of(2L, 3L)))
                .thenReturn(List.of(post(2L, "研发岗"), post(3L, "测试岗")));

        CommonResult<OAuth2UserInfoRespVO> result = controller.getUserInfo();

        assertThat(result.getData().getNickname()).isEqualTo("张三");
        assertThat(result.getData().getDept()).isNotNull();
        assertThat(result.getData().getDept().getName()).isEqualTo("研发部");
        assertThat(result.getData().getPosts()).extracting(OAuth2UserInfoRespVO.Post::getName)
                .containsExactly("研发岗", "测试岗");
        verify(userService).getUser(1L);
    }

    /** 未设置部门与岗位时不返回空对象，也不查询部门与岗位服务。 */
    @Test
    void userInfoSkipsDeptAndPostsWhenAbsent() {
        injectDependencies(1L);
        when(userService.getUser(1L)).thenReturn(user(1L, "李四", null, null));

        CommonResult<OAuth2UserInfoRespVO> result = controller.getUserInfo();

        assertThat(result.getData().getDept()).isNull();
        assertThat(result.getData().getPosts()).isNull();
        verify(deptService, never()).getDept(any());
        verify(postService, never()).getPostList(any());
    }

    /** 部门已被删除时保持不返回部门，不能返回带编号的空部门。 */
    @Test
    void userInfoLeavesDeptEmptyWhenDeptDeleted() {
        injectDependencies(1L);
        when(userService.getUser(1L)).thenReturn(user(1L, "王五", 99L, null));
        when(deptService.getDept(99L)).thenReturn(null);

        assertThat(controller.getUserInfo().getData().getDept()).isNull();
    }

    /** 资料更新按登录身份委派，并只带上请求中出现的字段。 */
    @Test
    void updateUserInfoConvertsRequestAndUsesLoginIdentity() {
        injectDependencies(7L);
        OAuth2UserUpdateReqVO reqVO = new OAuth2UserUpdateReqVO();
        reqVO.setNickname("赵六");
        reqVO.setEmail("zhaoliu@example.test");
        reqVO.setMobile("13900000000");
        reqVO.setSex(1);

        CommonResult<Boolean> result = controller.updateUserInfo(reqVO);

        assertThat(result.getData()).isTrue();
        ArgumentCaptor<UserProfileUpdateReqVO> captor = ArgumentCaptor.forClass(UserProfileUpdateReqVO.class);
        verify(userService).updateUserProfile(eq(7L), captor.capture());
        UserProfileUpdateReqVO update = captor.getValue();
        assertThat(update.getNickname()).isEqualTo("赵六");
        assertThat(update.getEmail()).isEqualTo("zhaoliu@example.test");
        assertThat(update.getMobile()).isEqualTo("13900000000");
        assertThat(update.getSex()).isEqualTo(1);
        assertThat(update.getAvatar()).as("请求模型没有头像字段，转换后必须保持未提供").isNull();
    }

    /** 注入服务替身并登记登录用户。 */
    private void injectDependencies(Long loginUserId) {
        ReflectionTestUtils.setField(controller, "userService", userService);
        ReflectionTestUtils.setField(controller, "deptService", deptService);
        ReflectionTestUtils.setField(controller, "postService", postService);
        SecurityFrameworkUtils.setLoginUser(new LoginUser().setId(loginUserId).setUserType(1),
                new MockHttpServletRequest());
    }

    /**
     * 构造管理员用户记录。
     *
     * @param id 用户编号
     * @param nickname 昵称
     * @param deptId 部门编号，可为 null
     * @param postIds 岗位编号集合，可为 null
     * @return 用户记录
     */
    private static AdminUserDO user(Long id, String nickname, Long deptId, Set<Long> postIds) {
        AdminUserDO user = new AdminUserDO();
        user.setId(id);
        user.setNickname(nickname);
        user.setDeptId(deptId);
        user.setPostIds(postIds);
        user.setStatus(0);
        return user;
    }

    /**
     * 构造部门记录。
     *
     * @param id 部门编号
     * @param name 部门名称
     * @return 部门记录
     */
    private static DeptDO dept(Long id, String name) {
        DeptDO dept = new DeptDO();
        dept.setId(id);
        dept.setName(name);
        return dept;
    }

    /**
     * 构造岗位记录。
     *
     * @param id 岗位编号
     * @param name 岗位名称
     * @return 岗位记录
     */
    private static PostDO post(Long id, String name) {
        PostDO post = new PostDO();
        post.setId(id);
        post.setName(name);
        return post;
    }

}
