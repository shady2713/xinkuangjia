package com.basicframework.module.system.service.auth;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.module.system.api.sms.SmsCodeApi;
import com.basicframework.module.system.controller.admin.auth.vo.AuthLoginReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthLoginRespVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthSmsLoginReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.oauth2.OAuth2ClientConstants;
import com.basicframework.module.system.framework.security.login.LoginFailureLockService;
import com.basicframework.module.system.service.logger.LoginLogService;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static com.basicframework.module.system.enums.ErrorCodeConstants.AUTH_LOGIN_ACCOUNT_LOCKED;
import static com.basicframework.module.system.enums.ErrorCodeConstants.AUTH_LOGIN_BAD_CREDENTIALS;
import static com.basicframework.module.system.enums.ErrorCodeConstants.AUTH_LOGIN_PLATFORM_MISMATCH;
import static com.basicframework.module.system.enums.ErrorCodeConstants.AUTH_LOGIN_USER_DISABLED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证短信登录复用账号状态和平台隔离规则。
 *
 * @author shady2713
 */
@ExtendWith(MockitoExtension.class)
class AdminAuthServiceImplTest {

    /** 用例手机号。 */
    private static final String MOBILE = "13800000000";
    /** 用例短信验证码。 */
    private static final String SMS_CODE = "1234";

    @Mock
    private AdminUserService userService;
    @Mock
    private LoginLogService loginLogService;
    @Mock
    private OAuth2TokenService oauth2TokenService;
    @Mock
    private SmsCodeApi smsCodeApi;
    @Mock
    private LoginFailureLockService loginFailureLockService;

    @InjectMocks
    private AdminAuthServiceImpl authService;

    /** 验证禁用账号即使短信验证码正确也不能换取访问令牌。 */
    @Test
    void smsLoginRejectsDisabledUser() {
        AdminUserDO user = buildUser("disabled-user", AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        user.setStatus(CommonStatusEnum.DISABLE.getStatus());
        when(userService.getUserByMobile(MOBILE)).thenReturn(user);

        assertThatThrownBy(() -> authService.smsLogin(buildRequest()))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(AUTH_LOGIN_USER_DISABLED.getCode()));
        verifyNoInteractions(oauth2TokenService);
    }

    /** 验证新管理平台账号不能从业务管理平台的短信入口登录。 */
    @Test
    void smsLoginRejectsUserFromAnotherPlatform() {
        AdminUserDO user = buildUser("super-admin-user", AdminPlatformTypeEnum.SUPER_ADMIN.getType());
        user.setStatus(CommonStatusEnum.ENABLE.getStatus());
        when(userService.getUserByMobile(MOBILE)).thenReturn(user);

        assertThatThrownBy(() -> authService.smsLogin(buildRequest()))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(AUTH_LOGIN_PLATFORM_MISMATCH.getCode()));
        verifyNoInteractions(oauth2TokenService);
    }

    /** 验证正常业务管理平台账号可以完成短信登录并取得令牌。 */
    @Test
    void smsLoginCreatesTokenForEnabledBusinessAdmin() {
        AdminUserDO user = buildUser("business-user", AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        user.setStatus(CommonStatusEnum.ENABLE.getStatus());
        when(userService.getUserByMobile(MOBILE)).thenReturn(user);
        OAuth2AccessTokenDO accessToken = new OAuth2AccessTokenDO();
        accessToken.setAccessToken("access-token");
        accessToken.setRefreshToken("refresh-token");
        accessToken.setUserId(user.getId());
        when(oauth2TokenService.createAccessToken(eq(user.getId()),
                eq(UserTypeEnum.ADMIN.getValue()), eq(OAuth2ClientConstants.CLIENT_ID_DEFAULT), isNull()))
                .thenReturn(accessToken);

        AuthLoginRespVO response = authService.smsLogin(buildRequest());

        assertThat(response.getAccessToken()).isEqualTo("access-token");
        assertThat(response.getRefreshToken()).isEqualTo("refresh-token");
        verify(loginLogService).createLoginLog(any());
        verify(userService).updateUserLogin(eq(user.getId()), isNull());
    }

    /** 验证账号处于锁定期时不查询账号和校验密码，只记录锁定日志。 */
    @Test
    void authenticateRejectsLockedAccountBeforeUserLookup() {
        doThrow(com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception(
                AUTH_LOGIN_ACCOUNT_LOCKED, 30L))
                .when(loginFailureLockService).assertNotLocked("locked-user");

        assertThatThrownBy(() -> authService.authenticate("locked-user", "Any#Pass1",
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(AUTH_LOGIN_ACCOUNT_LOCKED.getCode()));
        verify(userService, never()).getUserByUsernameAndType(any(), any());
        verify(loginFailureLockService, never()).recordFailure(any());
    }

    /** 验证账号不存在时仍按账号记录失败次数，避免锁定行为泄露账号存在性。 */
    @Test
    void authenticateRecordsFailureForUnknownUser() {
        when(userService.getUserByUsernameAndType("ghost", AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()))
                .thenReturn(null);

        assertThatThrownBy(() -> authService.authenticate("ghost", "Any#Pass1",
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(AUTH_LOGIN_BAD_CREDENTIALS.getCode()));
        verify(loginFailureLockService).recordFailure("ghost");
        verify(loginFailureLockService, never()).clearFailures(any());
    }

    /** 验证错误密码记录失败次数并返回通用凭据错误。 */
    @Test
    void authenticateRecordsFailureForWrongPassword() {
        AdminUserDO user = buildUser("wrong-password-user", AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        user.setStatus(CommonStatusEnum.ENABLE.getStatus());
        user.setPassword("$2a$04$stored");
        when(userService.getUserByUsernameAndType("wrong-password-user",
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType())).thenReturn(user);
        when(userService.isPasswordMatch("Wrong#Pass1", "$2a$04$stored")).thenReturn(false);
        when(userService.isPasswordMatchLegacy("Wrong#Pass1", "$2a$04$stored")).thenReturn(false);

        assertThatThrownBy(() -> authService.authenticate("wrong-password-user", "Wrong#Pass1",
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(AUTH_LOGIN_BAD_CREDENTIALS.getCode()));
        verify(loginFailureLockService).recordFailure("wrong-password-user");
        verify(loginFailureLockService, never()).clearFailures(any());
    }

    /** 验证历史 bcrypt(md5(明文)) 校验通过后立即升级哈希并清除失败计数。 */
    @Test
    void authenticateUpgradesLegacyPasswordHash() {
        AdminUserDO user = buildUser("legacy-user", AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        user.setStatus(CommonStatusEnum.ENABLE.getStatus());
        user.setPassword("$2a$04$legacy");
        when(userService.getUserByUsernameAndType("legacy-user",
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType())).thenReturn(user);
        when(userService.isPasswordMatch("Legacy#Pass1", "$2a$04$legacy")).thenReturn(false);
        when(userService.isPasswordMatchLegacy("Legacy#Pass1", "$2a$04$legacy")).thenReturn(true);

        AdminUserDO result = authService.authenticate("legacy-user", "Legacy#Pass1",
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());

        assertThat(result).isSameAs(user);
        verify(userService).updatePasswordHash(user.getId(), "Legacy#Pass1");
        verify(loginFailureLockService).clearFailures("legacy-user");
    }

    /** 验证登录响应携带首次改密标志，供前端拦截到修改密码页。 */
    @Test
    void loginResponseIncludesPasswordChangeRequired() {
        authService.setCaptchaEnable(false);
        AdminUserDO user = buildUser("first-login-user", AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        user.setStatus(CommonStatusEnum.ENABLE.getStatus());
        user.setPasswordChangeRequired(true);
        when(userService.getUserByUsernameAndType("first-login-user",
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType())).thenReturn(user);
        when(userService.isPasswordMatch("First#Pass1", null)).thenReturn(true);
        OAuth2AccessTokenDO accessToken = new OAuth2AccessTokenDO();
        accessToken.setAccessToken("access-token");
        accessToken.setRefreshToken("refresh-token");
        accessToken.setUserId(user.getId());
        when(oauth2TokenService.createAccessToken(eq(user.getId()),
                eq(UserTypeEnum.ADMIN.getValue()), eq(OAuth2ClientConstants.CLIENT_ID_DEFAULT), isNull()))
                .thenReturn(accessToken);

        AuthLoginRespVO response = authService.login(AuthLoginReqVO.builder()
                .username("first-login-user").password("First#Pass1").build());

        assertThat(response.getAccessToken()).isEqualTo("access-token");
        assertThat(response.getPasswordChangeRequired()).isTrue();
        verify(userService).updateUserLogin(eq(user.getId()), isNull());
    }

    /**
     * 构造短信登录请求。
     *
     * @return 固定手机号和验证码的请求
     */
    private static AuthSmsLoginReqVO buildRequest() {
        return AuthSmsLoginReqVO.builder().mobile(MOBILE).code(SMS_CODE).build();
    }

    /**
     * 构造指定平台类型的启用用户。
     *
     * @param username 账号
     * @param userType 管理平台类型
     * @return 未持久化的用户数据
     */
    private static AdminUserDO buildUser(String username, String userType) {
        AdminUserDO user = new AdminUserDO();
        user.setId(1024L);
        user.setUsername(username);
        user.setUserType(userType);
        return user;
    }

}
