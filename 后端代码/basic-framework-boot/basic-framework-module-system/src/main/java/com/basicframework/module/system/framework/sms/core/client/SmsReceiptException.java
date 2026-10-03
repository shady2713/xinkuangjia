package com.basicframework.module.system.framework.sms.core.client;

/**
 * 标识调用方无法通过重试修复的无效短信回执，避免匿名输入被当作服务故障反复投递。
 *
 * @author shady2713
 */
public class SmsReceiptException extends IllegalArgumentException {

    /**
     * 仅携带固定归类原因，不保留原始报文或解析异常中的敏感内容。
     *
     * @param reason 代码内定义的归类原因，不得包含调用方输入
     */
    public SmsReceiptException(String reason) {
        super(reason);
    }
}
