package com.basicframework.module.system.enums.sms;

import cn.hutool.core.util.ArrayUtil;
import com.basicframework.framework.common.core.ArrayValuable;
import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.Arrays;

/**
 * 用户短信验证码发送场景的枚举
 *
 * @author 李杰
 */
@Getter
@AllArgsConstructor
public enum SmsSceneEnum implements ArrayValuable<Integer> {

    /** 会员用户以手机号登录：场景编号 1。 */
    MEMBER_LOGIN(1, "user-sms-login", "会员用户 - 手机号登陆"),
    /** 会员用户更换手机号，需校验新号码：场景编号 2。 */
    MEMBER_UPDATE_MOBILE(2, "user-update-mobile", "会员用户 - 修改手机"),
    /** 会员用户已登录状态下修改密码：场景编号 3。 */
    MEMBER_UPDATE_PASSWORD(3, "user-update-password", "会员用户 - 修改密码"),
    /** 会员用户忘记密码后重置密码：场景编号 4。 */
    MEMBER_RESET_PASSWORD(4, "user-reset-password", "会员用户 - 忘记密码"),

    /** 后台用户以手机号登录：场景编号 21，与会员场景的编号区间分开，便于按端校验。 */
    ADMIN_MEMBER_LOGIN(21, "admin-sms-login", "后台用户 - 手机号登录"),
    /** 后台用户以手机号注册：场景编号 22。 */
    ADMIN_MEMBER_REGISTER(22, "admin-sms-register", "后台用户 - 手机号注册"),
    /** 后台用户忘记密码后重置密码：场景编号 23，发送前额外校验图形验证码。 */
    ADMIN_MEMBER_RESET_PASSWORD(23, "admin-reset-password", "后台用户 - 忘记密码");

    public static final Integer[] ARRAYS = Arrays.stream(values()).map(SmsSceneEnum::getScene).toArray(Integer[]::new);

    /**
     * 验证场景的编号
     */
    private final Integer scene;
    /**
     * 模版编码
     */
    private final String templateCode;
    /**
     * 描述
     */
    private final String description;

    /**
     * 将输入值规范化为数组形式。
     *
     * @return 当前查询包装器
     */
    @Override
    public Integer[] array() {
        return ARRAYS;
    }

    /**
     * 获取编码By场景。
     *
     * @param scene 场景参数
     * @return 查询结果
     */
    public static SmsSceneEnum getCodeByScene(Integer scene) {
        return ArrayUtil.firstMatch(sceneEnum -> sceneEnum.getScene().equals(scene),
                values());
    }

}
