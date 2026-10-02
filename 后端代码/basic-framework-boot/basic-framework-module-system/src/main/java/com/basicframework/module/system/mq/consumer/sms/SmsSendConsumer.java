package com.basicframework.module.system.mq.consumer.sms;

import com.basicframework.module.system.mq.message.sms.SmsSendMessage;
import com.basicframework.module.system.service.sms.SmsSendService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

import jakarta.annotation.Resource;

/**
 * 针对 {@link SmsSendMessage} 的消费者
 *
 * @author 李杰
 */
@Component
@Slf4j
public class SmsSendConsumer {

    @Resource
    private SmsSendService smsSendService;

    /**
     * 完成 onMessage 对应的业务处理。
     *
     * @param message 消息对象
     */
    @EventListener
    @Async // Spring Event 默认在 Producer 发送的线程，通过 @Async 实现异步
    public void onMessage(SmsSendMessage message) {
        log.info("[onMessage][短信发送 logId({}) channelId({}) mobile({})]",
                message.getLogId(), message.getChannelId(), maskMobile(message.getMobile()));
        smsSendService.doSendSms(message);
    }

    /**
     * 脱敏Mobile。
     */
    private String maskMobile(String mobile) {
        if (mobile == null || mobile.length() < 7) {
            return "***";
        }
        return mobile.substring(0, 3) + "****" + mobile.substring(mobile.length() - 4);
    }

}