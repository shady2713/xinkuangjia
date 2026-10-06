package com.basicframework.module.system.controller.admin.sms.vo.callback;

/**
 * 阿里云短信回执响应。
 *
 * <p>只承载阿里云要求的两个字段：{@code code} 与 {@code msg}。应答描述固定为「接收成功」或
 * 「接收失败」，不回显阿里云推送的原始报文，避免把回执正文写进响应或日志。</p>
 *
 * @param code 应答编码；0 与 HTTP 200 一起返回表示回执已接收，1 表示处理失败
 * @param msg 应答描述；固定为「接收成功」或「接收失败」
 * @author 李杰
 */
public record AliyunSmsCallbackRespVO(
        /** 应答编码：0 与 HTTP 200 一起返回表示回执已接收，1 表示处理失败；只取这两个值。 */
        Integer code,
        /** 应答描述：固定为「接收成功」或「接收失败」；不回显回执正文。 */
        String msg) {

    /**
     * 创建成功响应。
     *
     * @return 阿里云要求的成功响应
     */
    public static AliyunSmsCallbackRespVO success() {
        return new AliyunSmsCallbackRespVO(0, "接收成功");
    }

    /**
     * 创建失败响应。
     *
     * @return 阿里云回执处理失败响应
     */
    public static AliyunSmsCallbackRespVO failure() {
        return new AliyunSmsCallbackRespVO(1, "接收失败");
    }

}
