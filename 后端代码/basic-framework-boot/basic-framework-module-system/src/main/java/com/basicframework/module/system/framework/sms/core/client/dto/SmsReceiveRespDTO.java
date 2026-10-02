package com.basicframework.module.system.framework.sms.core.client.dto;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 消息接收 Response DTO
 *
 * @author 李杰
 */
@Data
public class SmsReceiveRespDTO {

    /**
     * 是否接收成功
     */
    private Boolean success;
    /**
     * API 接收结果的编码
     */
    private String errorCode;
    /**
     * API 接收结果的说明
     */
    private String errorMsg;

    /**
     * 手机号
     */
    private String mobile;
    /**
     * 用户接收时间
     */
    private LocalDateTime receiveTime;

    /**
     * 短信 API 发送返回的序号
     */
    private String serialNo;
    /**
     * 短信日志编号
     *
     * 对应系统短信日志编号；部分供应商回执不返回该字段
     */
    private Long logId;

}
