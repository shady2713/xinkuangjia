package com.basicframework.module.system.service.auth;

import cn.hutool.core.util.ObjectUtil;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.util.monitor.TracerUtils;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.common.util.servlet.ServletUtils;
import com.basicframework.framework.common.util.validation.ValidationUtils;
import com.basicframework.framework.datapermission.core.annotation.DataPermission;
import com.basicframework.module.system.api.logger.dto.LoginLogCreateReqDTO;
import com.basicframework.module.system.api.sms.SmsCodeApi;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeSendReqDTO;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeUseReqDTO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthLoginReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthLoginRespVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthRegisterReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthResetPasswordReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthSmsLoginReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthSmsSendReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.CaptchaVerificationReqVO;
import com.basicframework.module.system.convert.auth.AuthConvert;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.logger.LoginLogTypeEnum;
import com.basicframework.module.system.enums.logger.LoginResultEnum;
import com.basicframework.module.system.enums.oauth2.OAuth2ClientConstants;
import com.basicframework.module.system.enums.sms.SmsSceneEnum;
import com.basicframework.module.system.framework.security.login.LoginFailureLockService;
import com.basicframework.module.system.service.logger.LoginLogService;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import com.basicframework.module.system.service.user.AdminUserService;
import com.anji.captcha.model.common.ResponseModel;
import com.anji.captcha.model.vo.CaptchaVO;
import com.anji.captcha.service.CaptchaService;
import com.google.common.annotations.VisibleForTesting;
import jakarta.annotation.Resource;
import jakarta.validation.Validator;
import lombok.Setter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.util.servlet.ServletUtils.getClientIP;
import static com.basicframework.module.system.enums.ErrorCodeConstants.*;

/**
 * Auth Service 实现类
 *
 * @author 李杰
 */
@Service
@Slf4j
public class AdminAuthServiceImpl implements AdminAuthService {

    @Resource
    private AdminUserService userService;
    @Resource
    private LoginLogService loginLogService;
    @Resource
    private OAuth2TokenService oauth2TokenService;
    @Resource
    private Validator validator;
    @Resource
    private CaptchaService captchaService;
    @Resource
    private SmsCodeApi smsCodeApi;
    @Resource
    private LoginFailureLockService loginFailureLockService;

    /**
     * 验证码的开关，默认为 true
     */
    @Value("${basic-framework.captcha.enable:true}")
    @Setter // 为了单测：开启或者关闭验证码
    private Boolean captchaEnable;

    /**
     * 校验认证请求并返回登录身份。
     *
     * @param username username 参数
     * @param password password 参数
     * @return 方法处理结果
     */
    @Override
    public AdminUserDO authenticate(String username, String password) {
        return authenticate(username, password, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
    }

    /**
     * 校验认证请求并返回登录身份。
     *
     * @param username username 参数
     * @param password password 参数
     * @param userType userType 参数
     * @return 方法处理结果
     */
    @Override
    public AdminUserDO authenticate(String username, String password, String userType) {
        final LoginLogTypeEnum logTypeEnum = LoginLogTypeEnum.LOGIN_USERNAME;
        // 锁定检查放在账号查询之前，锁定提示和账号是否存在无关。
        try {
            loginFailureLockService.assertNotLocked(username);
        } catch (ServiceException ex) {
            createLoginLog(null, username, logTypeEnum, LoginResultEnum.USER_LOCKED);
            throw ex;
        }
        // 登录账号允许跨平台同名，认证时必须按入口平台类型精确查询。
        AdminUserDO user = userService.getUserByUsernameAndType(username, userType);
        if (user == null) {
            loginFailureLockService.recordFailure(username);
            createLoginLog(null, username, logTypeEnum, LoginResultEnum.BAD_CREDENTIALS);
            throw exception(AUTH_LOGIN_BAD_CREDENTIALS);
        }
        boolean passwordMatched = userService.isPasswordMatch(password, user.getPassword());
        if (!passwordMatched && userService.isPasswordMatchLegacy(password, user.getPassword())) {
            // 历史 bcrypt(md5(明文)) 校验通过后立即升级为当前 BCrypt(明文) 格式。
            userService.updatePasswordHash(user.getId(), password);
            passwordMatched = true;
        }
        if (!passwordMatched) {
            loginFailureLockService.recordFailure(username);
            createLoginLog(user.getId(), username, logTypeEnum, LoginResultEnum.BAD_CREDENTIALS);
            throw exception(AUTH_LOGIN_BAD_CREDENTIALS);
        }
        // 凭据正确后清除该账号的连续失败计数。
        loginFailureLockService.clearFailures(username);
        // 校验是否禁用
        if (CommonStatusEnum.isDisable(user.getStatus())) {
            createLoginLog(user.getId(), username, logTypeEnum, LoginResultEnum.USER_DISABLED);
            throw exception(AUTH_LOGIN_USER_DISABLED);
        }
        return user;
    }

    /**
     * 校验登录凭据并创建登录会话。
     *
     * @param reqVO 请求参数
     * @return 方法处理结果
     */
    @Override
    @DataPermission(enable = false)
    public AuthLoginRespVO login(AuthLoginReqVO reqVO) {
        // 校验验证码
        validateCaptcha(reqVO);

        // 使用账号密码，进行登录
        String expectedUserType = AdminPlatformTypeEnum.BUSINESS_ADMIN.getType();
        AdminUserDO user = authenticate(reqVO.getUsername(), reqVO.getPassword(), expectedUserType);
        validateLoginUserType(user, reqVO.getUsername(), expectedUserType);

        // 创建 Token 令牌，记录登录日志
        return createTokenAfterLoginSuccess(user, reqVO.getUsername(), LoginLogTypeEnum.LOGIN_USERNAME);
    }

    /**
     * 校验超级管理员凭据并创建登录会话。
     *
     * @param reqVO 请求参数
     * @return 方法处理结果
     */
    @Override
    @DataPermission(enable = false)
    public AuthLoginRespVO superAdminLogin(AuthLoginReqVO reqVO) {
        validateCaptcha(reqVO);

        String expectedUserType = AdminPlatformTypeEnum.SUPER_ADMIN.getType();
        AdminUserDO user = authenticate(reqVO.getUsername(), reqVO.getPassword(), expectedUserType);
        validateLoginUserType(user, reqVO.getUsername(), expectedUserType);

        return createTokenAfterLoginSuccess(user, reqVO.getUsername(), LoginLogTypeEnum.LOGIN_USERNAME);
    }

    /**
     * 登录入口按平台类型隔离：当前平台账号不能登录新平台，新平台账号也不能登录当前平台。
     */
    private void validateLoginUserType(AdminUserDO user, String username, String expectedUserType) {
        validateLoginUserType(user, username, expectedUserType, LoginLogTypeEnum.LOGIN_USERNAME);
    }

    /**
     * 按指定日志类型校验登录账号与入口平台是否一致。
     *
     * <p>短信入口复用同一平台隔离规则，但失败日志要保留短信登录类型，便于审计区分入口。</p>
     *
     * @param user 已通过凭证校验的用户
     * @param username 登录日志中记录的账号
     * @param expectedUserType 当前入口允许的平台类型
     * @param logType 登录失败日志类型
     */
    private void validateLoginUserType(AdminUserDO user, String username, String expectedUserType,
                                       LoginLogTypeEnum logType) {
        if (AdminPlatformTypeEnum.isSame(user.getUserType(), expectedUserType)) {
            return;
        }
        createLoginLog(user.getId(), username, logType, LoginResultEnum.BAD_CREDENTIALS);
        throw exception(AUTH_LOGIN_PLATFORM_MISMATCH);
    }

    /**
     * 发送短信验证码。
     *
     * @param reqVO 请求参数
     */
    @Override
    public void sendSmsCode(AuthSmsSendReqVO reqVO) {
        // 如果是重置密码场景，需要校验图形验证码是否正确
        if (Objects.equals(SmsSceneEnum.ADMIN_MEMBER_RESET_PASSWORD.getScene(), reqVO.getScene())) {
            ResponseModel response = doValidateCaptcha(reqVO);
            if (!response.isSuccess()) {
                throw exception(AUTH_REGISTER_CAPTCHA_CODE_ERROR, response.getRepMsg());
            }
        }

        // 登录场景，验证是否存在
        if (userService.getUserByMobile(reqVO.getMobile()) == null) {
            throw exception(AUTH_MOBILE_NOT_EXISTS);
        }
        // 发送验证码
        SmsCodeSendReqDTO sendRequest = AuthConvert.INSTANCE.convert(reqVO);
        sendRequest.setCreateIp(getClientIP());
        smsCodeApi.sendSmsCode(sendRequest);
    }

    /**
     * 校验短信验证码并创建登录会话。
     *
     * @param reqVO 请求参数
     * @return 方法处理结果
     */
    @Override
    public AuthLoginRespVO smsLogin(AuthSmsLoginReqVO reqVO) {
        // 校验验证码
        smsCodeApi.useSmsCode(AuthConvert.INSTANCE.convert(reqVO, SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene(), getClientIP()));

        // 获得用户信息
        AdminUserDO user = userService.getUserByMobile(reqVO.getMobile());
        if (user == null) {
            throw exception(USER_NOT_EXISTS);
        }
        // 短信入口与账号密码入口保持同一套账号状态和平台隔离规则，避免绕过禁用与跨平台限制。
        if (CommonStatusEnum.isDisable(user.getStatus())) {
            createLoginLog(user.getId(), user.getUsername(), LoginLogTypeEnum.LOGIN_MOBILE,
                    LoginResultEnum.USER_DISABLED);
            throw exception(AUTH_LOGIN_USER_DISABLED);
        }
        // 该接口沿用业务管理平台认证边界，新管理平台账号只能走独立登录入口。
        validateLoginUserType(user, user.getUsername(), AdminPlatformTypeEnum.BUSINESS_ADMIN.getType(),
                LoginLogTypeEnum.LOGIN_MOBILE);

        // 创建 Token 令牌，记录登录日志
        return createTokenAfterLoginSuccess(user, reqVO.getMobile(), LoginLogTypeEnum.LOGIN_MOBILE);
    }

    /**
     * 创建登录日志。
     */
    private void createLoginLog(Long userId, String username,
                                LoginLogTypeEnum logTypeEnum, LoginResultEnum loginResult) {
        // 插入登录日志
        LoginLogCreateReqDTO reqDTO = new LoginLogCreateReqDTO();
        reqDTO.setLogType(logTypeEnum.getType());
        reqDTO.setTraceId(TracerUtils.getTraceId());
        reqDTO.setUserId(userId);
        reqDTO.setUserType(getUserType().getValue());
        reqDTO.setUsername(username);
        reqDTO.setUserAgent(ServletUtils.getUserAgent());
        reqDTO.setUserIp(getClientIP());
        reqDTO.setResult(loginResult.getResult());
        loginLogService.createLoginLog(reqDTO);
        // 更新最后登录时间
        if (userId != null && Objects.equals(LoginResultEnum.SUCCESS.getResult(), loginResult.getResult())) {
            userService.updateUserLogin(userId, getClientIP());
        }
    }

    /**
     * 校验 validateCaptcha 对应的输入与业务约束。
     */
    @VisibleForTesting
    void validateCaptcha(AuthLoginReqVO reqVO) {
        ResponseModel response = doValidateCaptcha(reqVO);
        // 校验验证码
        if (!response.isSuccess()) {
            // 创建登录失败日志（验证码不正确)
            createLoginLog(null, reqVO.getUsername(), LoginLogTypeEnum.LOGIN_USERNAME, LoginResultEnum.CAPTCHA_CODE_ERROR);
            throw exception(AUTH_LOGIN_CAPTCHA_CODE_ERROR, response.getRepMsg());
        }
    }

    /**
     * 执行验证码的实际校验流程。
     *
     * @param reqVO 请求参数
     * @return 方法处理结果
     */
    private ResponseModel doValidateCaptcha(CaptchaVerificationReqVO reqVO) {
        // 如果验证码关闭，则不进行校验
        if (!captchaEnable) {
            return ResponseModel.success();
        }
        ValidationUtils.validate(validator, reqVO, CaptchaVerificationReqVO.CodeEnableGroup.class);
        CaptchaVO captchaVO = new CaptchaVO();
        captchaVO.setCaptchaVerification(reqVO.getCaptchaVerification());
        return captchaService.verification(captchaVO);
    }

    /**
     * 创建令牌After登录Success。
     *
     * @param user 已通过认证的用户
     * @param username 登录日志中记录的账号
     * @param logType 登录入口类型
     * @return 令牌和首次改密标志
     */
    private AuthLoginRespVO createTokenAfterLoginSuccess(AdminUserDO user, String username, LoginLogTypeEnum logType) {
        // 插入登陆日志
        createLoginLog(user.getId(), username, logType, LoginResultEnum.SUCCESS);
        // 创建访问令牌
        OAuth2AccessTokenDO accessTokenDO = oauth2TokenService.createAccessToken(user.getId(), getUserType().getValue(),
                OAuth2ClientConstants.CLIENT_ID_DEFAULT, null);
        // 构建返回结果；首次改密标志用于前端拦截，不能依赖前端自行判断。
        AuthLoginRespVO response = BeanUtils.toBean(accessTokenDO, AuthLoginRespVO.class);
        response.setPasswordChangeRequired(Boolean.TRUE.equals(user.getPasswordChangeRequired()));
        return response;
    }

    /**
     * 刷新令牌。
     *
     * @param refreshToken refreshToken 参数
     * @return 操作结果
     */
    @Override
    public AuthLoginRespVO refreshToken(String refreshToken) {
        OAuth2AccessTokenDO accessTokenDO = oauth2TokenService.refreshAccessToken(refreshToken, OAuth2ClientConstants.CLIENT_ID_DEFAULT);
        if (accessTokenDO == null) {
            return null;
        }
        AuthLoginRespVO response = BeanUtils.toBean(accessTokenDO, AuthLoginRespVO.class);
        AdminUserDO user = userService.getUser(accessTokenDO.getUserId());
        response.setPasswordChangeRequired(user != null && Boolean.TRUE.equals(user.getPasswordChangeRequired()));
        return response;
    }

    /**
     * 注销当前登录会话并清理访问令牌。
     *
     * @param token token 参数
     * @param logType logType 参数
     */
    @Override
    public void logout(String token, Integer logType) {
        // 删除访问令牌
        OAuth2AccessTokenDO accessTokenDO = oauth2TokenService.removeAccessToken(token);
        if (accessTokenDO == null) {
            return;
        }
        // 删除成功，则记录登出日志
        createLogoutLog(accessTokenDO.getUserId(), accessTokenDO.getUserType(), logType);
    }

    /**
     * 创建Logout日志。
     */
    private void createLogoutLog(Long userId, Integer userType, Integer logType) {
        LoginLogCreateReqDTO reqDTO = new LoginLogCreateReqDTO();
        reqDTO.setLogType(logType);
        reqDTO.setTraceId(TracerUtils.getTraceId());
        reqDTO.setUserId(userId);
        reqDTO.setUserType(userType);
        if (ObjectUtil.equal(getUserType().getValue(), userType)) {
            reqDTO.setUsername(getUsername(userId));
        }
        reqDTO.setUserAgent(ServletUtils.getUserAgent());
        reqDTO.setUserIp(getClientIP());
        reqDTO.setResult(LoginResultEnum.SUCCESS.getResult());
        loginLogService.createLoginLog(reqDTO);
    }

    /**
     * 获取Username。
     */
    private String getUsername(Long userId) {
        if (userId == null) {
            return null;
        }
        AdminUserDO user = userService.getUser(userId);
        return user != null ? user.getUsername() : null;
    }

    /**
     * 获取用户类型。
     */
    private UserTypeEnum getUserType() {
        return UserTypeEnum.ADMIN;
    }

    /**
     * 注册目标数据。
     *
     * @param registerReqVO registerReqVO 参数
     * @return 方法处理结果
     */
    @Override
    public AuthLoginRespVO register(AuthRegisterReqVO registerReqVO) {
        // 1. 校验验证码
        validateCaptcha(registerReqVO);

        // 2. 校验用户名是否已存在
        Long userId = userService.registerUser(registerReqVO);

        // 3. 创建 Token 令牌，记录登录日志
        AdminUserDO user = userService.getUser(userId);
        if (user == null) {
            throw exception(USER_NOT_EXISTS);
        }
        return createTokenAfterLoginSuccess(user, registerReqVO.getUsername(), LoginLogTypeEnum.LOGIN_USERNAME);
    }

    /**
     * 校验 validateCaptcha 对应的输入与业务约束。
     */
    @VisibleForTesting
    void validateCaptcha(AuthRegisterReqVO reqVO) {
        ResponseModel response = doValidateCaptcha(reqVO);
        // 验证不通过
        if (!response.isSuccess()) {
            throw exception(AUTH_REGISTER_CAPTCHA_CODE_ERROR, response.getRepMsg());
        }
    }

    /**
     * 重置密码。
     *
     * @param reqVO 请求参数
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public void resetPassword(AuthResetPasswordReqVO reqVO) {
        AdminUserDO userByMobile = userService.getUserByMobile(reqVO.getMobile());
        if (userByMobile == null) {
            throw exception(USER_MOBILE_NOT_EXISTS);
        }

        SmsCodeUseReqDTO useRequest = new SmsCodeUseReqDTO();
        useRequest.setCode(reqVO.getCode());
        useRequest.setMobile(reqVO.getMobile());
        useRequest.setScene(SmsSceneEnum.ADMIN_MEMBER_RESET_PASSWORD.getScene());
        useRequest.setUsedIp(getClientIP());
        smsCodeApi.useSmsCode(useRequest);

        userService.updateUserPassword(userByMobile.getId(), reqVO.getPassword());
    }
}
