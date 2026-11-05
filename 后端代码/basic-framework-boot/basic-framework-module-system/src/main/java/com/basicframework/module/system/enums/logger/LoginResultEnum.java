package com.basicframework.module.system.enums.logger;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 登录结果的枚举类
 * @author 李杰
 */
@Getter
@AllArgsConstructor
public enum LoginResultEnum {

    SUCCESS(0), // 成功
    BAD_CREDENTIALS(10), // 账号或密码不正确
    USER_DISABLED(20), // 用户被禁用
    CAPTCHA_NOT_FOUND(30), // 图片验证码不存在
    CAPTCHA_CODE_ERROR(31), // 图片验证码不正确
    USER_LOCKED(40), // 登录失败次数过多被临时锁定
    SMS_CODE_ERROR(50), // 短信验证码错误、过期或已使用
    USER_MOBILE_NOT_FOUND(60), // 手机号未注册（仅审计记录，不直接返回给调用方）
    SM2_DECRYPT_ERROR(70), // SM2 密文、载荷或时间戳校验失败
    SM2_REPLAY_REJECTED(71), // SM2 nonce 重放被拒绝
    SM2_REPLAY_CHECK_UNAVAILABLE(72), // 防重放依赖不可用导致校验失败
    PASSWORD_VERIFY_FAILED(73), // 自助改密时旧密码校验失败
    PASSWORD_POLICY_REJECTED(74), // 新密码不满足复杂度策略

    ;

    /**
     * 结果
     */
    private final Integer result;

}
