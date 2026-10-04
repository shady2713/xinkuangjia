package com.basicframework.module.system.mq.consumer.sms;

import com.basicframework.module.system.mq.message.sms.SmsSendMessage;
import com.basicframework.module.system.service.sms.SmsSendService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * 验证短信发送消费者的委派与手机号脱敏契约。
 *
 * <p>消费者只负责把消息交给发送服务，消息实例必须原样传递（服务依赖其中的日志编号与渠道编号），
 * 任何复制或重建都会让发送记录与渠道对不上。日志里输出的手机号必须脱敏：完整号码进入应用日志
 * 属于个人信息泄露，短号与空值统一输出占位符，避免日志出现半截号码或 null。</p>
 *
 * @author shady2713
 */
class SmsSendConsumerTest {

    /** 被测消费者。 */
    private final SmsSendConsumer consumer = new SmsSendConsumer();

    /** 短信发送服务替身。 */
    private final SmsSendService smsSendService = mock(SmsSendService.class);

    /** 收到消息必须把同一实例交给发送服务。 */
    @Test
    void onMessageDelegatesSameMessageInstance() {
        ReflectionTestUtils.setField(consumer, "smsSendService", smsSendService);
        SmsSendMessage message = message();

        consumer.onMessage(message);

        verify(smsSendService).doSendSms(message);
    }

    /** 完整手机号只保留前三后四，中间四位固定脱敏。 */
    @Test
    void fullMobileIsMaskedKeepingPrefixAndSuffix() {
        assertThat(maskMobile("13800000000")).isEqualTo("138****0000");
        assertThat(maskMobile("13912345678")).isEqualTo("139****5678");
    }

    /** 空值与过短号码统一输出占位符，避免泄露半截号码。 */
    @Test
    void shortOrMissingMobileIsFullyMasked() {
        assertThat(maskMobile(null)).isEqualTo("***");
        assertThat(maskMobile("")).isEqualTo("***");
        assertThat(maskMobile("123456")).as("不足 7 位无法保留前后缀，必须整体脱敏").isEqualTo("***");
    }

    /**
     * 调用私有脱敏方法，锁定日志中手机号的真实输出形态。
     *
     * <p>脱敏结果只出现在日志行里，没有其它可观察出口，因此直接调用该方法断言其输出，
     * 避免用日志文本解析这种脆弱方式验证。</p>
     *
     * @param mobile 手机号
     * @return 脱敏后的手机号
     */
    private String maskMobile(String mobile) {
        return ReflectionTestUtils.invokeMethod(consumer, "maskMobile", mobile);
    }

    /**
     * 构造短信发送消息。
     *
     * @return 短信发送消息
     */
    private static SmsSendMessage message() {
        SmsSendMessage message = new SmsSendMessage();
        message.setLogId(1L);
        message.setChannelId(2L);
        message.setMobile("13800000000");
        message.setApiTemplateId("DUMMY-API-TEMPLATE");
        return message;
    }

}
