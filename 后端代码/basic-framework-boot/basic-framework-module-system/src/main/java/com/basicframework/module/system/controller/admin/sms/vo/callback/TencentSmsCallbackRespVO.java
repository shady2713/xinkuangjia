package com.basicframework.module.system.controller.admin.sms.vo.callback;

/**
 * 腾讯云短信回执响应。
 *
 * <p>只承载腾讯云要求的两个字段：{@code result} 与 {@code errmsg}。应答描述成功固定为
 * {@code OK}、失败固定为 {@code FAILED}，不回显腾讯云推送的原始报文，避免把回执正文
 * 写进响应或日志。</p>
 *
 * @param result 应答编码；0 与 HTTP 200 一起返回表示回执已接收，1 表示处理失败
 * @param errmsg 应答描述；成功固定为 {@code OK}，失败固定为 {@code FAILED}
 * @author 李杰
 */
public record TencentSmsCallbackRespVO(Integer result, String errmsg) {

    /**
     * 创建成功响应。
     *
     * @return 腾讯云要求的成功响应
     */
    public static TencentSmsCallbackRespVO success() {
        return new TencentSmsCallbackRespVO(0, "OK");
    }

    /**
     * 创建失败响应。
     *
     * @return 腾讯云回执处理失败响应
     */
    public static TencentSmsCallbackRespVO failure() {
        return new TencentSmsCallbackRespVO(1, "FAILED");
    }

}
