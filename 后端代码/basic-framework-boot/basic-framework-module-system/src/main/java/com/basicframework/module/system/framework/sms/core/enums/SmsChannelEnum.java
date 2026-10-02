package com.basicframework.module.system.framework.sms.core.enums;

import cn.hutool.core.util.ArrayUtil;
import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 短信渠道枚举
 *
 * @since 2021/1/25 10:56
 * @author 李杰
 */
@Getter
@AllArgsConstructor
public enum SmsChannelEnum {

    ALIYUN("ALIYUN", "阿里云"),
    TENCENT("TENCENT", "腾讯云"),
    ;

    /**
     * 编码
     */
    private final String code;
    /**
     * 名字
     */
    private final String name;

    /**
     * 获取By编码。
     *
     * @param code 编码
     * @return 查询结果
     */
    public static SmsChannelEnum getByCode(String code) {
        return ArrayUtil.firstMatch(o -> o.getCode().equals(code), values());
    }

}

