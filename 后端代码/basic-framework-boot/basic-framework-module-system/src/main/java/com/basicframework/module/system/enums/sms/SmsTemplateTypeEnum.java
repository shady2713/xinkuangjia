package com.basicframework.module.system.enums.sms;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 短信模板类型枚举
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@Getter
@AllArgsConstructor
public enum SmsTemplateTypeEnum {

    /** 验证码 */
    VERIFICATION_CODE(1),
    /** 通知 */
    NOTICE(2),
    /** 营销 */
    PROMOTION(3),
    ;

    /**
     * 类型
     */
    private final int type;

}
