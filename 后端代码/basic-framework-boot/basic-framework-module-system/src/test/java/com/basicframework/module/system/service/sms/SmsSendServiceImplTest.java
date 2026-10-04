package com.basicframework.module.system.service.sms;

import com.basicframework.module.system.framework.sms.core.client.SmsClient;
import com.basicframework.module.system.framework.sms.core.client.SmsReceiptException;
import com.basicframework.module.system.service.sms.SmsChannelService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证短信回执解析失败的归类契约。
 *
 * <p>回执内容是供应商回调的匿名输入。解析异常若原样抛出，会被上层当作可重试的服务故障反复投递；
 * 因此实现必须把解析期异常统一归类成不可重试的“无效回执”，并且只暴露固定归类原因，
 * 不把原始报文带回异常信息。</p>
 *
 * @author shady2713
 */
class SmsSendServiceImplTest {

    /** 被测服务。 */
    private SmsSendServiceImpl smsSendService;
    /** 渠道服务替身，用于返回解析失败的客户端。 */
    private SmsChannelService smsChannelService;

    /** 为每个用例装配独立服务与替身。 */
    @BeforeEach
    void setUp() {
        smsSendService = new SmsSendServiceImpl();
        smsChannelService = mock(SmsChannelService.class);
        ReflectionTestUtils.setField(smsSendService, "smsChannelService", smsChannelService);
    }

    /**
     * 供应商客户端解析回执抛异常时必须归类为无效回执，且不泄露原始报文。
     */
    @Test
    void parseFailureIsClassifiedAsInvalidReceipt() {
        SmsClient smsClient = mock(SmsClient.class);
        when(smsChannelService.getSmsClient("ALIYUN")).thenReturn(smsClient);
        when(smsClient.parseSmsReceiveStatus("not-json"))
                .thenThrow(new IllegalStateException("synthetic-parse-failure"));

        assertThatThrownBy(() -> smsSendService.receiveSmsStatus("ALIYUN", "not-json"))
                .isInstanceOf(SmsReceiptException.class)
                .hasMessage("invalid_fields");

        verify(smsChannelService).getSmsClient("ALIYUN");
    }

    /**
     * 渠道对应的客户端不存在时必须显式失败，不得静默跳过回执处理。
     */
    @Test
    void missingSmsClientFailsExplicitly() {
        when(smsChannelService.getSmsClient("ALIYUN")).thenReturn(null);

        assertThatThrownBy(() -> smsSendService.receiveSmsStatus("ALIYUN", "{}"))
                .hasMessageContaining("短信客户端");
    }

}
