package com.basicframework.module.system.service.sms;

import com.basicframework.framework.common.core.KeyValue;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.module.system.dal.dataobject.sms.SmsTemplateDO;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.framework.sms.core.client.SmsClient;
import com.basicframework.module.system.framework.sms.core.client.SmsReceiptException;
import com.basicframework.module.system.service.sms.SmsChannelService;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
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

    /**
     * 模板参数必须按模板声明顺序输出，不得受入参 Map 的迭代顺序影响。
     *
     * <p>部分短信平台按数组下标而不是按 key 取参（例如腾讯云），一旦顺序被打乱，同一份模板在
     * 不同调用方会填入不同的参数，短信内容会变成别的意思。实现用 {@code Map} 承载原始参数，
     * 因此顺序只能来自模板自身的参数声明顺序，这里用刻意反序的入参把它钉死。</p>
     */
    @Test
    void templateParamsKeepTemplateDeclaredOrder() {
        SmsTemplateDO template = new SmsTemplateDO();
        template.setParams(List.of("code", "minutes"));

        List<KeyValue<String, Object>> params = smsSendService.buildTemplateParams(template,
                new LinkedHashMap<>(Map.of("minutes", 5, "code", "1234")));

        assertThat(params).as("参数顺序只能来自模板声明顺序").containsExactly(
                new KeyValue<>("code", "1234"), new KeyValue<>("minutes", 5));
    }

    /**
     * 模板声明了但入参没给的参数必须拒绝发送，不得静默填空值发出一条含义错误的短信。
     */
    @Test
    void missingTemplateParamIsRejected() {
        SmsTemplateDO template = new SmsTemplateDO();
        template.setParams(List.of("code", "minutes"));

        assertThatThrownBy(() -> smsSendService.buildTemplateParams(template, Map.of("code", "1234")))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code",
                        ErrorCodeConstants.SMS_SEND_MOBILE_TEMPLATE_PARAM_MISS.getCode());

        assertThatThrownBy(() -> smsSendService.buildTemplateParams(template, Map.of("code", "1234")))
                .hasMessageContaining("minutes");
    }

    /**
     * 会员短信必须按会员用户类型发送，且不得回查管理端用户手机号。
     *
     * <p>{@code sendSingleSmsToAdmin} 在手机号为空时会用管理端用户编号回查手机号，会员路径没有这个
     * 兜底：手机号为空必须由手机号校验拒绝，而不是拿管理员的手机号发到会员手机上。
     * 同时用户类型决定了收信记录归属，写错会让日志落进另一个用户类型。</p>
     */
    @Test
    void memberSmsUsesMemberUserTypeWithoutAdminUserLookup() {
        SmsSendServiceImpl service = spy(new SmsSendServiceImpl());
        AdminUserService adminUserService = mock(AdminUserService.class);
        ReflectionTestUtils.setField(service, "adminUserService", adminUserService);
        doReturn(77L).when(service).sendSingleSms(any(), any(), any(), any(), any());

        Long logId = service.sendSingleSmsToMember("13000000000", 5L, "verify-code", Map.of("code", "1234"));

        assertThat(logId).isEqualTo(77L);
        verify(service).sendSingleSms("13000000000", 5L, UserTypeEnum.MEMBER.getValue(), "verify-code",
                Map.of("code", "1234"));
        verify(adminUserService, never()).getUser(any());
    }

}
