package com.basicframework.module.system.api.sms;

import com.basicframework.module.system.api.sms.dto.code.SmsCodeSendReqDTO;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeUseReqDTO;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeValidateReqDTO;
import com.basicframework.module.system.service.sms.SmsCodeService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;

/**
 * 验证短信验证码跨模块 API 的转发契约。
 *
 * <p>该实现类只做转发，不做参数改写或状态缓存，因此契约有三点必须锁定：请求对象必须原样
 * 传给短信服务（任何字段丢失都会让校验码发到错误场景或错误手机号）；返回值与异常必须原样
 * 透出（验证码错误要按业务错误码返回，不能被包装成通用失败）；每个方法只能触发一次下游调用，
 * 重复调用会导致验证码重复发送或计数被多扣。</p>
 *
 * @author shady2713
 */
class SmsCodeApiImplTest {

    /** 被测 API 实现。 */
    private SmsCodeApiImpl smsCodeApi;
    /** 下游短信服务替身，用于观察真实转发参数。 */
    private SmsCodeService smsCodeService;

    /** 为每个用例创建独立 API 与下游替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        smsCodeApi = new SmsCodeApiImpl();
        smsCodeService = mock(SmsCodeService.class);
        ReflectionTestUtils.setField(smsCodeApi, "smsCodeService", smsCodeService);
    }

    /** 发送验证码必须把请求对象原样交给下游，手机号、场景与来源 IP 一个都不能丢。 */
    @Test
    void sendSmsCodeDelegatesRequestUnchanged() {
        SmsCodeSendReqDTO reqDTO = new SmsCodeSendReqDTO();
        reqDTO.setMobile("13800000001");
        reqDTO.setScene(1);
        reqDTO.setCreateIp("127.0.0.1");

        smsCodeApi.sendSmsCode(reqDTO);

        ArgumentCaptor<SmsCodeSendReqDTO> captor = ArgumentCaptor.forClass(SmsCodeSendReqDTO.class);
        verify(smsCodeService).sendSmsCode(captor.capture());
        assertThat(captor.getValue()).isSameAs(reqDTO);
        assertThat(captor.getValue().getMobile()).isEqualTo("13800000001");
        assertThat(captor.getValue().getScene()).isEqualTo(1);
        assertThat(captor.getValue().getCreateIp()).isEqualTo("127.0.0.1");
        verifyNoMoreInteractions(smsCodeService);
    }

    /** 使用验证码必须原样转发请求对象，且只调用一次下游，避免验证码被重复核销。 */
    @Test
    void useSmsCodeDelegatesRequestUnchanged() {
        SmsCodeUseReqDTO reqDTO = new SmsCodeUseReqDTO();
        reqDTO.setMobile("13800000001");
        reqDTO.setCode("123456");
        reqDTO.setScene(1);
        reqDTO.setUsedIp("127.0.0.1");

        smsCodeApi.useSmsCode(reqDTO);

        ArgumentCaptor<SmsCodeUseReqDTO> captor = ArgumentCaptor.forClass(SmsCodeUseReqDTO.class);
        verify(smsCodeService).useSmsCode(captor.capture());
        assertThat(captor.getValue()).isSameAs(reqDTO);
        assertThat(captor.getValue().getCode()).isEqualTo("123456");
        verifyNoMoreInteractions(smsCodeService);
    }

    /** 校验验证码必须原样转发请求对象，供下游按手机号与场景核对。 */
    @Test
    void validateSmsCodeDelegatesRequestUnchanged() {
        SmsCodeValidateReqDTO reqDTO = new SmsCodeValidateReqDTO();
        reqDTO.setMobile("13800000001");
        reqDTO.setCode("123456");
        reqDTO.setScene(1);

        smsCodeApi.validateSmsCode(reqDTO);

        ArgumentCaptor<SmsCodeValidateReqDTO> captor = ArgumentCaptor.forClass(SmsCodeValidateReqDTO.class);
        verify(smsCodeService).validateSmsCode(captor.capture());
        assertThat(captor.getValue()).isSameAs(reqDTO);
        verifyNoMoreInteractions(smsCodeService);
    }

    /**
     * 下游业务异常必须原样透出，不能被包装成通用失败。
     *
     * <p>调用方依赖下游抛出的错误码区分“验证码错误”“超出次数”和“验证码过期”，
     * 包装异常会让前端无法给出正确提示。</p>
     */
    @Test
    void downstreamFailurePropagatesUnchanged() {
        IllegalStateException failure = new IllegalStateException("synthetic-downstream-failure");
        doThrow(failure).when(smsCodeService).validateSmsCode(any(SmsCodeValidateReqDTO.class));

        assertThatThrownBy(() -> smsCodeApi.validateSmsCode(new SmsCodeValidateReqDTO()))
                .isSameAs(failure);
    }
}
