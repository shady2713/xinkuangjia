package com.basicframework.module.system.controller.admin.auth;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.module.system.controller.admin.auth.vo.AuthLoginReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthLoginRespVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthPermissionInfoRespVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthRefreshTokenReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthRegisterReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthResetPasswordReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthShareLoginRespVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthSmsLoginReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthSmsSendReqVO;
import com.basicframework.module.system.dal.dataobject.permission.MenuDO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.permission.MenuTypeEnum;
import com.basicframework.module.system.service.auth.AdminAuthService;
import com.basicframework.module.system.service.permission.MenuService;
import com.basicframework.module.system.service.permission.PermissionService;
import com.basicframework.module.system.service.permission.RoleService;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证管理后台认证接口的委派、权限信息组装与平台隔离契约。
 *
 * <p>该接口是管理端身份入口：登录类方法只做委派与包装，权限信息接口则要按当前平台过滤角色与
 * 菜单，否则另一平台的菜单权限会进入当前会话。用例固定以下可观察行为：登录/注册/短信/重置
 * 口令原样委派；刷新令牌缺少令牌时在控制器层直接拒绝；登录用户不存在时返回空数据而不报错；
 * 权限信息只包含启用且同平台的角色与其菜单。</p>
 *
 * @author shady2713
 */
class AuthControllerTest {

    /** 登录用户编号，权限信息接口按该编号查询。 */
    private static final Long LOGIN_USER_ID = 1024L;

    /** 被测控制器。 */
    private AuthController controller;
    /** 认证服务替身。 */
    private AdminAuthService authService;
    /** 用户服务替身。 */
    private AdminUserService userService;
    /** 角色服务替身。 */
    private RoleService roleService;
    /** 菜单服务替身。 */
    private MenuService menuService;
    /** 权限服务替身。 */
    private PermissionService permissionService;

    /** 为每个用例装配独立控制器与替身。 */
    @BeforeEach
    void setUp() {
        controller = new AuthController();
        authService = mock(AdminAuthService.class);
        userService = mock(AdminUserService.class);
        roleService = mock(RoleService.class);
        menuService = mock(MenuService.class);
        permissionService = mock(PermissionService.class);
        ReflectionTestUtils.setField(controller, "authService", authService);
        ReflectionTestUtils.setField(controller, "userService", userService);
        ReflectionTestUtils.setField(controller, "roleService", roleService);
        ReflectionTestUtils.setField(controller, "menuService", menuService);
        ReflectionTestUtils.setField(controller, "permissionService", permissionService);
    }

    /** 清理安全上下文，避免登录身份泄漏到其他用例。 */
    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    /**
     * 超级管理员入口登录必须原样委派，并包装服务返回的令牌。
     */
    @Test
    void superAdminLoginDelegatesToService() {
        AuthLoginReqVO reqVO = new AuthLoginReqVO();
        AuthLoginRespVO respVO = loginResp("DUMMY-SUPER-ACCESS");
        when(authService.superAdminLogin(reqVO)).thenReturn(respVO);

        CommonResult<AuthLoginRespVO> result = controller.superAdminLogin(reqVO);

        assertThat(result.getCode()).isZero();
        assertThat(result.getData()).isSameAs(respVO);
        verify(authService).superAdminLogin(reqVO);
    }

    /**
     * 旧分享登录入口只透传服务结果，不再在控制器内签发任何身份。
     */
    @Test
    void shareLoginPropagatesServiceResultAndFailure() {
        AuthShareLoginRespVO respVO = new AuthShareLoginRespVO();
        when(authService.shareLogin("legacy-ticket")).thenReturn(respVO);

        assertThat(controller.shareLogin("legacy-ticket").getData()).isSameAs(respVO);

        when(authService.shareLogin("disabled-ticket")).thenThrow(exception(ErrorCodeConstants.AUTH_SHARE_LOGIN_DISABLED));
        assertThatThrownBy(() -> controller.shareLogin("disabled-ticket"))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.AUTH_SHARE_LOGIN_DISABLED.getCode());
    }

    /**
     * 刷新令牌为空时必须在控制器层拒绝，不得把空令牌交给服务层。
     */
    @Test
    void refreshTokenRejectsBlankToken() {
        AuthRefreshTokenReqVO blankReqVO = new AuthRefreshTokenReqVO();
        blankReqVO.setRefreshToken("  ");

        assertThatThrownBy(() -> controller.refreshToken(blankReqVO))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.AUTH_REFRESH_TOKEN_REQUIRED.getCode());
        verify(authService, never()).refreshToken(any());

        AuthRefreshTokenReqVO reqVO = new AuthRefreshTokenReqVO();
        reqVO.setRefreshToken("DUMMY-REFRESH-TOKEN");
        AuthLoginRespVO respVO = loginResp("DUMMY-REFRESHED-ACCESS");
        when(authService.refreshToken("DUMMY-REFRESH-TOKEN")).thenReturn(respVO);

        assertThat(controller.refreshToken(reqVO).getData()).isSameAs(respVO);
    }

    /**
     * 登录用户不存在时权限信息返回空数据，不抛异常也不查询角色。
     */
    @Test
    void getPermissionInfoReturnsEmptyWhenUserMissing() {
        bindLoginUser(LOGIN_USER_ID);
        when(userService.getUser(LOGIN_USER_ID)).thenReturn(null);

        CommonResult<AuthPermissionInfoRespVO> result = controller.getPermissionInfo();

        assertThat(result.getCode()).isZero();
        assertThat(result.getData()).isNull();
        verify(permissionService, never()).getUserRoleIdListByUserId(any());
    }

    /**
     * 登录用户没有任何角色时返回用户信息与空角色、空权限。
     */
    @Test
    void getPermissionInfoReturnsEmptyRolesWhenNoRoleBound() {
        bindLoginUser(LOGIN_USER_ID);
        when(userService.getUser(LOGIN_USER_ID)).thenReturn(user(LOGIN_USER_ID, "probe"));
        when(permissionService.getUserRoleIdListByUserId(LOGIN_USER_ID)).thenReturn(Set.of());

        AuthPermissionInfoRespVO data = controller.getPermissionInfo().getData();

        assertThat(data.getUser().getId()).isEqualTo(LOGIN_USER_ID);
        assertThat(data.getUser().getUsername()).isEqualTo("probe");
        assertThat(data.getRoles()).isEmpty();
        assertThat(data.getPermissions()).isEmpty();
        assertThat(data.getMenus()).isEmpty();
        verify(roleService, never()).getRoleList(any());
    }

    /**
     * 权限信息必须只保留启用且同平台的角色及其同平台菜单。
     */
    @Test
    void getPermissionInfoKeepsEnabledSamePlatformRoleAndMenus() {
        bindLoginUser(LOGIN_USER_ID);
        when(userService.getUser(LOGIN_USER_ID)).thenReturn(user(LOGIN_USER_ID, "probe"));
        when(permissionService.getUserRoleIdListByUserId(LOGIN_USER_ID)).thenReturn(Set.of(1L, 2L, 3L));
        when(roleService.getRoleList(Set.of(1L, 2L, 3L))).thenReturn(List.of(
                role(1L, "ops", AdminPlatformTypeEnum.BUSINESS_ADMIN.getType(), 0),
                role(2L, "disabled", AdminPlatformTypeEnum.BUSINESS_ADMIN.getType(), 1),
                role(3L, "super", AdminPlatformTypeEnum.SUPER_ADMIN.getType(), 0)));
        when(permissionService.getRoleMenuListByRoleId(Set.of(1L))).thenReturn(Set.of(10L, 11L));
        when(menuService.getMenuList(Set.of(10L, 11L))).thenReturn(List.of(
                menu(10L, "system:menu:query", AdminPlatformTypeEnum.BUSINESS_ADMIN.getType(), 1),
                menu(11L, "system:super:query", AdminPlatformTypeEnum.SUPER_ADMIN.getType(), 2)));
        when(menuService.filterDisableMenus(any()))
                .thenAnswer(invocation -> new ArrayList<>(invocation.getArgument(0)));

        AuthPermissionInfoRespVO data = controller.getPermissionInfo().getData();

        assertThat(data.getRoles()).as("只保留启用且同平台的角色").containsExactly("ops");
        assertThat(data.getPermissions()).as("只保留同平台菜单权限").containsExactly("system:menu:query");
        assertThat(data.getMenus()).extracting(AuthPermissionInfoRespVO.MenuVO::getId).containsExactly(10L);
        verify(permissionService).getRoleMenuListByRoleId(Set.of(1L));
    }

    /**
     * 注册接口必须原样委派并包装服务返回的令牌。
     */
    @Test
    void registerDelegatesToService() {
        AuthRegisterReqVO reqVO = new AuthRegisterReqVO();
        AuthLoginRespVO respVO = loginResp("DUMMY-REGISTER-ACCESS");
        when(authService.register(reqVO)).thenReturn(respVO);

        assertThat(controller.register(reqVO).getData()).isSameAs(respVO);
        verify(authService).register(reqVO);
    }

    /**
     * 短信登录接口必须原样委派并包装服务返回的令牌。
     */
    @Test
    void smsLoginDelegatesToService() {
        AuthSmsLoginReqVO reqVO = new AuthSmsLoginReqVO();
        AuthLoginRespVO respVO = loginResp("DUMMY-SMS-ACCESS");
        when(authService.smsLogin(reqVO)).thenReturn(respVO);

        assertThat(controller.smsLogin(reqVO).getData()).isSameAs(respVO);
        verify(authService).smsLogin(reqVO);
    }

    /**
     * 发送登录短信验证码必须委派给认证服务并返回成功标记。
     */
    @Test
    void sendLoginSmsCodeDelegatesToService() {
        AuthSmsSendReqVO reqVO = new AuthSmsSendReqVO();

        CommonResult<Boolean> result = controller.sendLoginSmsCode(reqVO);

        assertThat(result.getData()).isTrue();
        verify(authService).sendSmsCode(reqVO);
    }

    /**
     * 重置口令必须委派给认证服务并返回成功标记。
     */
    @Test
    void resetPasswordDelegatesToService() {
        AuthResetPasswordReqVO reqVO = new AuthResetPasswordReqVO();

        CommonResult<Boolean> result = controller.resetPassword(reqVO);

        assertThat(result.getData()).isTrue();
        verify(authService).resetPassword(reqVO);
    }

    /**
     * 把指定编号的登录用户绑定到安全上下文。
     *
     * @param userId 登录用户编号
     */
    private static void bindLoginUser(Long userId) {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(userId);
        SecurityContextHolder.setContext(SecurityContextHolder.createEmptyContext());
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(loginUser, null));
    }

    /**
     * 构造仅填充断言涉及字段的登录响应。
     *
     * @param accessToken 访问令牌占位值
     * @return 登录响应
     */
    private static AuthLoginRespVO loginResp(String accessToken) {
        AuthLoginRespVO respVO = new AuthLoginRespVO();
        respVO.setUserId(LOGIN_USER_ID);
        respVO.setAccessToken(accessToken);
        return respVO;
    }

    /**
     * 构造仅填充断言涉及字段的用户对象。
     *
     * @param id 用户编号
     * @param username 登录账号
     * @return 用户持久对象
     */
    private static AdminUserDO user(Long id, String username) {
        AdminUserDO user = new AdminUserDO();
        user.setId(id);
        user.setUsername(username);
        user.setUserType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        return user;
    }

    /**
     * 构造角色对象。
     *
     * @param id 角色编号
     * @param code 角色编码
     * @param roleType 角色平台类型
     * @param status 角色状态
     * @return 角色持久对象
     */
    private static RoleDO role(Long id, String code, String roleType, int status) {
        RoleDO role = new RoleDO();
        role.setId(id);
        role.setCode(code);
        role.setRoleType(roleType);
        role.setStatus(status);
        return role;
    }

    /**
     * 构造可进入菜单树的根菜单对象。
     *
     * @param id 菜单编号
     * @param permission 权限标识
     * @param menuType 菜单平台类型
     * @param sort 排序值
     * @return 菜单持久对象
     */
    private static MenuDO menu(Long id, String permission, String menuType, int sort) {
        MenuDO menu = new MenuDO();
        menu.setId(id);
        menu.setName("菜单" + id);
        menu.setPermission(permission);
        menu.setMenuType(menuType);
        menu.setType(MenuTypeEnum.MENU.getType());
        menu.setSort(sort);
        menu.setParentId(0L);
        return menu;
    }

}
