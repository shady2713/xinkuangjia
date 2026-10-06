package com.basicframework.module.system.enums.logger;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 登录结果的枚举类
 * @author 李杰
 * 署名验收：尚未验收
 */
@Getter
@AllArgsConstructor
public enum LoginResultEnum {

    /** 登录成功，结果码 0；分页查询以此值判定成功记录。 */
    SUCCESS(0),
    /** 账号不存在或密码错误，结果码 10；两种情况共用同一结果，避免暴露账号是否存在。 */
    BAD_CREDENTIALS(10),
    /** 账号被禁用或不属于当前登录平台，结果码 20。 */
    USER_DISABLED(20),
    /** 图形验证码缺失，结果码 30；当前登录流程由验证码组件直接抛错，未写入该结果。 */
    CAPTCHA_NOT_FOUND(30),
    /** 图形验证码校验不通过，结果码 31。 */
    CAPTCHA_CODE_ERROR(31),

    ;

    /**
     * 结果
     */
    private final Integer result;

}
