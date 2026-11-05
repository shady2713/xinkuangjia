package com.basicframework.module.system.enums.logger;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 登录日志的类型枚举
 * @author 李杰
 */
@Getter
@AllArgsConstructor
public enum LoginLogTypeEnum {

    LOGIN_USERNAME(100), // 使用账号登录
    LOGIN_SOCIAL(101), // 使用社交登录
    LOGIN_MOBILE(103), // 使用手机登陆
    LOGIN_SMS(104), // 使用短信登陆

    LOGOUT_SELF(200),  // 自己主动登出
    LOGOUT_DELETE(202), // 强制退出

    PASSWORD_CHANGE(300), // 用户自助修改密码
    PASSWORD_RESET(301), // 短信或管理员重置密码
    PASSWORD_TRANSPORT(302), // 密码传输解密或防重放校验失败
    ;

    /**
     * 日志类型
     */
    private final Integer type;

}
