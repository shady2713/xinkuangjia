package com.basicframework.module.system.service.sms;

import com.basicframework.module.system.dal.dataobject.sms.SmsTemplateDO;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * 短信日志服务接口。
 * <p>
 * 仅保留短信日志写入与发送/接收结果更新能力。
 *
 * @author 李杰
 */
public interface SmsLogService {

    /**
     * 创建短信日志。
     *
     * @param mobile          手机号
     * @param userId          用户编号
     * @param userType        用户类型
     * @param isSend          是否进入实际发送流程
     * @param template        短信模板
     * @param templateContent 渲染后的模板内容
     * @param templateParams  模板参数
     * @return 短信日志编号
     */
    Long createSmsLog(String mobile, Long userId, Integer userType,
                      Boolean isSend, SmsTemplateDO template, String templateContent,
                      Map<String, Object> templateParams);

    /**
     * 更新短信发送结果。
     *
     * @param id           短信日志编号
     * @param success      是否发送成功
     * @param apiSendCode  平台发送结果编码
     * @param apiSendMsg   平台发送结果描述
     * @param apiRequestId 平台请求编号
     * @param apiSerialNo  平台流水号
     */
    void updateSmsSendResult(Long id, Boolean success,
                             String apiSendCode, String apiSendMsg,
                             String apiRequestId, String apiSerialNo);

    /**
     * 更新短信接收结果。
     *
     * @param id           短信日志编号
     * @param apiSerialNo  平台流水号
     * @param mobile       手机号
     * @param success      是否接收成功
     * @param receiveTime  接收时间
     * @param apiErrorCode 平台错误编码
     * @param apiErrorMsg  平台错误描述
     */
    void updateSmsReceiveResult(Long id, String apiSerialNo, String mobile,
                                Boolean success, LocalDateTime receiveTime,
                                String apiErrorCode, String apiErrorMsg);

}
