package com.basicframework.module.system.service.sms;

import com.basicframework.module.system.mq.message.sms.SmsSendMessage;

import java.util.List;
import java.util.Map;

/**
 * 短信发送服务接口。
 * <p>
 * 提供单条短信发送、批量发送扩展点、MQ 实际发送和短信回执接收能力。
 *
 * @author 李杰
 */
public interface SmsSendService {

    /**
     * 发送单条短信给管理后台用户。
     * <p>
     * 当手机号为空时，会按用户编号加载管理员手机号。
     *
     * @param mobile         手机号
     * @param userId         用户编号
     * @param templateCode   短信模板编码
     * @param templateParams 短信模板参数
     * @return 短信发送日志编号
     */
    Long sendSingleSmsToAdmin(String mobile, Long userId,
                              String templateCode, Map<String, Object> templateParams);

    /**
     * 发送单条短信给会员用户。
     *
     * @param mobile         手机号
     * @param userId         用户编号
     * @param templateCode   短信模板编码
     * @param templateParams 短信模板参数
     * @return 短信发送日志编号
     */
    Long sendSingleSmsToMember(String mobile, Long userId,
                               String templateCode, Map<String, Object> templateParams);

    /**
     * 发送单条短信给指定类型用户。
     *
     * @param mobile         手机号
     * @param userId         用户编号
     * @param userType       用户类型
     * @param templateCode   短信模板编码
     * @param templateParams 短信模板参数
     * @return 短信发送日志编号
     */
    Long sendSingleSms(String mobile, Long userId, Integer userType,
                       String templateCode, Map<String, Object> templateParams);

    /**
     * 批量发送短信。
     * <p>
     * 当前默认实现不支持批量发送，业务需要时由实现类覆盖。
     *
     * @param mobiles        手机号列表
     * @param userIds        用户编号列表
     * @param userType       用户类型
     * @param templateCode   短信模板编码
     * @param templateParams 短信模板参数
     */
    default void sendBatchSms(List<String> mobiles, List<Long> userIds, Integer userType,
                              String templateCode, Map<String, Object> templateParams) {
        throw new UnsupportedOperationException("暂时不支持该操作，感兴趣可以实现该功能哟！");
    }

    /**
     * 执行实际短信发送。
     * <p>
     * 该方法由 MQ Consumer 调用。
     *
     * @param message 短信发送消息
     */
    void doSendSms(SmsSendMessage message);

    /**
     * 接收短信平台回执结果。
     *
     * @param channelCode 渠道编码
     * @param text        回执内容
     */
    void receiveSmsStatus(String channelCode, String text);

}
