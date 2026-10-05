package com.basicframework.module.system.framework.sms.core.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 短信模板的审核状态枚举
 *
 * @author 李杰
 */
@AllArgsConstructor
@Getter
public enum SmsTemplateAuditStatusEnum {

    /** 审核中，状态值 1；不允许发送，发送前校验会直接报错。 */
    CHECKING(1),
    /** 审核通过，状态值 2；只有该状态允许发送。 */
    SUCCESS(2),
    /** 审核不通过，状态值 3；校验失败时把渠道返回的审核原因一并抛出。 */
    FAIL(3);

    /**
     * 审核状态值，各渠道客户端把渠道侧的审核状态归一化为该值
     */
    private final Integer status;

}
