package com.basicframework.module.system.mq.producer.sms;

import com.basicframework.framework.common.core.KeyValue;
import com.basicframework.module.system.mq.message.sms.SmsSendMessage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationContext;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * 验证短信发送事件在"记录日志"与"真正发送"之间搬运字段的完整性。
 *
 * <p>发送流程被拆成写日志与异步发送两段，二者之间只靠这条事件传递上下文。字段在这里被静默搬运，
 * 没有二次校验：一旦日志编号与渠道编号被写反、或渠道编号与渠道侧模板编号配错，短信仍会"发送成功"，
 * 但会投递到错误的手机号或错误的模板上，而日志里的手机号看起来完全正常。因此这里逐个字段核对搬运
 * 结果，而不是只断言事件被发布过一次。</p>
 *
 * <p>应用上下文按进程外边界替换为可观察替身，事件的构造与发布真实执行。</p>
 *
 * @author shady2713
 */
class SmsProducerTest {

    /** 被测生产者，应用上下文按外部边界替换为可观察替身。 */
    private SmsProducer smsProducer;
    /** 记录已发布事件的应用上下文替身。 */
    private ApplicationContext applicationContext;

    /**
     * 为每个用例创建独立生产者与替身，避免用例之间共享调用记录。
     */
    @BeforeEach
    void setUp() {
        smsProducer = new SmsProducer();
        applicationContext = mock(ApplicationContext.class);
        ReflectionTestUtils.setField(smsProducer, "applicationContext", applicationContext);
    }

    /** 五个上下文字段必须原样搬运到事件上，日志编号与渠道编号不得互换。 */
    @Test
    void sendSmsSendMessageCarriesEveryContextField() {
        List<KeyValue<String, Object>> templateParams = List.of(new KeyValue<>("code", 123456));

        smsProducer.sendSmsSendMessage(1024L, "13800000000", 3L, "SMS_001", templateParams);

        ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
        verify(applicationContext).publishEvent(captor.capture());
        assertThat(captor.getValue()).isInstanceOf(SmsSendMessage.class);
        SmsSendMessage message = (SmsSendMessage) captor.getValue();
        assertThat(message.getLogId()).isEqualTo(1024L);
        assertThat(message.getMobile()).isEqualTo("13800000000");
        assertThat(message.getChannelId()).isEqualTo(3L);
        assertThat(message.getApiTemplateId()).isEqualTo("SMS_001");
        assertThat(message.getTemplateParams()).isEqualTo(templateParams);
    }

    /** 无模板参数的短信也要把空参数列表发出去，接收方不必区分"无参数"和"未赋值"。 */
    @Test
    void sendSmsSendMessageKeepsEmptyTemplateParams() {
        smsProducer.sendSmsSendMessage(1L, "13800000000", 2L, null, List.of());

        ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
        verify(applicationContext).publishEvent(captor.capture());
        SmsSendMessage message = (SmsSendMessage) captor.getValue();
        assertThat(message.getTemplateParams()).isEmpty();
        assertThat(message.getApiTemplateId()).isNull();
        assertThat(message.getLogId()).isEqualTo(1L);
    }

    /** 每次发送各自发布一条事件且互不复用上下文，两条短信的日志编号不能串号。 */
    @Test
    void sendSmsSendMessagePublishesOneIndependentEventPerCall() {
        smsProducer.sendSmsSendMessage(1L, "13800000000", 2L, "SMS_001", List.of());
        smsProducer.sendSmsSendMessage(2L, "13900000000", 2L, "SMS_002", List.of());

        ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
        verify(applicationContext, times(2)).publishEvent(captor.capture());
        assertThat(captor.getAllValues()).hasSize(2);
        assertThat(((SmsSendMessage) captor.getAllValues().get(0)).getLogId()).isEqualTo(1L);
        assertThat(((SmsSendMessage) captor.getAllValues().get(1)).getMobile()).isEqualTo("13900000000");
    }
}