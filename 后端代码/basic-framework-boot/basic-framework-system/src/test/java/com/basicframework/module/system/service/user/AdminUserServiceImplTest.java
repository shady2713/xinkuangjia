package com.basicframework.module.system.service.user;

import cn.hutool.crypto.digest.DigestUtil;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptListReqVO;
import com.basicframework.module.system.controller.admin.user.vo.profile.UserProfileUpdatePasswordReqVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserImportExcelVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserImportRespVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserSaveReqVO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.dal.mysql.user.AdminUserMapper;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.logger.LoginLogTypeEnum;
import com.basicframework.module.system.enums.logger.LoginResultEnum;
import com.basicframework.module.system.enums.security.UserTokenInvalidationReasonEnum;
import com.basicframework.module.system.framework.security.audit.SecurityAuditService;
import com.basicframework.module.system.mq.message.user.UserStatusChangedEvent;
import com.basicframework.module.system.mq.message.user.UserTokenInvalidatedEvent;
import com.basicframework.module.system.service.dept.DeptService;
import com.basicframework.module.system.service.permission.PermissionService;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.ApplicationContext;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Set;

import static com.basicframework.module.system.enums.ErrorCodeConstants.PASSWORD_POLICY_NOT_MATCH;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED;
import static com.basicframework.module.system.enums.ErrorCodeConstants.USER_PASSWORD_FAILED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证密码存储格式迁移、首次改密标志和密码策略落点。
 *
 * @author shady
 */
@ExtendWith(MockitoExtension.class)
class AdminUserServiceImplTest {

    /** 使用较低强度加速单测，算法与生产 BCryptPasswordEncoder 一致。 */
    @Spy
    private BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder(4);

    @Mock
    private AdminUserMapper userMapper;
    @Mock
    private DeptService deptService;
    @Mock
    private ObjectProvider<PermissionService> permissionServiceProvider;
    @Mock
    private ApplicationContext applicationContext;
    @Mock
    private SecurityAuditService securityAuditService;

    @InjectMocks
    private AdminUserServiceImpl userService;

    /** 每个用例后清理线程安全上下文，防止认证身份串扰。 */
    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    /** 绑定当前测试线程的已认证操作者上下文。 */
    private static void setOperator(Long operatorId) {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(operatorId);
        loginUser.setUserType(UserTypeEnum.ADMIN.getValue());
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(loginUser, null));
    }

    /** 验证历史 bcrypt(md5(明文)) 能被识别，而当前格式只接受明文。 */
    @Test
    void recognizesLegacyMd5DerivedHash() {
        String encoded = passwordEncoder.encode(DigestUtil.md5Hex("Legacy#Pass1"));

        assertThat(userService.isPasswordMatchLegacy("Legacy#Pass1", encoded)).isTrue();
        assertThat(userService.isPasswordMatch("Legacy#Pass1", encoded)).isFalse();
    }

    /** 验证历史哈希仅以已校验存储值为条件升级，新格式可直接用明文校验。 */
    @Test
    void upgradesLegacyHashToPlainBcrypt() {
        when(userMapper.updatePasswordByIdAndPassword(eq(1L), eq("legacy-hash"), any())).thenReturn(1);

        assertThat(userService.updatePasswordHash(1L, "legacy-hash", "Legacy#Pass1")).isTrue();

        ArgumentCaptor<String> captor = ArgumentCaptor.forClass(String.class);
        verify(userMapper).updatePasswordByIdAndPassword(eq(1L), eq("legacy-hash"), captor.capture());
        assertThat(passwordEncoder.matches("Legacy#Pass1", captor.getValue())).isTrue();
        assertThat(passwordEncoder.matches(DigestUtil.md5Hex("Legacy#Pass1"), captor.getValue())).isFalse();
        verify(userMapper, never()).updateById(any(AdminUserDO.class));
    }

    /** 验证导入时可见范围内同名部门不唯一，按行报告歧义且不创建用户。 */
    @Test
    void importUserReportsAmbiguousDeptName() {
        ReflectionTestUtils.setField(userService, "userInitPassword", "Init#Pass1");
        DeptDO first = new DeptDO();
        first.setId(10L);
        first.setName("研发部");
        DeptDO second = new DeptDO();
        second.setId(11L);
        second.setName("研发部");
        when(deptService.getDeptList(any(DeptListReqVO.class))).thenReturn(List.of(first, second));
        UserImportExcelVO row = new UserImportExcelVO();
        row.setUsername("importuser1");
        row.setNickname("Import User");
        row.setDeptName("研发部");

        UserImportRespVO resp = userService.importUserList(List.of(row), false);

        assertThat(resp.getFailureUsernames().get("importuser1")).contains("多个匹配");
        assertThat(resp.getCreateUsernames()).isEmpty();
        verify(deptService, never()).validateDeptList(any());
        verify(userMapper, never()).insert(any(AdminUserDO.class));
    }

    /** 验证管理员重置密码后置位首次改密标志。 */
    @Test
    void adminResetPasswordSetsChangeRequiredFlag() {
        setOperator(99L);
        PermissionService permissionService = mock(PermissionService.class);
        when(permissionServiceProvider.getIfAvailable()).thenReturn(permissionService);
        when(userMapper.selectById(1L)).thenReturn(buildUser(1L, "super_admin"));

        userService.updateUserPassword(1L, "New#Pass1", "super_admin");

        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).updateById(captor.capture());
        assertThat(captor.getValue().getPasswordChangeRequired()).isTrue();
        assertThat(passwordEncoder.matches("New#Pass1", captor.getValue().getPassword())).isTrue();
        verify(securityAuditService).record(LoginLogTypeEnum.PASSWORD_RESET,
                LoginResultEnum.SUCCESS, 1L, "test-user");
        verify(applicationContext).publishEvent(argThatTokenInvalidated(
                UserTokenInvalidationReasonEnum.PASSWORD_RESET));
    }

    /** 验证短信重置密码后清除首次改密标志。 */
    @Test
    void smsResetPasswordClearsChangeRequiredFlag() {
        when(userMapper.selectById(1L)).thenReturn(buildUser(1L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));

        userService.updateUserPassword(1L, "New#Pass1");

        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).updateById(captor.capture());
        assertThat(captor.getValue().getPasswordChangeRequired()).isFalse();
        verify(securityAuditService).record(LoginLogTypeEnum.PASSWORD_RESET,
                LoginResultEnum.SUCCESS, 1L, "test-user");
        verify(applicationContext).publishEvent(argThatTokenInvalidated(
                UserTokenInvalidationReasonEnum.PASSWORD_RESET));
    }

    /** 验证用户自行修改密码后清除标志，并允许旧密码为历史 md5 哈希。 */
    @Test
    void profilePasswordChangeClearsFlagAndAcceptsLegacyOldPassword() {
        AdminUserDO user = buildUser(1L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        user.setPassword(passwordEncoder.encode(DigestUtil.md5Hex("Old#Pass1")));
        when(userMapper.selectById(1L)).thenReturn(user);
        UserProfileUpdatePasswordReqVO reqVO = new UserProfileUpdatePasswordReqVO();
        reqVO.setOldPassword("Old#Pass1");
        reqVO.setNewPassword("New#Pass1");

        userService.updateUserPassword(1L, reqVO);

        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).updateById(captor.capture());
        assertThat(captor.getValue().getPasswordChangeRequired()).isFalse();
        assertThat(passwordEncoder.matches("New#Pass1", captor.getValue().getPassword())).isTrue();
        verify(securityAuditService).record(LoginLogTypeEnum.PASSWORD_CHANGE,
                LoginResultEnum.SUCCESS, 1L, "test-user");
        verify(applicationContext).publishEvent(argThatTokenInvalidated(
                UserTokenInvalidationReasonEnum.PASSWORD_CHANGED));
    }

    /** 验证新密码不满足策略时不会写入数据库。 */
    @Test
    void profilePasswordChangeRejectsWeakPassword() {
        AdminUserDO user = buildUser(1L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        user.setPassword(passwordEncoder.encode("Old#Pass1"));
        when(userMapper.selectById(1L)).thenReturn(user);
        UserProfileUpdatePasswordReqVO reqVO = new UserProfileUpdatePasswordReqVO();
        reqVO.setOldPassword("Old#Pass1");
        reqVO.setNewPassword("weakpass");

        assertThatThrownBy(() -> userService.updateUserPassword(1L, reqVO))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(PASSWORD_POLICY_NOT_MATCH.getCode()));
        verify(userMapper, never()).updateById(any(AdminUserDO.class));
        verify(securityAuditService).record(LoginLogTypeEnum.PASSWORD_CHANGE,
                LoginResultEnum.PASSWORD_POLICY_REJECTED, 1L, "test-user");
    }

    /** 验证旧密码错误时无法修改密码。 */
    @Test
    void profilePasswordChangeRejectsWrongOldPassword() {
        AdminUserDO user = buildUser(1L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        user.setPassword(passwordEncoder.encode("Old#Pass1"));
        when(userMapper.selectById(1L)).thenReturn(user);
        UserProfileUpdatePasswordReqVO reqVO = new UserProfileUpdatePasswordReqVO();
        reqVO.setOldPassword("Wrong#Pass1");
        reqVO.setNewPassword("New#Pass1");

        assertThatThrownBy(() -> userService.updateUserPassword(1L, reqVO))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(USER_PASSWORD_FAILED.getCode()));
        verify(userMapper, never()).updateById(any(AdminUserDO.class));
        verify(securityAuditService).record(LoginLogTypeEnum.PASSWORD_CHANGE,
                LoginResultEnum.PASSWORD_VERIFY_FAILED, 1L, null);
    }

    /** 验证删除用户后立即发布令牌失效事件。 */
    @Test
    void deleteUserRevokesTokens() {
        setOperator(99L);
        when(userMapper.selectById(1L))
                .thenReturn(buildUser(1L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));
        PermissionService permissionService = mock(PermissionService.class);
        when(permissionServiceProvider.getIfAvailable()).thenReturn(permissionService);
        when(permissionServiceProvider.getObject()).thenReturn(permissionService);

        userService.deleteUser(1L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());

        verify(permissionService).processUserDeleted(1L);
        verify(applicationContext).publishEvent(argThatTokenInvalidated(
                UserTokenInvalidationReasonEnum.USER_DELETED));
    }

    /** 验证管理员创建用户时置位首次改密标志。 */
    @Test
    void createUserSetsChangeRequiredFlag() {
        when(userMapper.selectByUsernameAndUserType("created-user",
                AdminPlatformTypeEnum.SUPER_ADMIN.getType())).thenReturn(null);
        UserSaveReqVO reqVO = new UserSaveReqVO();
        reqVO.setUsername("created-user");
        reqVO.setNickname("Created User");
        reqVO.setPassword("Init#Pass1");

        userService.createUser(reqVO, AdminPlatformTypeEnum.SUPER_ADMIN.getType());

        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).insert(captor.capture());
        assertThat(captor.getValue().getPasswordChangeRequired()).isTrue();
        assertThat(passwordEncoder.matches("Init#Pass1", captor.getValue().getPassword())).isTrue();
    }

    /** 验证更新用户时在当前数据权限范围内校验目标用户可见性，数据权限过滤返回空时拒绝越权更新。 */
    @Test
    void updateUserRejectsInvisibleTargetInDataScope() {
        when(userMapper.selectById(999L)).thenReturn(null);
        UserSaveReqVO reqVO = new UserSaveReqVO();
        reqVO.setId(999L);
        reqVO.setUsername("other-dept-user");
        reqVO.setNickname("Other Dept");

        assertThatThrownBy(() -> userService.updateUser(reqVO, AdminPlatformTypeEnum.SUPER_ADMIN.getType()))
                .isInstanceOf(ServiceException.class);
        verify(userMapper, never()).updateById(any(AdminUserDO.class));
    }

    /** 验证同属 super_admin 平台的普通子管理员无法重置或删除持有 super_admin 角色的超级管理员账号。 */
    @Test
    void nonSuperAdminCannotResetOrDeleteSuperAdminUser() {
        var loginUser = new com.basicframework.framework.security.core.LoginUser();
        loginUser.setId(20L);
        org.springframework.security.core.context.SecurityContextHolder.getContext().setAuthentication(
                new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(loginUser, null));
        try {
            PermissionService permissionService = mock(PermissionService.class);
            when(permissionServiceProvider.getIfAvailable()).thenReturn(permissionService);
            when(permissionService.hasAnyRoles(1L,
                    com.basicframework.module.system.enums.permission.RoleCodeEnum.SUPER_ADMIN.getCode()))
                    .thenReturn(true);
            when(permissionService.hasAnyRoles(20L,
                    com.basicframework.module.system.enums.permission.RoleCodeEnum.SUPER_ADMIN.getCode()))
                    .thenReturn(false);
            when(userMapper.selectById(1L)).thenReturn(buildUser(1L, AdminPlatformTypeEnum.SUPER_ADMIN.getType()));

            assertThatThrownBy(() -> userService.updateUserPassword(
                    1L, "New#Pass1", AdminPlatformTypeEnum.SUPER_ADMIN.getType()))
                    .isInstanceOfSatisfying(ServiceException.class,
                            ex -> assertThat(ex.getCode()).isEqualTo(
                                    com.basicframework.module.system.enums.ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
            assertThatThrownBy(() -> userService.deleteUser(1L, AdminPlatformTypeEnum.SUPER_ADMIN.getType()))
                    .isInstanceOfSatisfying(ServiceException.class,
                            ex -> assertThat(ex.getCode()).isEqualTo(
                                    com.basicframework.module.system.enums.ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
            verify(userMapper, never()).updateById(any(AdminUserDO.class));
            verify(userMapper, never()).deleteById(1L);
        } finally {
            org.springframework.security.core.context.SecurityContextHolder.clearContext();
        }
    }

    /** 验证通过编辑用户接口停用账号时发布状态变更事件，未变更状态时不重复发布。 */
    @Test
    void updateUserPublishesStatusChangedEventOnlyWhenStatusChanges() {
        setOperator(99L);
        PermissionService permissionService = mock(PermissionService.class);
        when(permissionServiceProvider.getIfAvailable()).thenReturn(permissionService);
        AdminUserDO oldUser = buildUser(2L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        oldUser.setStatus(CommonStatusEnum.ENABLE.getStatus());
        when(userMapper.selectById(2L)).thenReturn(oldUser);
        when(userMapper.selectByUsernameAndUserType("test-user",
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType())).thenReturn(oldUser);

        UserSaveReqVO unchangedReq = new UserSaveReqVO();
        unchangedReq.setId(2L);
        unchangedReq.setUsername("test-user");
        unchangedReq.setNickname("Updated Name");
        unchangedReq.setStatus(CommonStatusEnum.ENABLE.getStatus());
        userService.updateUser(unchangedReq, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        verify(applicationContext, never()).publishEvent(any(UserStatusChangedEvent.class));

        UserSaveReqVO disableReq = new UserSaveReqVO();
        disableReq.setId(2L);
        disableReq.setUsername("test-user");
        disableReq.setNickname("Disabled User");
        disableReq.setStatus(CommonStatusEnum.DISABLE.getStatus());
        userService.updateUser(disableReq, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());

        ArgumentCaptor<UserStatusChangedEvent> eventCaptor = ArgumentCaptor.forClass(UserStatusChangedEvent.class);
        verify(applicationContext).publishEvent(eventCaptor.capture());
        assertThat(eventCaptor.getValue().getUserId()).isEqualTo(2L);
        assertThat(eventCaptor.getValue().getUserType()).isEqualTo(UserTypeEnum.ADMIN.getValue());
        assertThat(eventCaptor.getValue().getStatus()).isEqualTo(CommonStatusEnum.DISABLE.getStatus());
    }

    /** 验证用户保存请求对非法状态枚举值的字段校验拒绝生效。 */
    @Test
    void saveReqVoRejectsInvalidStatusEnum() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            Validator validator = factory.getValidator();
            UserSaveReqVO reqVO = new UserSaveReqVO();
            reqVO.setId(2L);
            reqVO.setUsername("valid_user");
            reqVO.setNickname("Valid User");
            reqVO.setStatus(99);

            var violations = validator.validate(reqVO);
            assertThat(violations).anyMatch(v -> "status".equals(v.getPropertyPath().toString()));
        }
    }

    /** 验证缺少认证上下文或权限服务时，受保护账号管理操作默认 fail-closed 拒绝写入。 */
    @Test
    void protectedAccountOperationsFailClosedWithoutPermissionContext() {
        AdminUserDO target = buildUser(1L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(userMapper.selectById(1L)).thenReturn(target);
        when(userMapper.selectByIds(List.of(1L))).thenReturn(List.of(target));
        UserSaveReqVO updateReq = new UserSaveReqVO();
        updateReq.setId(1L);
        updateReq.setUsername("test-user");
        updateReq.setNickname("Updated");

        assertThatThrownBy(() -> userService.updateUser(updateReq, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        assertThatThrownBy(() -> userService.updateUserPassword(
                1L, "New#Pass1", AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        assertThatThrownBy(() -> userService.updateUserStatus(
                1L, CommonStatusEnum.DISABLE.getStatus(), AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        assertThatThrownBy(() -> userService.deleteUser(1L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        assertThatThrownBy(() -> userService.deleteUserList(List.of(1L), AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));

        // 有登录操作者但 PermissionService 不可用时同样拒绝管理其他账号。
        setOperator(20L);
        when(permissionServiceProvider.getIfAvailable()).thenReturn(null);
        assertThatThrownBy(() -> userService.updateUserStatus(
                1L, CommonStatusEnum.DISABLE.getStatus(), AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));
        verify(userMapper, never()).updateById(any(AdminUserDO.class));
        verify(userMapper, never()).deleteById(1L);
    }

    /**
     * 匹配指定原因的令牌失效事件，避免依赖事件对象的其他字段。
     *
     * @param reason 期望的失效原因
     * @return Mockito 参数匹配器
     */
    private static UserTokenInvalidatedEvent argThatTokenInvalidated(UserTokenInvalidationReasonEnum reason) {
        return argThat(event -> event.getReason() == reason);
    }

    /**
     * 构造指定平台类型的用户。
     *
     * @param id 用户编号
     * @param userType 平台类型
     * @return 用户数据
     */
    private static AdminUserDO buildUser(Long id, String userType) {
        AdminUserDO user = new AdminUserDO();
        user.setId(id);
        user.setUsername("test-user");
        user.setUserType(userType);
        return user;
    }
}
