package com.basicframework.module.system.api.sms;

import com.basicframework.module.system.api.sms.dto.send.SmsSendSingleToUserReqDTO;
import com.basicframework.module.system.service.sms.SmsSendService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证短信发送跨模块 API 实现类的参数拆分与转发契约。
 *
 * <p>接口入参是一个请求 DTO，下游服务接收的是四个独立参数。拆分顺序写错会把手机号
 * 当成模板编码、把模板参数当成用户编号，最终把短信发到错误的人或让模板渲染失败；
 * 手机号为空时按约定传 null，由下游按用户编号加载号码，实现不得在本地改写或预取。
 * 因此本用例用逐参数校验替代"调用过即可"，并覆盖手机号为空这一真实分支。</p>
 *
 * @author shady2713
 */
class SmsSendApiImplTest {

    /** 被测 API 实现。 */
    private SmsSendApiImpl smsSendApi;
    /** 下游短信发送服务替身，用于观察真实转发参数。 */
    private SmsSendService smsSendService;

    /** 为每个用例创建独立 API 与下游替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        smsSendApi = new SmsSendApiImpl();
        smsSendService = mock(SmsSendService.class);
        ReflectionTestUtils.setField(smsSendApi, "smsSendService", smsSendService);
    }

    /** 管理端发送必须把请求对象拆成手机号、用户编号、模板编码与模板参数四项并原样转发。 */
    @Test
    void sendSingleSmsToAdminForwardsEachFieldInOrder() {
        Map<String, Object> templateParams = Map.of("code", "1234");
        SmsSendSingleToUserReqDTO reqDTO = request("13800000001", 7L, "SMS_LOGIN", templateParams);
        when(smsSendService.sendSingleSmsToAdmin("13800000001", 7L, "SMS_LOGIN", templateParams))
                .thenReturn(99L);

        assertThat(smsSendApi.sendSingleSmsToAdmin(reqDTO)).isEqualTo(99L);

        verify(smsSendService).sendSingleSmsToAdmin("13800000001", 7L, "SMS_LOGIN", templateParams);
        verifyNoMoreInteractions(smsSendService);
    }

    /**
     * 管理端手机号为空时必须原样传 null，由下游按用户编号加载号码。
     *
     * <p>实现若在此处抛错或自行查询用户，会破坏"下游负责补全号码"的约定，
     * 并让发短信逻辑出现第二处用户数据访问。</p>
     */
    @Test
    void sendSingleSmsToAdminKeepsNullMobile() {
        SmsSendSingleToUserReqDTO reqDTO = request(null, 7L, "SMS_LOGIN", Map.of());
        when(smsSendService.sendSingleSmsToAdmin(isNull(), eq(7L), eq("SMS_LOGIN"), any())).thenReturn(100L);

        assertThat(smsSendApi.sendSingleSmsToAdmin(reqDTO)).isEqualTo(100L);

        verify(smsSendService).sendSingleSmsToAdmin(null, 7L, "SMS_LOGIN", reqDTO.getTemplateParams());
    }

    /** 会员端发送必须把请求对象拆成四项并原样转发，不得与管理员入口混用。 */
    @Test
    void sendSingleSmsToMemberForwardsEachFieldInOrder() {
        Map<String, Object> templateParams = Map.of("amount", "10.00");
        SmsSendSingleToUserReqDTO reqDTO = request("13900000002", 8L, "SMS_RECHARGE", templateParams);
        when(smsSendService.sendSingleSmsToMember("13900000002", 8L, "SMS_RECHARGE", templateParams))
                .thenReturn(101L);

        assertThat(smsSendApi.sendSingleSmsToMember(reqDTO)).isEqualTo(101L);

        verify(smsSendService).sendSingleSmsToMember("13900000002", 8L, "SMS_RECHARGE", templateParams);
        verifyNoMoreInteractions(smsSendService);
    }

    /** 会员端手机号为空时同样原样传 null，保持与管理员入口一致的补全约定。 */
    @Test
    void sendSingleSmsToMemberKeepsNullMobile() {
        SmsSendSingleToUserReqDTO reqDTO = request(null, 8L, "SMS_RECHARGE", null);
        when(smsSendService.sendSingleSmsToMember(isNull(), eq(8L), eq("SMS_RECHARGE"), isNull())).thenReturn(102L);

        assertThat(smsSendApi.sendSingleSmsToMember(reqDTO)).isEqualTo(102L);

        verify(smsSendService).sendSingleSmsToMember(null, 8L, "SMS_RECHARGE", null);
    }

    /** 下游发送失败必须原样传播，不能返回假日志编号掩盖未发送。 */
    @Test
    void downstreamFailuresPropagateUnchanged() {
        SmsSendSingleToUserReqDTO reqDTO = request("13800000001", 7L, "SMS_LOGIN", Map.of());
        IllegalStateException failure = new IllegalStateException("synthetic-sms-failure");
        doThrow(failure).when(smsSendService)
                .sendSingleSmsToAdmin("13800000001", 7L, "SMS_LOGIN", reqDTO.getTemplateParams());

        assertThatThrownBy(() -> smsSendApi.sendSingleSmsToAdmin(reqDTO)).isSameAs(failure);
    }

    /**
     * 构造短信发送请求对象。
     *
     * @param mobile 手机号，允许为 null 表示由下游按用户编号补全
     * @param userId 用户编号
     * @param templateCode 短信模板编码
     * @param templateParams 模板参数，允许为 null
     * @return 短信发送请求对象
     */
    private static SmsSendSingleToUserReqDTO request(String mobile, Long userId, String templateCode,
                                                     Map<String, Object> templateParams) {
        SmsSendSingleToUserReqDTO reqDTO = new SmsSendSingleToUserReqDTO();
        reqDTO.setMobile(mobile);
        reqDTO.setUserId(userId);
        reqDTO.setTemplateCode(templateCode);
        reqDTO.setTemplateParams(templateParams);
        return reqDTO;
    }
}
