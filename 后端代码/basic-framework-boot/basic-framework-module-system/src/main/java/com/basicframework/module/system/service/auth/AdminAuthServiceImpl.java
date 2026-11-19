package com.basicframework.module.system.service.auth;

import cn.hutool.core.util.ObjectUtil;
import com.anji.captcha.model.common.ResponseModel;
import com.anji.captcha.model.vo.CaptchaVO;
import com.anji.captcha.service.CaptchaService;
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
import com.basicframework.module.system.controller.admin.auth.vo.AuthResetPasswordReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthSmsLoginReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthSmsSendReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.CaptchaVerificationReqVO;
import com.basicframework.module.system.convert.auth.AuthConvert;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.logger.LoginLogTypeEnum;
import com.basicframework.module.system.enums.logger.LoginResultEnum;
import com.basicframework.module.system.enums.oauth2.OAuth2ClientConstants;
import com.basicframework.module.system.enums.sms.SmsSceneEnum;
import com.basicframework.module.system.framework.security.audit.SecurityAuditService;
import com.basicframework.module.system.framework.security.login.LoginFailureLockService;
import com.basicframework.module.system.framework.security.login.SmsLoginFailureLockService;
import com.basicframework.module.system.service.logger.LoginLogService;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import com.basicframework.module.system.service.user.AdminUserService;
import com.google.common.annotations.VisibleForTesting;
import jakarta.annotation.Resource;
import jakarta.validation.Validator;
import lombok.Setter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.util.Objects;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.util.servlet.ServletUtils.getClientIP;

/**
 * 管理后台认证服务实现。
 *
 * @author 李杰
 */
@Service
@Slf4j
public class AdminAuthServiceImpl implements AdminAuthService {

    /** 避免同一请求内前置检查与正式登录重复消费一次性图形验证码的请求属性名。 */
    private static final String CAPTCHA_VERIFIED_ATTR = AdminAuthServiceImpl.class.getName() + ".CAPTCHA_VERIFIED";

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
    @Resource
    private SmsLoginFailureLockService smsLoginFailureLockService;
    /** 匿名短信发送防枚举冷却键前缀，确保未注册与已注册手机号返回一致的频控响应。 */
    private static final String AUTH_SMS_SEND_COOLDOWN_PREFIX = "sms:auth:send:cooldown:";

    /** 匿名短信发送默认冷却窗口，与验证码默认发送间隔保持一致。 */
    private static final Duration DEFAULT_AUTH_SMS_COOLDOWN = Duration.ofMinutes(1);

    @Resource
    private SecurityAuditService securityAuditService;
    @Resource
    private ObjectProvider<StringRedisTemplate> stringRedisTemplateProvider;
    @Resource
    private ObjectProvider<com.basicframework.module.system.framework.sms.config.SmsCodeProperties> smsCodePropertiesProvider;

    /** 图形验证码开关，默认为 true。 */
    @Value("${basic-framework.captcha.enable:true}")
    @Setter
    private Boolean captchaEnable = true;

    /**
     * 在执行 SM2 私钥解密与防重放存储前校验图形验证码和账号锁定状态。
     *
     * @param reqVO 登录请求
     */
    @Override
    public void precheckLogin(AuthLoginReqVO reqVO) {
        validateCaptcha(reqVO);
        try {
            loginFailureLockService.assertNotLocked(reqVO.getUsername());
        } catch (ServiceException ex) {
            createLoginLog(null, reqVO.getUsername(), LoginLogTypeEnum.LOGIN_USERNAME, LoginResultEnum.USER_LOCKED);
            throw ex;
        }
        var request = ServletUtils.getRequest();
        if (request != null) {
            request.setAttribute(CAPTCHA_VERIFIED_ATTR, Boolean.TRUE);
        }
    }

    /**
     * 在重置密码密文解密前校验手机号与客户端 IP 锁定状态。
     *
     * @param mobile 目标手机号
     */
    @Override
    public void precheckSmsAttempt(String mobile) {
        String clientIp = getClientIP();
        try {
            smsLoginFailureLockService.assertNotLocked(mobile, clientIp);
        } catch (ServiceException ex) {
            createLoginLog(null, mobile, LoginLogTypeEnum.PASSWORD_RESET, LoginResultEnum.USER_LOCKED);
            throw ex;
        }
    }

    /**
     * 校验业务管理平台账号与密码。
     *
     * @param username 账号
     * @param password 明文密码
     * @return 通过认证的用户
     */
    @Override
    public AdminUserDO authenticate(String username, String password) {
        return authenticate(username, password, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
    }

    /**
     * 按指定管理平台校验账号与密码，维护连续失败计数与审计日志。
     *
     * @param username 账号
     * @param password 明文密码
     * @param userType 平台类型
     * @return 通过认证的启用用户
     */
    @Override
    public AdminUserDO authenticate(String username, String password, String userType) {
        final LoginLogTypeEnum logTypeEnum = LoginLogTypeEnum.LOGIN_USERNAME;
        try {
            loginFailureLockService.assertNotLocked(username);
        } catch (ServiceException ex) {
            createLoginLog(null, username, logTypeEnum, LoginResultEnum.USER_LOCKED);
            throw ex;
        }
        AdminUserDO user = userService.getUserByUsernameAndType(username, userType);
        if (user == null) {
            loginFailureLockService.recordFailure(username);
            createLoginLog(null, username, logTypeEnum, LoginResultEnum.BAD_CREDENTIALS);
            throw exception(ErrorCodeConstants.AUTH_LOGIN_BAD_CREDENTIALS);
        }
        boolean passwordMatched = userService.isPasswordMatch(password, user.getPassword());
        if (!passwordMatched && userService.isPasswordMatchLegacy(password, user.getPassword())) {
            userService.updatePasswordHash(user.getId(), password);
            passwordMatched = true;
        }
        if (!passwordMatched) {
            loginFailureLockService.recordFailure(username);
            createLoginLog(user.getId(), username, logTypeEnum, LoginResultEnum.BAD_CREDENTIALS);
            throw exception(ErrorCodeConstants.AUTH_LOGIN_BAD_CREDENTIALS);
        }
        loginFailureLockService.clearFailures(username);
        if (CommonStatusEnum.isDisable(user.getStatus())) {
            createLoginLog(user.getId(), username, logTypeEnum, LoginResultEnum.USER_DISABLED);
            throw exception(ErrorCodeConstants.AUTH_LOGIN_USER_DISABLED);
        }
        return user;
    }

    /**
     * 校验业务管理平台登录凭据并签发会话令牌。
     *
     * @param reqVO 登录请求
     * @return 登录响应
     */
    @Override
    @DataPermission(enable = false)
    public AuthLoginRespVO login(AuthLoginReqVO reqVO) {
        validateCaptchaIfNotPrechecked(reqVO);
        String expectedUserType = AdminPlatformTypeEnum.BUSINESS_ADMIN.getType();
        AdminUserDO user = authenticate(reqVO.getUsername(), reqVO.getPassword(), expectedUserType);
        validateLoginUserType(user, reqVO.getUsername(), expectedUserType);
        return createTokenAfterLoginSuccess(user, reqVO.getUsername(), LoginLogTypeEnum.LOGIN_USERNAME);
    }

    /**
     * 校验超级管理平台登录凭据并签发会话令牌。
     *
     * @param reqVO 登录请求
     * @return 登录响应
     */
    @Override
    @DataPermission(enable = false)
    public AuthLoginRespVO superAdminLogin(AuthLoginReqVO reqVO) {
        validateCaptchaIfNotPrechecked(reqVO);
        String expectedUserType = AdminPlatformTypeEnum.SUPER_ADMIN.getType();
        AdminUserDO user = authenticate(reqVO.getUsername(), reqVO.getPassword(), expectedUserType);
        validateLoginUserType(user, reqVO.getUsername(), expectedUserType);
        return createTokenAfterLoginSuccess(user, reqVO.getUsername(), LoginLogTypeEnum.LOGIN_USERNAME);
    }

    /**
     * 若当前请求尚未执行前置验证码校验，则补充执行一次校验。
     *
     * @param reqVO 登录请求
     */
    private void validateCaptchaIfNotPrechecked(AuthLoginReqVO reqVO) {
        var request = ServletUtils.getRequest();
        if (request != null && Boolean.TRUE.equals(request.getAttribute(CAPTCHA_VERIFIED_ATTR))) {
            return;
        }
        validateCaptcha(reqVO);
    }

    /**
     * 校验账号平台与登录入口一致。
     */
    private void validateLoginUserType(AdminUserDO user, String username, String expectedUserType) {
        validateLoginUserType(user, username, expectedUserType, LoginLogTypeEnum.LOGIN_USERNAME);
    }

    /**
     * 按指定日志类型校验登录账号与入口平台是否一致。
     */
    private void validateLoginUserType(AdminUserDO user, String username, String expectedUserType,
                                       LoginLogTypeEnum logType) {
        if (AdminPlatformTypeEnum.isSame(user.getUserType(), expectedUserType)) {
            return;
        }
        createLoginLog(user.getId(), username, logType, LoginResultEnum.BAD_CREDENTIALS);
        throw exception(ErrorCodeConstants.AUTH_LOGIN_PLATFORM_MISMATCH);
    }

    /**
     * 统一校验图形验证码与锁定状态后发送短信验证码，且对未注册或非业务平台账号静默返回以防枚举手机号。
     *
     * @param reqVO 发送请求
     */
    @Override
    @DataPermission(enable = false)
    public void sendSmsCode(AuthSmsSendReqVO reqVO) {
        String clientIp = getClientIP();
        smsLoginFailureLockService.assertNotLocked(reqVO.getMobile(), clientIp);
        ResponseModel response = doValidateCaptcha(reqVO);
        if (!response.isSuccess()) {
            throw exception(ErrorCodeConstants.AUTH_LOGIN_CAPTCHA_CODE_ERROR, response.getRepMsg());
        }
        // 在检查账号是否存在之前统一施加冷却频控，防止通过连续两次请求的响应差异枚举手机号或超管归属。
        enforceAuthSmsSendCooldown(reqVO.getMobile());

        // 匿名短信入口仅服务已启用的业务管理平台账号；不存在、停用或超管账号静默结束，不向调用方暴露手机号状态。
        AdminUserDO user = userService.getUserByMobile(reqVO.getMobile());
        if (user == null
                || CommonStatusEnum.isDisable(user.getStatus())
                || !AdminPlatformTypeEnum.isSame(user.getUserType(), AdminPlatformTypeEnum.BUSINESS_ADMIN.getType())) {
            return;
        }
        SmsCodeSendReqDTO sendRequest = AuthConvert.INSTANCE.convert(reqVO);
        sendRequest.setCreateIp(clientIp);
        smsCodeApi.sendSmsCode(sendRequest);
    }

    /**
     * 对匿名短信发送请求按手机号施加统一冷却窗口，消除未注册账号与已注册账号的频控差异。
     *
     * @param mobile 手机号
     */
    private void enforceAuthSmsSendCooldown(String mobile) {
        StringRedisTemplate redisTemplate = stringRedisTemplateProvider != null
                ? stringRedisTemplateProvider.getIfAvailable() : null;
        if (redisTemplate == null) {
            return;
        }
        var properties = smsCodePropertiesProvider != null ? smsCodePropertiesProvider.getIfAvailable() : null;
        Duration cooldown = properties != null && properties.getSendFrequency() != null
                ? properties.getSendFrequency() : DEFAULT_AUTH_SMS_COOLDOWN;
        if (cooldown.isZero() || cooldown.isNegative()) {
            return;
        }
        String key = AUTH_SMS_SEND_COOLDOWN_PREFIX + cn.hutool.crypto.digest.DigestUtil.sha256Hex(mobile);
        Boolean acquired = redisTemplate.opsForValue().setIfAbsent(key, "1", cooldown);
        if (!Boolean.TRUE.equals(acquired)) {
            throw exception(ErrorCodeConstants.SMS_CODE_SEND_TOO_FAST);
        }
    }

    /**
     * 校验短信验证码并创建业务管理平台登录会话。
     *
     * @param reqVO 短信登录请求
     * @return 登录令牌
     */
    @Override
    @DataPermission(enable = false)
    public AuthLoginRespVO smsLogin(AuthSmsLoginReqVO reqVO) {
        String clientIp = getClientIP();
        try {
            smsLoginFailureLockService.assertNotLocked(reqVO.getMobile(), clientIp);
        } catch (ServiceException ex) {
            createLoginLog(null, reqVO.getMobile(), LoginLogTypeEnum.LOGIN_MOBILE, LoginResultEnum.USER_LOCKED);
            throw ex;
        }

        try {
            smsCodeApi.useSmsCode(AuthConvert.INSTANCE.convert(reqVO,
                    SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene(), clientIp));
        } catch (ServiceException ex) {
            smsLoginFailureLockService.recordFailure(reqVO.getMobile(), clientIp);
            createLoginLog(null, reqVO.getMobile(), LoginLogTypeEnum.LOGIN_MOBILE, LoginResultEnum.SMS_CODE_ERROR);
            throw ex;
        }

        AdminUserDO user = userService.getUserByMobile(reqVO.getMobile());
        if (user == null) {
            smsLoginFailureLockService.recordFailure(reqVO.getMobile(), clientIp);
            createLoginLog(null, reqVO.getMobile(), LoginLogTypeEnum.LOGIN_MOBILE,
                    LoginResultEnum.USER_MOBILE_NOT_FOUND);
            throw exception(ErrorCodeConstants.USER_NOT_EXISTS);
        }
        if (CommonStatusEnum.isDisable(user.getStatus())) {
            createLoginLog(user.getId(), user.getUsername(), LoginLogTypeEnum.LOGIN_MOBILE,
                    LoginResultEnum.USER_DISABLED);
            throw exception(ErrorCodeConstants.AUTH_LOGIN_USER_DISABLED);
        }
        validateLoginUserType(user, user.getUsername(), AdminPlatformTypeEnum.BUSINESS_ADMIN.getType(),
                LoginLogTypeEnum.LOGIN_MOBILE);

        smsLoginFailureLockService.clearFailures(reqVO.getMobile(), clientIp);
        return createTokenAfterLoginSuccess(user, reqVO.getMobile(), LoginLogTypeEnum.LOGIN_MOBILE);
    }

    /**
     * 记录安全审计日志并在登录成功时更新最近登录信息。
     */
    private void createLoginLog(Long userId, String username,
                                LoginLogTypeEnum logTypeEnum, LoginResultEnum loginResult) {
        securityAuditService.record(logTypeEnum, loginResult, userId, username);
        if (userId != null && Objects.equals(LoginResultEnum.SUCCESS.getResult(), loginResult.getResult())) {
            userService.updateUserLogin(userId, getClientIP());
        }
    }

    /**
     * 校验账号登录图形验证码。
     */
    @VisibleForTesting
    void validateCaptcha(AuthLoginReqVO reqVO) {
        ResponseModel response = doValidateCaptcha(reqVO);
        if (!response.isSuccess()) {
            createLoginLog(null, reqVO.getUsername(), LoginLogTypeEnum.LOGIN_USERNAME, LoginResultEnum.CAPTCHA_CODE_ERROR);
            throw exception(ErrorCodeConstants.AUTH_LOGIN_CAPTCHA_CODE_ERROR, response.getRepMsg());
        }
    }

    /**
     * 执行底层验证码服务核验；开关关闭时直接放行。
     */
    private ResponseModel doValidateCaptcha(CaptchaVerificationReqVO reqVO) {
        if (!Boolean.TRUE.equals(captchaEnable)) {
            return ResponseModel.success();
        }
        ValidationUtils.validate(validator, reqVO, CaptchaVerificationReqVO.CodeEnableGroup.class);
        CaptchaVO captchaVO = new CaptchaVO();
        captchaVO.setCaptchaVerification(reqVO.getCaptchaVerification());
        return captchaService.verification(captchaVO);
    }

    /**
     * 登录成功后签发内部客户端访问令牌并附带首次改密标记。
     */
    private AuthLoginRespVO createTokenAfterLoginSuccess(AdminUserDO user, String username, LoginLogTypeEnum logType) {
        createLoginLog(user.getId(), username, logType, LoginResultEnum.SUCCESS);
        OAuth2AccessTokenDO accessTokenDO = oauth2TokenService.createAccessToken(user.getId(), getUserType().getValue(),
                OAuth2ClientConstants.CLIENT_ID_SYSTEM, null);
        AuthLoginRespVO response = BeanUtils.toBean(accessTokenDO, AuthLoginRespVO.class);
        response.setPasswordChangeRequired(Boolean.TRUE.equals(user.getPasswordChangeRequired()));
        return response;
    }

    /**
     * 刷新管理端访问令牌。
     *
     * @param refreshToken 刷新令牌
     * @return 新令牌及首次改密标记
     */
    @Override
    @DataPermission(enable = false)
    public AuthLoginRespVO refreshToken(String refreshToken) {
        OAuth2AccessTokenDO accessTokenDO = oauth2TokenService.refreshAccessToken(refreshToken, OAuth2ClientConstants.CLIENT_ID_SYSTEM);
        if (accessTokenDO == null) {
            return null;
        }
        AuthLoginRespVO response = BeanUtils.toBean(accessTokenDO, AuthLoginRespVO.class);
        AdminUserDO user = userService.getUser(accessTokenDO.getUserId());
        response.setPasswordChangeRequired(user != null && Boolean.TRUE.equals(user.getPasswordChangeRequired()));
        return response;
    }

    /**
     * 注销访问令牌并写入登出审计日志。
     *
     * @param token 访问令牌
     * @param logType 登出类型
     */
    @Override
    @DataPermission(enable = false)
    public void logout(String token, Integer logType) {
        OAuth2AccessTokenDO accessTokenDO = oauth2TokenService.removeAccessToken(token);
        if (accessTokenDO == null) {
            return;
        }
        createLogoutLog(accessTokenDO.getUserId(), accessTokenDO.getUserType(), logType);
    }

    /**
     * 组装并持久化登出日志。
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
     * 按用户编号读取登录账号名。
     */
    private String getUsername(Long userId) {
        if (userId == null) {
            return null;
        }
        AdminUserDO user = userService.getUser(userId);
        return user != null ? user.getUsername() : null;
    }

    /**
     * 返回管理端固定用户类型枚举。
     */
    private UserTypeEnum getUserType() {
        return UserTypeEnum.ADMIN;
    }

    /**
     * 校验短信锁定、核销最新短信验证码并重置业务管理平台启用账号的密码；禁止通过匿名短信重置超级管理员密码。
     *
     * @param reqVO 重置密码请求
     */
    @Override
    @DataPermission(enable = false)
    @Transactional(rollbackFor = Exception.class)
    public void resetPassword(AuthResetPasswordReqVO reqVO) {
        String clientIp = getClientIP();
        precheckSmsAttempt(reqVO.getMobile());

        SmsCodeUseReqDTO useRequest = new SmsCodeUseReqDTO();
        useRequest.setCode(reqVO.getCode());
        useRequest.setMobile(reqVO.getMobile());
        useRequest.setScene(SmsSceneEnum.ADMIN_MEMBER_RESET_PASSWORD.getScene());
        useRequest.setUsedIp(clientIp);
        try {
            smsCodeApi.useSmsCode(useRequest);
        } catch (ServiceException ex) {
            smsLoginFailureLockService.recordFailure(reqVO.getMobile(), clientIp);
            createLoginLog(null, reqVO.getMobile(), LoginLogTypeEnum.PASSWORD_RESET, LoginResultEnum.SMS_CODE_ERROR);
            throw ex;
        }

        AdminUserDO userByMobile = userService.getUserByMobile(reqVO.getMobile());
        if (userByMobile == null) {
            smsLoginFailureLockService.recordFailure(reqVO.getMobile(), clientIp);
            createLoginLog(null, reqVO.getMobile(), LoginLogTypeEnum.PASSWORD_RESET,
                    LoginResultEnum.USER_MOBILE_NOT_FOUND);
            throw exception(ErrorCodeConstants.SMS_CODE_NOT_FOUND);
        }
        if (CommonStatusEnum.isDisable(userByMobile.getStatus())) {
            createLoginLog(userByMobile.getId(), userByMobile.getUsername(), LoginLogTypeEnum.PASSWORD_RESET,
                    LoginResultEnum.USER_DISABLED);
            throw exception(ErrorCodeConstants.AUTH_LOGIN_USER_DISABLED);
        }
        // 超级管理员账号严禁通过匿名短信找回重置密码，防止手机号接管穿透最高权限边界。
        if (!AdminPlatformTypeEnum.isSame(userByMobile.getUserType(), AdminPlatformTypeEnum.BUSINESS_ADMIN.getType())) {
            smsLoginFailureLockService.recordFailure(reqVO.getMobile(), clientIp);
            createLoginLog(userByMobile.getId(), userByMobile.getUsername(), LoginLogTypeEnum.PASSWORD_RESET,
                    LoginResultEnum.BAD_CREDENTIALS);
            throw exception(ErrorCodeConstants.SMS_CODE_NOT_FOUND);
        }

        smsLoginFailureLockService.clearFailures(reqVO.getMobile(), clientIp);
        userService.updateUserPassword(userByMobile.getId(), reqVO.getPassword());
    }

}
