package com.basicframework.module.system.service.auth;

import com.basicframework.module.system.controller.admin.auth.vo.AuthLoginReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthLoginRespVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthResetPasswordReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthSmsLoginReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthSmsSendReqVO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import jakarta.validation.Valid;

/**
 * 管理后台的认证 Service 接口，提供登录、登出、令牌刷新与受控密码重置能力。
 *
 * @author 李杰
 */
public interface AdminAuthService {

    /**
     * 在执行国密解密前完成验证码与账号锁定前置检查，防止未锁定检查前消耗密码学算力与防重放存储。
     *
     * @param reqVO 登录请求
     */
    void precheckLogin(@Valid AuthLoginReqVO reqVO);

    /**
     * 在执行密码重置密文解密前校验手机号与客户端 IP 是否处于锁定期。
     *
     * @param mobile 目标手机号
     */
    void precheckSmsAttempt(String mobile);

    /**
     * 验证业务平台账号与密码，通过时返回用户实体。
     *
     * @param username 账号
     * @param password 明文密码
     * @return 用户实体
     */
    AdminUserDO authenticate(String username, String password);

    /**
     * 验证指定平台类型的账号与密码，通过时返回用户实体。
     *
     * @param username 账号
     * @param password 明文密码
     * @param userType 后台平台类型
     * @return 用户实体
     */
    AdminUserDO authenticate(String username, String password, String userType);

    /**
     * 业务管理平台账号登录。
     *
     * @param reqVO 已解密密码的登录请求
     * @return 登录令牌及改密标志
     */
    AuthLoginRespVO login(@Valid AuthLoginReqVO reqVO);

    /**
     * 超级管理平台账号登录，仅允许 {@code super_admin} 类型账号进入。
     *
     * @param reqVO 已解密密码的登录请求
     * @return 登录令牌及改密标志
     */
    AuthLoginRespVO superAdminLogin(@Valid AuthLoginReqVO reqVO);

    /**
     * 基于访问令牌注销当前会话。
     *
     * @param token 访问令牌
     * @param logType 登出日志类型
     */
    void logout(String token, Integer logType);

    /**
     * 校验图形验证码后向指定手机号发送短信验证码。
     *
     * @param reqVO 发送请求
     */
    void sendSmsCode(AuthSmsSendReqVO reqVO);

    /**
     * 使用短信验证码登录业务管理平台。
     *
     * @param reqVO 登录请求
     * @return 登录令牌及改密标志
     */
    AuthLoginRespVO smsLogin(AuthSmsLoginReqVO reqVO);

    /**
     * 使用刷新令牌换取新访问令牌。
     *
     * @param refreshToken 刷新令牌
     * @return 新的登录令牌信息
     */
    AuthLoginRespVO refreshToken(String refreshToken);

    /**
     * 校验短信验证码并重置业务管理平台启用账号的密码。
     *
     * @param reqVO 重置密码请求
     */
    void resetPassword(AuthResetPasswordReqVO reqVO);

}
