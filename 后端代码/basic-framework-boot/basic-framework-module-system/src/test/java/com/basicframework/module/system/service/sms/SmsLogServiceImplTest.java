package com.basicframework.module.system.service.sms;

import com.basicframework.module.system.dal.dataobject.sms.SmsLogDO;
import com.basicframework.module.system.dal.dataobject.sms.SmsTemplateDO;
import com.basicframework.module.system.dal.mysql.sms.SmsLogMapper;
import com.basicframework.module.system.framework.sms.core.client.SmsReceiptException;
import com.basicframework.module.system.enums.sms.SmsReceiveStatusEnum;
import com.basicframework.module.system.enums.sms.SmsSendStatusEnum;
import com.basicframework.module.system.enums.sms.SmsTemplateTypeEnum;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.ArgumentMatchers;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证短信日志的落库字段、发送结果回写与供应商回执的关联条件校验。
 *
 * <p>短信日志同时承担取证与对账两个职责：发送日志缺一项渠道或模板冗余字段，事后就无法定位这短信
 * 是用哪个模板、哪个渠道发出去的；发送结果回写若不带发送时间，就无法算出发送延迟。回执入口是匿名
 * 的，四项关联条件缺一不可——少校验任何一项，攻击者或供应商串号都可以把别的短信改写成失败；
 * 而把关联条件降级成"有编号就更新"更危险，因为内部编号可枚举。</p>
 *
 * <p>持久层替换为 Mapper 替身，状态枚举映射、必填参数判定、回执匹配失败分类与异常类型全部真实执行；
 * 断言核对写入对象的初始状态与冗余字段、异常携带的固定原因分类，以及替身实际收到的回执关联条件。</p>
 *
 * @author shady2713
 */
class SmsLogServiceImplTest {

    /** 替换数据库自增的短信日志编号。 */
    private static final Long GENERATED_ID = 16384L;

    /** 被测服务。 */
    private SmsLogServiceImpl smsLogService;
    /** 短信日志持久层替身。 */
    private SmsLogMapper smsLogMapper;

    /**
     * 装配服务与 Mapper 替身。
     */
    @BeforeEach
    void setUp() {
        smsLogService = new SmsLogServiceImpl();
        smsLogMapper = mock(SmsLogMapper.class);
        ReflectionTestUtils.setField(smsLogService, "smsLogMapper", smsLogMapper);
    }

    /**
     * 构造一条短信模板记录。
     *
     * @return 短信模板记录
     */
    private static SmsTemplateDO templateDO() {
        SmsTemplateDO template = new SmsTemplateDO();
        template.setId(7L);
        template.setType(SmsTemplateTypeEnum.NOTICE.getType());
        template.setCode("sms_verify");
        template.setChannelId(3L);
        template.setChannelCode("ALIYUN");
        template.setApiTemplateId("SMS_001");
        return template;
    }

    /** 需要发送的短信按待发送状态落库，并把模板的渠道与模板字段冗余进日志。 */
    @Test
    void createSmsLogStoresInitialStatusAndTemplateSnapshot() {
        doAnswer(invocation -> {
            SmsLogDO inserted = invocation.getArgument(0);
            inserted.setId(GENERATED_ID);
            return 1;
        }).when(smsLogMapper).insert(any(SmsLogDO.class));
        Map<String, Object> params = new HashMap<>();
        params.put("code", "123456");

        Long id = smsLogService.createSmsLog("13800000000", 5L, 2, true,
                templateDO(), "您的验证码是 123456", params);

        ArgumentCaptor<SmsLogDO> captor = ArgumentCaptor.forClass(SmsLogDO.class);
        verify(smsLogMapper).insert(captor.capture());
        assertThat(id).isEqualTo(GENERATED_ID);
        assertThat(captor.getValue().getSendStatus()).isEqualTo(SmsSendStatusEnum.INIT.getStatus());
        assertThat(captor.getValue().getReceiveStatus()).isEqualTo(SmsReceiveStatusEnum.INIT.getStatus());
        assertThat(captor.getValue().getChannelCode()).isEqualTo("ALIYUN");
        assertThat(captor.getValue().getTemplateCode()).isEqualTo("sms_verify");
        assertThat(captor.getValue().getApiTemplateId()).isEqualTo("SMS_001");
        assertThat(captor.getValue().getTemplateParams()).containsEntry("code", "123456");
    }

    /** 明确标记为不发送的短信按忽略状态落库，避免在发送看板里冒充待发送。 */
    @Test
    void createSmsLogMarksSkippedSmsAsIgnored() {
        doAnswer(invocation -> {
            SmsLogDO inserted = invocation.getArgument(0);
            inserted.setId(GENERATED_ID);
            return 1;
        }).when(smsLogMapper).insert(any(SmsLogDO.class));

        smsLogService.createSmsLog("13800000000", null, null, false, templateDO(), null, null);

        ArgumentCaptor<SmsLogDO> captor = ArgumentCaptor.forClass(SmsLogDO.class);
        verify(smsLogMapper).insert(captor.capture());
        assertThat(captor.getValue().getSendStatus()).isEqualTo(SmsSendStatusEnum.IGNORE.getStatus());
        assertThat(captor.getValue().getReceiveStatus()).isEqualTo(SmsReceiveStatusEnum.INIT.getStatus());
        assertThat(captor.getValue().getMobile()).isEqualTo("13800000000");
    }

    /** 发送成功时回写成功状态、发送时间与供应商返回的全部定位字段。 */
    @Test
    void updateSmsSendResultMarksSuccess() {
        LocalDateTime before = LocalDateTime.now();

        smsLogService.updateSmsSendResult(GENERATED_ID, true, "OK", "请求成功", "req-1", "serial-1");

        ArgumentCaptor<SmsLogDO> captor = ArgumentCaptor.forClass(SmsLogDO.class);
        verify(smsLogMapper).updateById(captor.capture());
        assertThat(captor.getValue().getSendStatus()).isEqualTo(SmsSendStatusEnum.SUCCESS.getStatus());
        assertThat(captor.getValue().getSendTime()).isBetween(before.minusMinutes(1), LocalDateTime.now().plusMinutes(1));
        assertThat(captor.getValue().getApiSendCode()).isEqualTo("OK");
        assertThat(captor.getValue().getApiSerialNo()).isEqualTo("serial-1");
    }

    /** 发送失败时回写失败状态，并原样保留供应商错误码与描述供排查。 */
    @Test
    void updateSmsSendResultMarksFailure() {
        smsLogService.updateSmsSendResult(GENERATED_ID, false, "isv.OUT_OF_SERVICE", "服务停机", "req-2", "serial-2");

        ArgumentCaptor<SmsLogDO> captor = ArgumentCaptor.forClass(SmsLogDO.class);
        verify(smsLogMapper).updateById(captor.capture());
        assertThat(captor.getValue().getSendStatus()).isEqualTo(SmsSendStatusEnum.FAILURE.getStatus());
        assertThat(captor.getValue().getApiSendMsg()).isEqualTo("服务停机");
        assertThat(captor.getValue().getId()).isEqualTo(GENERATED_ID);
    }

    /** 回执缺少任一关联条件时按"标识不完整"拒绝，不去数据库匹配任何日志。 */
    @Test
    void updateSmsReceiveResultRejectsIncompleteIdentifiers() {
        LocalDateTime receiveTime = LocalDateTime.now();
        Object[][] incompleteArgs = {
                {"", GENERATED_ID, "serial-1", "13800000000", true},
                {"ALIYUN", GENERATED_ID, " ", "13800000000", true},
                {"ALIYUN", GENERATED_ID, "serial-1", null, true},
                {"ALIYUN", GENERATED_ID, "serial-1", "13800000000", null},
        };
        for (Object[] args : incompleteArgs) {
            assertThatThrownBy(() -> smsLogService.updateSmsReceiveResult(
                    (String) args[0], (Long) args[1], (String) args[2], (String) args[3],
                    (Boolean) args[4], receiveTime, "E", "m"))
                    .isInstanceOf(SmsReceiptException.class)
                    .hasMessage("invalid_identifiers");
        }
        verify(smsLogMapper, never()).selectByReceiveCallback(anyString(), any(), anyString(), anyString());
    }

    /** 回执缺少接收时间同样属于标识不完整，不能用缺省时间落终态。 */
    @Test
    void updateSmsReceiveResultRejectsMissingReceiveTime() {
        assertThatThrownBy(() -> smsLogService.updateSmsReceiveResult(
                "ALIYUN", GENERATED_ID, "serial-1", "13800000000", true, null, "E", "m"))
                .isInstanceOf(SmsReceiptException.class)
                .hasMessage("invalid_identifiers");
        verify(smsLogMapper, never()).updateReceiveResultIfInitial(anyLong(), anyString(), anyString(), anyString(), any());
    }

    /** 关联条件齐全但匹配不到已有日志时按"未匹配"拒绝，不允许新建回执记录。 */
    @Test
    void updateSmsReceiveResultRejectsUnmatchedReceipt() {
        when(smsLogMapper.selectByReceiveCallback("ALIYUN", GENERATED_ID, "serial-1", "13800000000")).thenReturn(null);

        assertThatThrownBy(() -> smsLogService.updateSmsReceiveResult(
                "ALIYUN", GENERATED_ID, "serial-1", "13800000000", true, LocalDateTime.now(), "E", "m"))
                .isInstanceOf(SmsReceiptException.class)
                .hasMessage("unmatched_receipt");
        verify(smsLogMapper, never()).updateReceiveResultIfInitial(anyLong(), anyString(), anyString(), anyString(), any());
    }

    /** 匹配成功时按首次终态写入，关联条件随内部编号一起下发防止串写。 */
    @Test
    void updateSmsReceiveResultMarksSuccessWithAllConditions() {
        SmsLogDO matched = new SmsLogDO();
        matched.setId(GENERATED_ID);
        when(smsLogMapper.selectByReceiveCallback("ALIYUN", GENERATED_ID, "serial-1", "13800000000")).thenReturn(matched);
        LocalDateTime receiveTime = LocalDateTime.of(2026, 5, 6, 7, 8, 9);

        smsLogService.updateSmsReceiveResult("ALIYUN", GENERATED_ID, "serial-1", "13800000000",
                true, receiveTime, "OK", "接收成功");

        ArgumentCaptor<SmsLogDO> captor = ArgumentCaptor.forClass(SmsLogDO.class);
        verify(smsLogMapper).updateReceiveResultIfInitial(
                ArgumentMatchers.eq(GENERATED_ID), ArgumentMatchers.eq("ALIYUN"),
                ArgumentMatchers.eq("serial-1"), ArgumentMatchers.eq("13800000000"), captor.capture());
        assertThat(captor.getValue().getReceiveStatus()).isEqualTo(SmsReceiveStatusEnum.SUCCESS.getStatus());
        assertThat(captor.getValue().getReceiveTime()).isEqualTo(receiveTime);
        assertThat(captor.getValue().getApiReceiveMsg()).isEqualTo("接收成功");
    }

    /** 接收失败时写入失败终态，并保留供应商给出的错误码与描述。 */
    @Test
    void updateSmsReceiveResultMarksFailure() {
        SmsLogDO matched = new SmsLogDO();
        matched.setId(GENERATED_ID);
        when(smsLogMapper.selectByReceiveCallback("ALIYUN", null, "serial-2", "13800000001")).thenReturn(matched);
        LocalDateTime receiveTime = LocalDateTime.of(2026, 5, 6, 7, 8, 9);

        smsLogService.updateSmsReceiveResult("ALIYUN", null, "serial-2", "13800000001",
                false, receiveTime, "isv.BUSINESS_LIMIT_CONTROL", "触发流控");

        ArgumentCaptor<SmsLogDO> captor = ArgumentCaptor.forClass(SmsLogDO.class);
        verify(smsLogMapper).updateReceiveResultIfInitial(
                ArgumentMatchers.eq(GENERATED_ID), ArgumentMatchers.eq("ALIYUN"),
                ArgumentMatchers.eq("serial-2"), ArgumentMatchers.eq("13800000001"), captor.capture());
        assertThat(captor.getValue().getReceiveStatus()).isEqualTo(SmsReceiveStatusEnum.FAILURE.getStatus());
        assertThat(captor.getValue().getApiReceiveCode()).isEqualTo("isv.BUSINESS_LIMIT_CONTROL");
        assertThat(captor.getValue().getId()).isNull();
    }

    /** 回执更新只改接收终态，不得改写发送状态或关联标识字段。 */
    @Test
    void updateSmsReceiveResultNeverTouchesSendFields() {
        SmsLogDO matched = new SmsLogDO();
        matched.setId(GENERATED_ID);
        when(smsLogMapper.selectByReceiveCallback("TENCENT", GENERATED_ID, "serial-3", "13800000002")).thenReturn(matched);

        smsLogService.updateSmsReceiveResult("TENCENT", GENERATED_ID, "serial-3", "13800000002",
                true, LocalDateTime.now(), null, null);

        ArgumentCaptor<SmsLogDO> captor = ArgumentCaptor.forClass(SmsLogDO.class);
        verify(smsLogMapper).updateReceiveResultIfInitial(anyLong(), anyString(), anyString(), anyString(), captor.capture());
        assertThat(captor.getValue().getSendStatus()).isNull();
        assertThat(captor.getValue().getChannelCode()).isNull();
        assertThat(captor.getValue().getApiSerialNo()).isNull();
        assertThat(captor.getValue().getMobile()).isNull();
    }

    /** 供应商重复投递时更新影响行数为零，属于已处理的合法回执，不向上抛错。 */
    @Test
    void updateSmsReceiveResultToleratesDuplicateDelivery() {
        SmsLogDO matched = new SmsLogDO();
        matched.setId(GENERATED_ID);
        when(smsLogMapper.selectByReceiveCallback("ALIYUN", GENERATED_ID, "serial-1", "13800000000")).thenReturn(matched);
        when(smsLogMapper.updateReceiveResultIfInitial(anyLong(), anyString(), anyString(), anyString(), any()))
                .thenReturn(0);

        assertThatCode(() -> smsLogService.updateSmsReceiveResult("ALIYUN", GENERATED_ID, "serial-1",
                "13800000000", true, LocalDateTime.now(), "OK", null)).doesNotThrowAnyException();
        verify(smsLogMapper).updateReceiveResultIfInitial(anyLong(), anyString(), anyString(), anyString(), any());
        verify(smsLogMapper).selectByReceiveCallback("ALIYUN", GENERATED_ID, "serial-1", "13800000000");
    }

    /** 回执处理不得新建短信日志，匿名回执只能推进已有发送日志。 */
    @Test
    void updateSmsReceiveResultNeverInserts() {
        SmsLogDO matched = new SmsLogDO();
        matched.setId(GENERATED_ID);
        when(smsLogMapper.selectByReceiveCallback("ALIYUN", GENERATED_ID, "serial-1", "13800000000")).thenReturn(matched);

        smsLogService.updateSmsReceiveResult("ALIYUN", GENERATED_ID, "serial-1", "13800000000",
                true, LocalDateTime.now(), "OK", null);

        verify(smsLogMapper, never()).insert(any(SmsLogDO.class));
    }

    /** 发送结果回写不得改动接收终态字段，两个状态各自独立推进。 */
    @Test
    void updateSmsSendResultNeverTouchesReceiveFields() {
        smsLogService.updateSmsSendResult(GENERATED_ID, true, "OK", "ok", "req-9", "serial-9");

        ArgumentCaptor<SmsLogDO> captor = ArgumentCaptor.forClass(SmsLogDO.class);
        verify(smsLogMapper).updateById(captor.capture());
        assertThat(captor.getValue().getReceiveStatus()).isNull();
        assertThat(captor.getValue().getReceiveTime()).isNull();
        assertThat(captor.getValue().getApiReceiveCode()).isNull();
    }
}