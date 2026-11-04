package com.basicframework.module.system.service.auth;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.module.system.api.sms.SmsCodeApi;
import com.basicframework.module.system.controller.admin.auth.vo.AuthLoginRespVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthSmsLoginReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.oauth2.OAuth2ClientConstants;
import com.basicframework.module.system.service.logger.LoginLogService;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static com.basicframework.module.system.enums.ErrorCodeConstants.AUTH_LOGIN_PLATFORM_MISMATCH;
import static com.basicframework.module.system.enums.ErrorCodeConstants.AUTH_LOGIN_USER_DISABLED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
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
