package com.basicframework.module.system.service.sms;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeSendReqDTO;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeUseReqDTO;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeValidateReqDTO;
import com.basicframework.module.system.enums.sms.SmsSceneEnum;
import com.basicframework.module.system.framework.sms.config.SmsCodeProperties;
import com.basicframework.module.system.framework.sms.core.AliyunSmsSender;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Duration;

import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CODE_EXCEED_SEND_MAXIMUM_QUANTITY_PER_DAY;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CODE_NOT_FOUND;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CODE_SEND_TOO_FAST;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CODE_USED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证极简 Redis/内存短信验证码服务的频控、单次原子消费及阿里云发送器委托。
 *
 * @author shady2713
 */
@ExtendWith(MockitoExtension.class)
class SmsCodeServiceImplTest {

    @Mock
    private AliyunSmsSender aliyunSmsSender;
    @Mock
    private ObjectProvider<StringRedisTemplate> stringRedisTemplateProvider;

    private SmsCodeProperties smsCodeProperties;
    private SmsCodeServiceImpl smsCodeService;

    @BeforeEach
    void setUp() {
        smsCodeProperties = new SmsCodeProperties();
        smsCodeProperties.setExpireTimes(Duration.ofMinutes(5));
        smsCodeProperties.setSendFrequency(Duration.ofMinutes(1));
        smsCodeProperties.setSendMaximumQuantityPerDay(2);

        smsCodeService = new SmsCodeServiceImpl();
        ReflectionTestUtils.setField(smsCodeService, "smsCodeProperties", smsCodeProperties);
        ReflectionTestUtils.setField(smsCodeService, "aliyunSmsSender", aliyunSmsSender);
        ReflectionTestUtils.setField(smsCodeService, "stringRedisTemplateProvider", stringRedisTemplateProvider);
    }

    @Test
    void localFallbackSupportsSendValidateSingleUseAndFrequencyGuard() {
        SmsCodeSendReqDTO sendReq = new SmsCodeSendReqDTO();
        sendReq.setMobile("13800138000");
        sendReq.setScene(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        sendReq.setCreateIp("127.0.0.1");

        smsCodeService.sendSmsCode(sendReq);
        ArgumentCaptor<String> codeCaptor = ArgumentCaptor.forClass(String.class);
        verify(aliyunSmsSender).sendCode(eq("13800138000"), eq(SmsSceneEnum.ADMIN_MEMBER_LOGIN), codeCaptor.capture());
        String code = codeCaptor.getValue();
        assertThat(code).hasSize(6);

        // 冷却期内二次发送被拒绝
        assertThatThrownBy(() -> smsCodeService.sendSmsCode(sendReq))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SMS_CODE_SEND_TOO_FAST.getCode()));

        // 错误验证码被拒绝
        SmsCodeValidateReqDTO wrongReq = new SmsCodeValidateReqDTO();
        wrongReq.setMobile("13800138000");
        wrongReq.setScene(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        wrongReq.setCode("000000".equals(code) ? "999999" : "000000");
        assertThatThrownBy(() -> smsCodeService.validateSmsCode(wrongReq))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SMS_CODE_NOT_FOUND.getCode()));

        // 正确验证码校验通过且仅允许消费一次
        SmsCodeUseReqDTO useReq = new SmsCodeUseReqDTO();
        useReq.setMobile("13800138000");
        useReq.setScene(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        useReq.setCode(code);
        useReq.setUsedIp("127.0.0.1");
        smsCodeService.useSmsCode(useReq);

        assertThatThrownBy(() -> smsCodeService.useSmsCode(useReq))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SMS_CODE_USED.getCode()));
    }

    @Test
    void unknownMobileCodeReturnsNotFound() {
        SmsCodeValidateReqDTO req = new SmsCodeValidateReqDTO();
        req.setMobile("13900139000");
        req.setScene(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        req.setCode("123456");

        assertThatThrownBy(() -> smsCodeService.validateSmsCode(req))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SMS_CODE_NOT_FOUND.getCode()));
    }

    @Test
    @SuppressWarnings("unchecked")
    void redisSendKeepsCooldownOnDailyQuotaExceededAndReleasesOnUnexpectedError() {
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        ValueOperations<String, String> valueOps = mock(ValueOperations.class);
        when(stringRedisTemplateProvider.getIfAvailable()).thenReturn(redisTemplate);
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.setIfAbsent(anyString(), eq("1"), eq(Duration.ofMinutes(1)))).thenReturn(true);

        SmsCodeSendReqDTO sendReq = new SmsCodeSendReqDTO();
        sendReq.setMobile("13800138001");
        sendReq.setScene(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        sendReq.setCreateIp("127.0.0.1");

        when(valueOps.increment(anyString())).thenReturn(3L);
        assertThatThrownBy(() -> smsCodeService.sendSmsCode(sendReq))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SMS_CODE_EXCEED_SEND_MAXIMUM_QUANTITY_PER_DAY.getCode()));
        verify(redisTemplate, never()).delete(anyString());

        when(valueOps.increment(anyString())).thenThrow(new IllegalStateException("redis error"));
        assertThatThrownBy(() -> smsCodeService.sendSmsCode(sendReq))
                .isInstanceOf(IllegalStateException.class);
        verify(redisTemplate).delete(anyString());
    }

}
