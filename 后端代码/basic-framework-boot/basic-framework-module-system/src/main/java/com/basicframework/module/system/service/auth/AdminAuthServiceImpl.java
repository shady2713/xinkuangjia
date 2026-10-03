package com.basicframework.module.system.service.auth;

import cn.hutool.core.util.ObjectUtil;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.enums.UserTypeEnum;
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
import com.basicframework.module.system.controller.admin.auth.vo.AuthShareLoginRespVO;
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
import com.basicframework.module.system.framework.auth.config.AdminAuthenticationProperties;
import com.basicframework.module.system.service.logger.LoginLogService;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import com.basicframework.module.system.service.user.AdminUserService;
import com.anji.captcha.model.common.ResponseModel;
import com.anji.captcha.model.vo.CaptchaVO;
import com.anji.captcha.service.CaptchaService;
import com.google.common.annotations.VisibleForTesting;
import jakarta.annotation.Resource;
import jakarta.validation.Validator;
import jakarta.servlet.http.HttpServletRequest;
import lombok.Setter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;

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
    private AdminAuthenticationProperties authenticationProperties;

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
    @Transactional(propagation = Propagation.MANDATORY)
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
    @Transactional(propagation = Propagation.MANDATORY)
    public AdminUserDO authenticate(String username, String password, String userType) {
        final LoginLogTypeEnum logTypeEnum = LoginLogTypeEnum.LOGIN_USERNAME;
        // 登录账号允许跨平台同名，认证时必须按入口平台类型精确查询。
        AdminUserDO user = userService.getUserByUsernameAndType(username, userType);
        if (user == null) {
            createLoginLog(null, username, logTypeEnum, LoginResultEnum.BAD_CREDENTIALS);
            throw exception(AUTH_LOGIN_BAD_CREDENTIALS);
        }
        // 密码校验必须发生在用户锁内，且由登录用例持有事务直到令牌签发完成。
        user = userService.lockUser(user.getId());
        if (!Objects.equals(username, user.getUsername())
                || !AdminPlatformTypeEnum.isSame(user.getUserType(), userType)
                || !userService.isPasswordMatch(password, user.getPassword())) {
            createLoginLog(user.getId(), username, logTypeEnum, LoginResultEnum.BAD_CREDENTIALS);
            throw exception(AUTH_LOGIN_BAD_CREDENTIALS);
        }
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
    @Transactional(rollbackFor = Exception.class)
    public AuthLoginRespVO login(AuthLoginReqVO reqVO) {
        // 校验验证码
        validateCaptcha(reqVO);

        // 使用账号密码，进行登录
        String expectedUserType = AdminPlatformTypeEnum.BUSINESS_ADMIN.getType();
        AdminUserDO user = authenticate(reqVO.getUsername(), reqVO.getPassword(), expectedUserType);
        validateLoginUserType(user, reqVO.getUsername(), expectedUserType);

        // 创建 Token 令牌，记录登录日志
        return createTokenAfterLoginSuccess(user.getId(), reqVO.getUsername(), LoginLogTypeEnum.LOGIN_USERNAME);
    }

    /**
     * 校验超级管理员凭据并创建登录会话。
     *
     * @param reqVO 请求参数
     * @return 方法处理结果
     */
    @Override
    @DataPermission(enable = false)
    @Transactional(rollbackFor = Exception.class)
    public AuthLoginRespVO superAdminLogin(AuthLoginReqVO reqVO) {
        validateCaptcha(reqVO);

        String expectedUserType = AdminPlatformTypeEnum.SUPER_ADMIN.getType();
        AdminUserDO user = authenticate(reqVO.getUsername(), reqVO.getPassword(), expectedUserType);
        validateLoginUserType(user, reqVO.getUsername(), expectedUserType);

        return createTokenAfterLoginSuccess(user.getId(), reqVO.getUsername(), LoginLogTypeEnum.LOGIN_USERNAME);
    }

    /**
     * 登录入口按平台类型隔离：当前平台账号不能登录新平台，新平台账号也不能登录当前平台。
     */
    private void validateLoginUserType(AdminUserDO user, String username, String expectedUserType) {
        if (AdminPlatformTypeEnum.isSame(user.getUserType(), expectedUserType)) {
            return;
        }
        createLoginLog(user.getId(), username, LoginLogTypeEnum.LOGIN_USERNAME, LoginResultEnum.BAD_CREDENTIALS);
        throw exception(AUTH_LOGIN_PLATFORM_MISMATCH);
    }

    /**
     * 拒绝旧版长期分享票据登录；此能力不具备安全生命周期，当前不提供重开配置。
     *
     * @param ticket 旧客户端传入的票据，不查询或消费
     * @return 当前实现始终抛出分享登录未开放的业务异常
     */
    @Override
    public AuthShareLoginRespVO shareLogin(String ticket) {
        throw exception(AUTH_SHARE_LOGIN_DISABLED);
    }

    /**
     * 发送短信验证码。
     *
     * @param reqVO 请求参数
     */
    @Override
    public void sendSmsCode(AuthSmsSendReqVO reqVO) {
        if (!Objects.equals(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene(), reqVO.getScene())
                && !Objects.equals(SmsSceneEnum.ADMIN_MEMBER_RESET_PASSWORD.getScene(), reqVO.getScene())) {
            throw exception(SMS_CODE_NOT_FOUND);
        }
        // 如果是重置密码场景，需要校验图形验证码是否正确
        if (Objects.equals(SmsSceneEnum.ADMIN_MEMBER_RESET_PASSWORD.getScene(), reqVO.getScene())) {
            ResponseModel response = doValidateCaptcha(reqVO);
            if (!response.isSuccess()) {
                throw exception(AUTH_REGISTER_CAPTCHA_CODE_ERROR, response.getRepMsg());
            }
        }

        // 对不存在、禁用和其他平台账号统一返回接受请求，避免短信发送入口枚举账号状态。
        AdminUserDO user = userService.getUserByMobileAndType(reqVO.getMobile(), AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        if (user == null || !CommonStatusEnum.isEnable(user.getStatus())) {
            return;
        }
        // 发送验证码
        SmsCodeSendReqDTO sendRequest = AuthConvert.INSTANCE.convert(reqVO);
        sendRequest.setCreateIp(getAuthenticationClientIp());
        smsCodeApi.sendSmsCode(sendRequest);
    }

    /**
     * 校验短信验证码并创建登录会话。
     *
     * @param reqVO 请求参数
     * @return 方法处理结果
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public AuthLoginRespVO smsLogin(AuthSmsLoginReqVO reqVO) {
        // 获得用户信息
        AdminUserDO user = userService.getUserByMobileAndType(reqVO.getMobile(), AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        if (user == null) {
            throw exception(USER_NOT_EXISTS);
        }
        user = userService.lockUser(user.getId());
        if (!Objects.equals(reqVO.getMobile(), user.getMobile()) || !CommonStatusEnum.isEnable(user.getStatus())
                || !AdminPlatformTypeEnum.isSame(user.getUserType(), AdminPlatformTypeEnum.BUSINESS_ADMIN.getType())) {
            throw exception(AUTH_LOGIN_USER_DISABLED);
        }
        // 和改密串行化整个短信认证到签发过程；验证码消费失败不产生会话。
        smsCodeApi.useSmsCode(AuthConvert.INSTANCE.convert(reqVO, SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene(), getAuthenticationClientIp()));

        // 创建 Token 令牌，记录登录日志
        return createTokenAfterLoginSuccess(user.getId(), reqVO.getMobile(), LoginLogTypeEnum.LOGIN_MOBILE);
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
        if (LoginResultEnum.SUCCESS == loginResult) {
            loginLogService.createLoginLog(reqDTO);
        } else {
            loginLogService.createLoginFailureLog(reqDTO);
        }
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
     */
    private AuthLoginRespVO createTokenAfterLoginSuccess(Long userId, String username, LoginLogTypeEnum logType) {
        // 创建访问令牌
        OAuth2AccessTokenDO accessTokenDO = oauth2TokenService.createAccessToken(userId, getUserType().getValue(),
                OAuth2ClientConstants.CLIENT_ID_DEFAULT, null);
        // 成功审计与已签发会话一起提交，签发失败不记录成功。
        createLoginLog(userId, username, logType, LoginResultEnum.SUCCESS);
        // 构建返回结果
        return BeanUtils.toBean(accessTokenDO, AuthLoginRespVO.class);
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
        return BeanUtils.toBean(accessTokenDO, AuthLoginRespVO.class);
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
    @Transactional(rollbackFor = Exception.class)
    public AuthLoginRespVO register(AuthRegisterReqVO registerReqVO) {
        if (!authenticationProperties.isRegistrationEnabled()) {
            throw exception(USER_REGISTER_DISABLED);
        }
        // 1. 校验验证码
        validateCaptcha(registerReqVO);

        // 2. 校验用户名是否已存在
        Long userId = userService.registerUser(registerReqVO);

        // 3. 创建 Token 令牌，记录登录日志
        return createTokenAfterLoginSuccess(userId, registerReqVO.getUsername(), LoginLogTypeEnum.LOGIN_USERNAME);
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
        AdminUserDO userByMobile = userService.getUserByMobileAndType(reqVO.getMobile(), AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        if (userByMobile == null) {
            throw exception(USER_MOBILE_NOT_EXISTS);
        }
        userByMobile = userService.lockUser(userByMobile.getId());
        if (!Objects.equals(reqVO.getMobile(), userByMobile.getMobile())
                || !CommonStatusEnum.isEnable(userByMobile.getStatus())
                || !AdminPlatformTypeEnum.isSame(userByMobile.getUserType(), AdminPlatformTypeEnum.BUSINESS_ADMIN.getType())) {
            throw exception(USER_MOBILE_NOT_EXISTS);
        }

        SmsCodeUseReqDTO useRequest = new SmsCodeUseReqDTO();
        useRequest.setCode(reqVO.getCode());
        useRequest.setMobile(reqVO.getMobile());
        useRequest.setScene(SmsSceneEnum.ADMIN_MEMBER_RESET_PASSWORD.getScene());
        useRequest.setUsedIp(getAuthenticationClientIp());
        smsCodeApi.useSmsCode(useRequest);

        userService.updateUserPassword(userByMobile.getId(), reqVO.getPassword());
    }

    /**
     * 从连接元信息取得限流身份，不自行信任客户端可伪造的转发头。
     *
     * @return 容器提供的远端地址；无 HTTP 上下文时拒绝执行短信认证
     */
    private String getAuthenticationClientIp() {
        HttpServletRequest request = ServletUtils.getRequest();
        if (request == null || request.getRemoteAddr() == null || request.getRemoteAddr().isBlank()) {
            throw exception(SMS_CODE_VERIFY_TOO_FAST);
        }
        return request.getRemoteAddr();
    }
}
