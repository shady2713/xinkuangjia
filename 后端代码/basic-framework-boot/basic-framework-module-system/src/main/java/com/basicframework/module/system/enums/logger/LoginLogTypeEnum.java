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

    /** 账号密码登录；用户名或密码错误时也用该类型记录失败结果。 */
    LOGIN_USERNAME(100),
    /** 社交账号授权登录；框架保留的类型，当前登录入口不产生该记录。 */
    LOGIN_SOCIAL(101),
    /** 手机号加短信验证码登录；后台管理端的短信登录使用该类型。 */
    LOGIN_MOBILE(103),
    /** 短信登录；与手机号登录分开统计，当前登录入口不产生该记录。 */
    LOGIN_SMS(104),
    /** 固定分享码登录；框架保留的类型，当前登录入口不产生该记录。 */
    LOGIN_SHARE(105),

    /** 用户主动退出登录。 */
    LOGOUT_SELF(200),
    /** 强制退出；管理端删除访问令牌时写入。 */
    LOGOUT_DELETE(202),
    ;

    /**
     * 日志类型
     */
    private final Integer type;

}
