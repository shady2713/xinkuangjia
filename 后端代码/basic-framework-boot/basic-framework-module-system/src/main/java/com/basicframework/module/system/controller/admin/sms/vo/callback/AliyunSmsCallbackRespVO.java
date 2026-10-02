package com.basicframework.module.system.controller.admin.sms.vo.callback;

/**
 * 阿里云短信回执响应。
 *
 * @param code 应答编码，0 表示处理成功
 * @param msg 应答描述
 * @author 李杰
 */
public record AliyunSmsCallbackRespVO(Integer code, String msg) {

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
