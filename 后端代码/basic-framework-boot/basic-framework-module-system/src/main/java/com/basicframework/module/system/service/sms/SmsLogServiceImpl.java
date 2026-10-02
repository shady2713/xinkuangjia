package com.basicframework.module.system.service.sms;

import com.basicframework.module.system.dal.dataobject.sms.SmsLogDO;
import com.basicframework.module.system.dal.dataobject.sms.SmsTemplateDO;
import com.basicframework.module.system.dal.mysql.sms.SmsLogMapper;
import com.basicframework.module.system.enums.sms.SmsReceiveStatusEnum;
import com.basicframework.module.system.enums.sms.SmsSendStatusEnum;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import jakarta.annotation.Resource;
import java.time.LocalDateTime;
import java.util.Map;

/**
 * 短信日志 Service 实现类（仅保留写入方法）
 *
 * @author 李杰
 */
@Service
@Slf4j
public class SmsLogServiceImpl implements SmsLogService {

    @Resource
    private SmsLogMapper smsLogMapper;

    /**
     * 创建短信日志。
     *
     * @param mobile mobile 参数
     * @param userId 用户编号
     * @param userType userType 参数
     * @param isSend isSend 参数
     * @param template template 参数
     * @param templateContent templateContent 参数
     * @param templateParams templateParams 参数
     * @return 操作结果
     */
    @Override
    public Long createSmsLog(String mobile, Long userId, Integer userType,
                             Boolean isSend, SmsTemplateDO template, String templateContent,
                             Map<String, Object> templateParams) {
        SmsLogDO smsLogDO = SmsLogDO.builder()
                .mobile(mobile)
                .userId(userId)
                .userType(userType)
                .channelId(template.getChannelId())
                .channelCode(template.getChannelCode())
                .templateId(template.getId())
                .templateCode(template.getCode())
                .templateType(template.getType())
                .templateContent(templateContent)
                .templateParams(templateParams)
                .apiTemplateId(template.getApiTemplateId())
                .sendStatus(isSend ? SmsSendStatusEnum.INIT.getStatus() : SmsSendStatusEnum.IGNORE.getStatus())
                .receiveStatus(SmsReceiveStatusEnum.INIT.getStatus())
                .build();
        smsLogMapper.insert(smsLogDO);
        return smsLogDO.getId();
    }

    /**
     * 更新短信Send结果。
     *
     * @param id 主键编号
     * @param success success 参数
     * @param apiSendCode apiSendCode 参数
     * @param apiSendMsg apiSendMsg 参数
     * @param apiRequestId apiRequestId 编号
     * @param apiSerialNo apiSerialNo 参数
     */
    @Override
    public void updateSmsSendResult(Long id, Boolean success,
                                    String apiSendCode, String apiSendMsg,
                                    String apiRequestId, String apiSerialNo) {
        SmsLogDO updateObj = new SmsLogDO();
        updateObj.setId(id);
        updateObj.setSendStatus(success ? SmsSendStatusEnum.SUCCESS.getStatus() : SmsSendStatusEnum.FAILURE.getStatus());
        updateObj.setSendTime(LocalDateTime.now());
        updateObj.setApiSendCode(apiSendCode);
        updateObj.setApiSendMsg(apiSendMsg);
        updateObj.setApiRequestId(apiRequestId);
        updateObj.setApiSerialNo(apiSerialNo);
        smsLogMapper.updateById(updateObj);
    }

    /**
     * 根据回执中的内部编号、供应商流水号和手机号更新接收结果。
     *
     * <p>腾讯云不返回内部日志编号，因此必须使用发送时保存的流水号关联；未匹配时抛出异常，
     * 由回调入口返回 HTTP 50X 触发供应商重试。</p>
     *
     * @param id 短信日志编号，可为空
     * @param apiSerialNo 平台流水号
     * @param mobile 手机号
     * @param success 是否接收成功
     * @param receiveTime 接收时间
     * @param apiErrorCode 平台错误编码
     * @param apiErrorMsg 平台错误描述
     */
    @Override
    public void updateSmsReceiveResult(Long id, String apiSerialNo, String mobile,
                                       Boolean success, LocalDateTime receiveTime,
                                       String apiErrorCode, String apiErrorMsg) {
        SmsLogDO smsLog = smsLogMapper.selectByReceiveCallback(id, apiSerialNo, mobile);
        if (smsLog == null) {
            throw new IllegalStateException("短信回执无法匹配发送日志");
        }
        SmsLogDO updateObj = new SmsLogDO();
        updateObj.setId(smsLog.getId());
        updateObj.setReceiveStatus(success ? SmsReceiveStatusEnum.SUCCESS.getStatus() : SmsReceiveStatusEnum.FAILURE.getStatus());
        updateObj.setReceiveTime(receiveTime);
        updateObj.setApiSerialNo(apiSerialNo);
        updateObj.setApiReceiveCode(apiErrorCode);
        updateObj.setApiReceiveMsg(apiErrorMsg);
        smsLogMapper.updateById(updateObj);
    }

}
