package com.basicframework.module.system.service.auth;

import com.anji.captcha.model.common.ResponseModel;
import com.anji.captcha.service.CaptchaService;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.module.system.api.logger.dto.LoginLogCreateReqDTO;
import com.basicframework.module.system.api.sms.SmsCodeApi;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeSendReqDTO;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeUseReqDTO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthLoginReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthRegisterReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthResetPasswordReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthSmsSendReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.logger.LoginLogTypeEnum;
import com.basicframework.module.system.enums.logger.LoginResultEnum;
import com.basicframework.module.system.enums.sms.SmsSceneEnum;
import com.basicframework.module.system.framework.auth.config.AdminAuthenticationProperties;
import com.basicframework.module.system.service.logger.LoginLogService;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import com.basicframework.module.system.service.user.AdminUserService;
import jakarta.validation.Validator;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证管理端认证服务的平台隔离、验证码校验、短信发送、口令重置与登出审计契约。
 *
 * <p>该服务是管理端身份的唯一入口，几条边界直接决定安全结果：跨平台账号不得登录、被禁用账号
 * 必须在密码校验通过后仍被拒绝、短信发送入口不得通过响应差异枚举账号状态、短信验证码消费必须
 * 与改密在同一身份上完成、登出必须按令牌归属写审计。用例用替身隔离持久层与外部服务，断言真实
 * 抛出的业务错误码、审计记录内容与外部调用的参数。</p>
 *
 * @author shady2713
 */
class AdminAuthServiceImplTest {

    /** 客户端远端地址，用于断言短信限流身份的取值来源。 */
    private static final String CLIENT_IP = "192.0.2.10";
    /** 测试用手机号占位值。 */
    private static final String MOBILE = "DUMMY-MOBILE";
    /** 测试用口令占位值。 */
    private static final String PASSWORD = "CHANGE_ME_PASSWORD";

    /** 被测服务。 */
    private AdminAuthServiceImpl service;
    /** 用户服务替身。 */
    private AdminUserService userService;
    /** 登录日志服务替身。 */
    private LoginLogService loginLogService;
    /** 令牌服务替身。 */
    private OAuth2TokenService oauth2TokenService;
    /** 短信验证码 API 替身。 */
    private SmsCodeApi smsCodeApi;
    /** 图形验证码服务替身。 */
    private CaptchaService captchaService;
    /** 注册开关配置替身。 */
    private AdminAuthenticationProperties authenticationProperties;

    /** 为每个用例装配独立服务与替身，并默认关闭图形验证码以聚焦被测分支。 */
    @BeforeEach
    void setUp() {
        service = new AdminAuthServiceImpl();
        userService = mock(AdminUserService.class);
        loginLogService = mock(LoginLogService.class);
        oauth2TokenService = mock(OAuth2TokenService.class);
        smsCodeApi = mock(SmsCodeApi.class);
        captchaService = mock(CaptchaService.class);
        authenticationProperties = mock(AdminAuthenticationProperties.class);
        ReflectionTestUtils.setField(service, "userService", userService);
        ReflectionTestUtils.setField(service, "loginLogService", loginLogService);
        ReflectionTestUtils.setField(service, "oauth2TokenService", oauth2TokenService);
        ReflectionTestUtils.setField(service, "smsCodeApi", smsCodeApi);
        ReflectionTestUtils.setField(service, "captchaService", captchaService);
        ReflectionTestUtils.setField(service, "authenticationProperties", authenticationProperties);
        ReflectionTestUtils.setField(service, "validator", mock(Validator.class));
        service.setCaptchaEnable(false);
    }

    /** 清理请求上下文，避免远端地址在用例之间泄漏。 */
    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    /**
     * 密码校验通过但账号被禁用时必须以"账号被禁用"拒绝，并写入对应用户的失败审计。
     */
    @Test
    void authenticateRejectsDisabledUser() {
        AdminUserDO user = user(1L, "probe", AdminPlatformTypeEnum.BUSINESS_ADMIN.getType(),
                CommonStatusEnum.DISABLE.getStatus());
        when(userService.getUserByUsernameAndType("probe", AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()))
                .thenReturn(user);
        when(userService.lockUser(1L)).thenReturn(user);
        when(userService.isPasswordMatch(PASSWORD, "DUMMY-PASSWORD-HASH")).thenReturn(true);

        assertThatThrownBy(() -> service.authenticate("probe", PASSWORD))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.AUTH_LOGIN_USER_DISABLED.getCode());

        ArgumentCaptor<LoginLogCreateReqDTO> log = ArgumentCaptor.forClass(LoginLogCreateReqDTO.class);
        verify(loginLogService).createLoginFailureLog(log.capture());
        assertThat(log.getValue().getUserId()).isEqualTo(1L);
        assertThat(log.getValue().getLogType()).isEqualTo(LoginLogTypeEnum.LOGIN_USERNAME.getType());
        assertThat(log.getValue().getResult()).isEqualTo(LoginResultEnum.USER_DISABLED.getResult());
    }

    /**
     * 认证环节返回了跨平台账号时，登录入口必须按"账号密码不正确"拒绝并记录失败审计。
     *
     * <p>该校验与 {@code authenticate} 内的平台判断重复，正常链路下不会触发；用替身让认证环节
     * 返回跨平台用户，验证登录入口自身仍具备拒绝能力（防御性校验），且对外不暴露平台差异。</p>
     */
    @Test
    void loginRejectsUserFromAnotherPlatform() {
        AdminAuthServiceImpl spiedService = spy(service);
        AdminUserDO mismatch = user(1L, "probe", AdminPlatformTypeEnum.SUPER_ADMIN.getType(),
                CommonStatusEnum.ENABLE.getStatus());
        doReturn(mismatch).when(spiedService).authenticate("probe", PASSWORD,
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        AuthLoginReqVO reqVO = new AuthLoginReqVO();
        reqVO.setUsername("probe");
        reqVO.setPassword(PASSWORD);

        assertThatThrownBy(() -> spiedService.login(reqVO))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.AUTH_LOGIN_PLATFORM_MISMATCH.getCode());

        ArgumentCaptor<LoginLogCreateReqDTO> log = ArgumentCaptor.forClass(LoginLogCreateReqDTO.class);
        verify(loginLogService).createLoginFailureLog(log.capture());
        assertThat(log.getValue().getUserId()).isEqualTo(1L);
        assertThat(log.getValue().getResult()).isEqualTo(LoginResultEnum.BAD_CREDENTIALS.getResult());
    }

    /**
     * 图形验证码校验失败时登录必须拒绝，并记录验证码错误类型的失败审计。
     */
    @Test
    void loginRejectsFailedCaptcha() {
        service.setCaptchaEnable(true);
        when(captchaService.verification(any())).thenReturn(ResponseModel.errorMsg("验证码错误"));
        AuthLoginReqVO reqVO = new AuthLoginReqVO();
        reqVO.setUsername("probe");
        reqVO.setPassword(PASSWORD);

        assertThatThrownBy(() -> service.login(reqVO))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.AUTH_LOGIN_CAPTCHA_CODE_ERROR.getCode());

        ArgumentCaptor<LoginLogCreateReqDTO> log = ArgumentCaptor.forClass(LoginLogCreateReqDTO.class);
        verify(loginLogService).createLoginFailureLog(log.capture());
        assertThat(log.getValue().getUserId()).as("验证码阶段尚无用户身份").isNull();
        assertThat(log.getValue().getUsername()).isEqualTo("probe");
        assertThat(log.getValue().getResult()).isEqualTo(LoginResultEnum.CAPTCHA_CODE_ERROR.getResult());
        verify(userService, never()).getUserByUsernameAndType(any(), any());
    }

    /**
     * 开放注册已开启但图形验证码校验失败时，注册入口必须拒绝且不建号。
     */
    @Test
    void registerRejectsFailedCaptchaWhenRegistrationEnabled() {
        service.setCaptchaEnable(true);
        when(authenticationProperties.isRegistrationEnabled()).thenReturn(true);
        when(captchaService.verification(any())).thenReturn(ResponseModel.errorMsg("验证码错误"));
        AuthRegisterReqVO reqVO = new AuthRegisterReqVO();
        reqVO.setUsername("probe");
        reqVO.setPassword(PASSWORD);

        assertThatThrownBy(() -> service.register(reqVO))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.AUTH_REGISTER_CAPTCHA_CODE_ERROR.getCode());
        verify(userService, never()).registerUser(any());
    }

    /**
     * 短信发送场景不在登录与重置口令范围内时必须拒绝，且不得调用短信服务。
     */
    @Test
    void sendSmsCodeRejectsUnsupportedScene() {
        AuthSmsSendReqVO reqVO = smsReqVO(999);

        assertThatThrownBy(() -> service.sendSmsCode(reqVO))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.SMS_CODE_NOT_FOUND.getCode());
        verifyNoInteractions(smsCodeApi);
    }

    /**
     * 重置口令场景必须额外校验图形验证码，失败时拒绝且不发送短信。
     */
    @Test
    void sendSmsCodeRejectsFailedCaptchaForResetPassword() {
        service.setCaptchaEnable(true);
        when(captchaService.verification(any())).thenReturn(ResponseModel.errorMsg("验证码错误"));
        AuthSmsSendReqVO reqVO = smsReqVO(SmsSceneEnum.ADMIN_MEMBER_RESET_PASSWORD.getScene());

        assertThatThrownBy(() -> service.sendSmsCode(reqVO))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.AUTH_REGISTER_CAPTCHA_CODE_ERROR.getCode());
        verifyNoInteractions(smsCodeApi);
    }

    /**
     * 手机号不存在或账号被禁用时统一静默接受，避免通过响应差异枚举账号状态。
     */
    @Test
    void sendSmsCodeSilentlyIgnoresUnknownOrDisabledAccount() {
        AuthSmsSendReqVO reqVO = smsReqVO(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        when(userService.getUserByMobileAndType(MOBILE, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()))
                .thenReturn(null);
        assertThatCode(() -> service.sendSmsCode(reqVO)).doesNotThrowAnyException();
        verifyNoInteractions(smsCodeApi);

        AdminUserDO disabled = user(2L, "probe", AdminPlatformTypeEnum.BUSINESS_ADMIN.getType(),
                CommonStatusEnum.DISABLE.getStatus());
        when(userService.getUserByMobileAndType(MOBILE, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()))
                .thenReturn(disabled);
        assertThatCode(() -> service.sendSmsCode(reqVO)).doesNotThrowAnyException();
        verifyNoInteractions(smsCodeApi);
    }

    /**
     * 启用中的业务平台账号必须发送验证码，且限流身份取容器提供的远端地址。
     */
    @Test
    void sendSmsCodeSendsForEnabledBusinessAccount() {
        installRequest(CLIENT_IP);
        AuthSmsSendReqVO reqVO = smsReqVO(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        when(userService.getUserByMobileAndType(MOBILE, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()))
                .thenReturn(user(3L, "probe", AdminPlatformTypeEnum.BUSINESS_ADMIN.getType(),
                        CommonStatusEnum.ENABLE.getStatus()));

        service.sendSmsCode(reqVO);

        ArgumentCaptor<SmsCodeSendReqDTO> sent = ArgumentCaptor.forClass(SmsCodeSendReqDTO.class);
        verify(smsCodeApi).sendSmsCode(sent.capture());
        assertThat(sent.getValue().getMobile()).isEqualTo(MOBILE);
        assertThat(sent.getValue().getScene()).isEqualTo(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        assertThat(sent.getValue().getCreateIp()).as("限流身份必须取容器远端地址").isEqualTo(CLIENT_IP);
    }

    /**
     * 缺少可用的容器远端地址时拒绝发送短信，避免限流身份落空。
     */
    @Test
    void sendSmsCodeRejectsWhenClientAddressUnavailable() {
        AuthSmsSendReqVO reqVO = smsReqVO(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        when(userService.getUserByMobileAndType(MOBILE, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()))
                .thenReturn(user(3L, "probe", AdminPlatformTypeEnum.BUSINESS_ADMIN.getType(),
                        CommonStatusEnum.ENABLE.getStatus()));

        assertThatThrownBy(() -> service.sendSmsCode(reqVO))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.SMS_CODE_VERIFY_TOO_FAST.getCode());
        verifyNoInteractions(smsCodeApi);
    }

    /**
     * 令牌无法识别时登出直接返回，不得写入无归属的登出日志。
     */
    @Test
    void logoutSkipsAuditWhenTokenUnknown() {
        when(oauth2TokenService.removeAccessToken("DUMMY-ACCESS-TOKEN")).thenReturn(null);

        service.logout("DUMMY-ACCESS-TOKEN", LoginLogTypeEnum.LOGOUT_SELF.getType());

        verifyNoInteractions(loginLogService);
    }

    /**
     * 令牌可识别时按令牌归属写登出审计，账号名解析必须容忍用户不存在与空编号。
     */
    @Test
    void logoutWritesAuditWithTokenOwner() {
        OAuth2AccessTokenDO token = token(5L, UserTypeEnum.ADMIN.getValue());
        when(oauth2TokenService.removeAccessToken("DUMMY-ACCESS-TOKEN")).thenReturn(token);
        when(userService.getUser(5L)).thenReturn(null);

        service.logout("DUMMY-ACCESS-TOKEN", LoginLogTypeEnum.LOGOUT_SELF.getType());

        ArgumentCaptor<LoginLogCreateReqDTO> log = ArgumentCaptor.forClass(LoginLogCreateReqDTO.class);
        verify(loginLogService).createLoginLog(log.capture());
        assertThat(log.getValue().getUserId()).isEqualTo(5L);
        assertThat(log.getValue().getUserType()).isEqualTo(UserTypeEnum.ADMIN.getValue());
        assertThat(log.getValue().getUsername()).as("用户已删除时不得编造账号名").isNull();
        assertThat(log.getValue().getResult()).isEqualTo(LoginResultEnum.SUCCESS.getResult());

        when(userService.getUser(5L)).thenReturn(user(5L, "probe", AdminPlatformTypeEnum.BUSINESS_ADMIN.getType(),
                CommonStatusEnum.ENABLE.getStatus()));
        service.logout("DUMMY-ACCESS-TOKEN", LoginLogTypeEnum.LOGOUT_SELF.getType());
        ArgumentCaptor<LoginLogCreateReqDTO> secondLog = ArgumentCaptor.forClass(LoginLogCreateReqDTO.class);
        verify(loginLogService, times(2)).createLoginLog(secondLog.capture());
        assertThat(secondLog.getValue().getUsername()).isEqualTo("probe");
    }

    /**
     * 令牌没有用户编号时不得查询用户，账号名保持为空。
     */
    @Test
    void logoutToleratesTokenWithoutUserId() {
        when(oauth2TokenService.removeAccessToken("DUMMY-ANON-TOKEN"))
                .thenReturn(token(null, UserTypeEnum.ADMIN.getValue()));

        service.logout("DUMMY-ANON-TOKEN", LoginLogTypeEnum.LOGOUT_SELF.getType());

        ArgumentCaptor<LoginLogCreateReqDTO> log = ArgumentCaptor.forClass(LoginLogCreateReqDTO.class);
        verify(loginLogService).createLoginLog(log.capture());
        assertThat(log.getValue().getUserId()).isNull();
        assertThat(log.getValue().getUsername()).isNull();
        verify(userService, never()).getUser(any());
    }

    /**
     * 重置口令时手机号不存在或账号不可用必须拒绝，不得消费验证码。
     */
    @Test
    void resetPasswordRejectsUnknownOrUnusableAccount() {
        AuthResetPasswordReqVO reqVO = resetReqVO();
        when(userService.getUserByMobileAndType(MOBILE, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()))
                .thenReturn(null);
        assertThatThrownBy(() -> service.resetPassword(reqVO))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.USER_MOBILE_NOT_EXISTS.getCode());

        AdminUserDO stored = user(6L, "probe", AdminPlatformTypeEnum.BUSINESS_ADMIN.getType(),
                CommonStatusEnum.ENABLE.getStatus());
        AdminUserDO locked = user(6L, "probe", AdminPlatformTypeEnum.BUSINESS_ADMIN.getType(),
                CommonStatusEnum.ENABLE.getStatus());
        locked.setMobile("DUMMY-OTHER-MOBILE");
        when(userService.getUserByMobileAndType(MOBILE, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()))
                .thenReturn(stored);
        when(userService.lockUser(6L)).thenReturn(locked);
        assertThatThrownBy(() -> service.resetPassword(reqVO))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.USER_MOBILE_NOT_EXISTS.getCode());
        verifyNoInteractions(smsCodeApi);
    }

    /**
     * 重置口令成功路径必须先用重置场景消费验证码，再更新口令。
     */
    @Test
    void resetPasswordConsumesCodeThenUpdatesPassword() {
        installRequest(CLIENT_IP);
        AuthResetPasswordReqVO reqVO = resetReqVO();
        AdminUserDO stored = user(6L, "probe", AdminPlatformTypeEnum.BUSINESS_ADMIN.getType(),
                CommonStatusEnum.ENABLE.getStatus());
        stored.setMobile(MOBILE);
        when(userService.getUserByMobileAndType(MOBILE, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()))
                .thenReturn(stored);
        when(userService.lockUser(6L)).thenReturn(stored);

        service.resetPassword(reqVO);

        ArgumentCaptor<SmsCodeUseReqDTO> used = ArgumentCaptor.forClass(SmsCodeUseReqDTO.class);
        verify(smsCodeApi).useSmsCode(used.capture());
        assertThat(used.getValue().getMobile()).isEqualTo(MOBILE);
        assertThat(used.getValue().getCode()).isEqualTo("DUMMY-SMS-CODE");
        assertThat(used.getValue().getScene()).isEqualTo(SmsSceneEnum.ADMIN_MEMBER_RESET_PASSWORD.getScene());
        assertThat(used.getValue().getUsedIp()).isEqualTo(CLIENT_IP);
        verify(userService).updateUserPassword(6L, PASSWORD);
    }

    /**
     * 安装带远端地址的请求上下文。
     *
     * @param remoteAddr 容器远端地址
     */
    private static void installRequest(String remoteAddr) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr(remoteAddr);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    /**
     * 构造短信验证码请求。
     *
     * @param scene 短信场景
     * @return 短信验证码请求
     */
    private static AuthSmsSendReqVO smsReqVO(Integer scene) {
        AuthSmsSendReqVO reqVO = new AuthSmsSendReqVO();
        reqVO.setMobile(MOBILE);
        reqVO.setScene(scene);
        return reqVO;
    }

    /**
     * 构造重置口令请求。
     *
     * @return 重置口令请求
     */
    private static AuthResetPasswordReqVO resetReqVO() {
        AuthResetPasswordReqVO reqVO = new AuthResetPasswordReqVO();
        reqVO.setMobile(MOBILE);
        reqVO.setCode("DUMMY-SMS-CODE");
        reqVO.setPassword(PASSWORD);
        return reqVO;
    }

    /**
     * 构造仅填充断言涉及字段的用户对象。
     *
     * @param id 用户编号
     * @param username 登录账号
     * @param userType 平台类型
     * @param status 账号状态
     * @return 用户持久对象
     */
    private static AdminUserDO user(Long id, String username, String userType, Integer status) {
        AdminUserDO user = new AdminUserDO();
        user.setId(id);
        user.setUsername(username);
        user.setUserType(userType);
        user.setStatus(status);
        user.setPassword("DUMMY-PASSWORD-HASH");
        user.setMobile(MOBILE);
        return user;
    }

    /**
     * 构造访问令牌对象。
     *
     * @param userId 令牌归属用户编号
     * @param userType 令牌归属用户类型
     * @return 访问令牌对象
     */
    private static OAuth2AccessTokenDO token(Long userId, Integer userType) {
        OAuth2AccessTokenDO token = new OAuth2AccessTokenDO();
        token.setUserId(userId);
        token.setUserType(userType);
        return token;
    }

}
