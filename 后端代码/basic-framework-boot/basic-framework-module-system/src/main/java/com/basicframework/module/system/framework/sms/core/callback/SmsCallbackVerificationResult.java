package com.basicframework.module.system.framework.sms.core.callback;

/**
 * 短信回调签名校验结果。
 *
 * @author shady2713
 */
public enum SmsCallbackVerificationResult {

    /**
     * 签名与时间戳均通过校验。
     */
    PASS,

    /**
     * 请求缺少签名或时间戳、时间戳超出允许窗口，或签名不匹配。
     */
    INVALID,

    /**
     * 渠道未配置签名密钥，按失败关闭处理。
     */
    NOT_CONFIGURED

}
