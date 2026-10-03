package com.basicframework.module.system.service.sms;

import cn.hutool.core.util.StrUtil;
import com.basicframework.module.system.dal.dataobject.sms.SmsLogDO;
import com.basicframework.module.system.dal.dataobject.sms.SmsTemplateDO;
import com.basicframework.module.system.dal.mysql.sms.SmsLogMapper;
import com.basicframework.module.system.enums.sms.SmsReceiveStatusEnum;
import com.basicframework.module.system.enums.sms.SmsSendStatusEnum;
import com.basicframework.module.system.framework.sms.core.client.SmsReceiptException;
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
     * 根据渠道、供应商流水号和手机号将匹配日志推进到首次接收终态。
     *
     * <p>匿名回执只能更新已有发送日志，内部编号不能替代三项关联条件。
     * 接收状态条件与数据写入在同一条 UPDATE 中完成，避免并发、重复或乱序回执覆盖终态。</p>
     *
     * @param channelCode 回调入口对应的供应商渠道编码，不可为空
     * @param id 短信日志编号，可为空
     * @param apiSerialNo 平台流水号，不可为空
     * @param mobile 发送时保存的手机号，不可为空
     * @param success 是否接收成功，不可为 {@code null}
     * @param receiveTime 供应商报告的接收时间，不可为 {@code null}
     * @param apiErrorCode 平台错误编码
     * @param apiErrorMsg 平台错误描述
     * @throws SmsReceiptException 回执必要字段不完整或未匹配已有日志，异常仅携带固定原因分类
     */
    @Override
    public void updateSmsReceiveResult(String channelCode, Long id, String apiSerialNo, String mobile,
                                       Boolean success, LocalDateTime receiveTime,
                                       String apiErrorCode, String apiErrorMsg) {
        if (StrUtil.isBlank(channelCode) || StrUtil.isBlank(apiSerialNo) || StrUtil.isBlank(mobile)
                || success == null || receiveTime == null) {
            throw new SmsReceiptException("invalid_identifiers");
        }
        SmsLogDO smsLog = smsLogMapper.selectByReceiveCallback(channelCode, id, apiSerialNo, mobile);
        if (smsLog == null) {
            throw new SmsReceiptException("unmatched_receipt");
        }
        SmsLogDO updateObj = new SmsLogDO();
        updateObj.setReceiveStatus(success ? SmsReceiveStatusEnum.SUCCESS.getStatus() : SmsReceiveStatusEnum.FAILURE.getStatus());
        updateObj.setReceiveTime(receiveTime);
        updateObj.setApiReceiveCode(apiErrorCode);
        updateObj.setApiReceiveMsg(apiErrorMsg);
        // 首次终态后更新行数为零仍属于已处理的合法回执，供应商重投不能改写已确认结果。
        smsLogMapper.updateReceiveResultIfInitial(smsLog.getId(), channelCode, apiSerialNo, mobile, updateObj);
    }

}
