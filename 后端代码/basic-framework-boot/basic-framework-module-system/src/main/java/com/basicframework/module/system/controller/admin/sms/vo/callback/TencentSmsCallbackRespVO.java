package com.basicframework.module.system.controller.admin.sms.vo.callback;

/**
 * 腾讯云短信回执响应。
 *
 * @param result 应答编码，0 表示处理成功
 * @param errmsg 应答描述
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
