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

    /** 阿里云短信，渠道编码 ALIYUN；回执地址 /admin-api/system/sms/callback/aliyun。 */
    ALIYUN("ALIYUN", "阿里云"),
    /** 腾讯云短信，渠道编码 TENCENT；回执地址 /admin-api/system/sms/callback/tencent。 */
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

