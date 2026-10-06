package com.basicframework.module.system.framework.sms.core.enums;

import cn.hutool.core.util.ArrayUtil;
import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 短信渠道枚举
 *
 * @since 2021/1/25 10:56
 * @author zzf
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
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

