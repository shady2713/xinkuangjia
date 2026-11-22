package com.basicframework.module.system.enums.security;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 用户访问令牌失效原因，用于吊销事件和安全日志。
 *
 * @author shady2713
 */
@Getter
@AllArgsConstructor
public enum UserTokenInvalidationReasonEnum {

    /** 用户自助修改密码。 */
    PASSWORD_CHANGED("password-changed"),

    /** 短信重置或管理员重置密码。 */
    PASSWORD_RESET("password-reset"),

    /** 用户被删除。 */
    USER_DELETED("user-deleted"),

    ;

    /**
     * 稳定编码，写入日志时避免依赖枚举名称。
     */
    private final String reason;

}
