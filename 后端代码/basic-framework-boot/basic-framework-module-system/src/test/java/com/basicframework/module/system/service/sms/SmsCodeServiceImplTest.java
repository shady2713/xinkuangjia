package com.basicframework.module.system.service.sms;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeSendReqDTO;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeUseReqDTO;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeValidateReqDTO;
import com.basicframework.module.system.dal.dataobject.sms.SmsCodeDO;
import com.basicframework.module.system.dal.mysql.sms.SmsCodeMapper;
import com.basicframework.module.system.enums.sms.SmsSceneEnum;
import com.basicframework.module.system.framework.sms.config.SmsCodeProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Duration;
import java.time.LocalDateTime;

import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CODE_EXPIRED;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CODE_NOT_FOUND;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CODE_SEND_TOO_FAST;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CODE_USED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证 {@link SmsCodeServiceImpl} 关闭验证码状态枚举预言机及发送冷却锁清理边界。
 *
 * @author shady2713
 */
@ExtendWith(MockitoExtension.class)
class SmsCodeServiceImplTest {

    @Mock
    private SmsCodeMapper smsCodeMapper;
    @Mock
    private SmsSendService smsSendService;
    @Mock
    private ObjectProvider<StringRedisTemplate> stringRedisTemplateProvider;

    private SmsCodeProperties smsCodeProperties;
    private SmsCodeServiceImpl smsCodeService;

    /** 初始化短信验证码服务及过期与频控参数。 */
    @BeforeEach
    void setUp() {
        smsCodeProperties = new SmsCodeProperties();
        smsCodeProperties.setExpireTimes(Duration.ofMinutes(5));
        smsCodeProperties.setSendFrequency(Duration.ofMinutes(1));
        smsCodeProperties.setSendMaximumQuantityPerDay(10);

        smsCodeService = new SmsCodeServiceImpl();
        ReflectionTestUtils.setField(smsCodeService, "smsCodeProperties", smsCodeProperties);
        ReflectionTestUtils.setField(smsCodeService, "smsCodeMapper", smsCodeMapper);
        ReflectionTestUtils.setField(smsCodeService, "smsSendService", smsSendService);
        ReflectionTestUtils.setField(smsCodeService, "stringRedisTemplateProvider", stringRedisTemplateProvider);
    }

    /** 验证输入错误验证码时，即使记录已过期或已使用也统一返回不存在，避免泄露账号存在性。 */
    @Test
    void validateSmsCodeHidesExpiredAndUsedOracleWhenCodeDoesNotMatch() {
        SmsCodeDO expiredRecord = buildRecord("123456", true, LocalDateTime.now().minusMinutes(10));
        when(smsCodeMapper.selectLastByMobile("13800138000", null, SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene()))
                .thenReturn(expiredRecord);

        SmsCodeValidateReqDTO wrongExpired = buildValidateReq("000000");
        assertThatThrownBy(() -> smsCodeService.validateSmsCode(wrongExpired))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SMS_CODE_NOT_FOUND.getCode()));

        SmsCodeDO usedRecord = buildRecord("654321", true, LocalDateTime.now().minusMinutes(1));
        when(smsCodeMapper.selectLastByMobile("13800138000", null, SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene()))
                .thenReturn(usedRecord);

        SmsCodeValidateReqDTO wrongUsed = buildValidateReq("999999");
        assertThatThrownBy(() -> smsCodeService.validateSmsCode(wrongUsed))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SMS_CODE_NOT_FOUND.getCode()));
    }

    /** 验证验证码比对一致时保留原有的过期、已使用与原子消费校验语义。 */
    @Test
    void validateAndUseSmsCodePreserveStatusChecksWhenCodeMatches() {
        SmsCodeDO expiredRecord = buildRecord("123456", false, LocalDateTime.now().minusMinutes(10));
        when(smsCodeMapper.selectLastByMobile("13800138000", null, SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene()))
                .thenReturn(expiredRecord);
        assertThatThrownBy(() -> smsCodeService.validateSmsCode(buildValidateReq("123456")))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SMS_CODE_EXPIRED.getCode()));

        SmsCodeDO usedRecord = buildRecord("123456", true, LocalDateTime.now().minusMinutes(1));
        when(smsCodeMapper.selectLastByMobile("13800138000", null, SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene()))
                .thenReturn(usedRecord);
        assertThatThrownBy(() -> smsCodeService.validateSmsCode(buildValidateReq("123456")))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SMS_CODE_USED.getCode()));

        SmsCodeDO validRecord = buildRecord("123456", false, LocalDateTime.now().minusMinutes(1));
        validRecord.setId(77L);
        when(smsCodeMapper.selectLastByMobile("13800138000", null, SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene()))
                .thenReturn(validRecord);
        when(smsCodeMapper.updateUsedIfUnused(eq(77L), any(LocalDateTime.class), eq("127.0.0.1"))).thenReturn(1);

        SmsCodeUseReqDTO useReq = new SmsCodeUseReqDTO();
        useReq.setMobile("13800138000");
        useReq.setCode("123456");
        useReq.setScene(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        useReq.setUsedIp("127.0.0.1");
        smsCodeService.useSmsCode(useReq);
        verify(smsCodeMapper).updateUsedIfUnused(eq(77L), any(LocalDateTime.class), eq("127.0.0.1"));
    }

    /** 验证业务频控拒绝时保留 Redis 冷却锁，非业务异常时释放未落库冷却锁。 */
    @Test
    @SuppressWarnings("unchecked")
    void sendSmsCodeKeepsCooldownLockOnServiceExceptionAndDeletesOnUnexpectedFailure() {
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        ValueOperations<String, String> valueOps = mock(ValueOperations.class);
        when(stringRedisTemplateProvider.getIfAvailable()).thenReturn(redisTemplate);
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.setIfAbsent(anyString(), eq("1"), eq(Duration.ofMinutes(1)))).thenReturn(true);

        SmsCodeSendReqDTO sendReq = new SmsCodeSendReqDTO();
        sendReq.setMobile("13800138000");
        sendReq.setScene(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        sendReq.setCreateIp("127.0.0.1");

        SmsCodeDO recent = buildRecord("111111", false, LocalDateTime.now().minusSeconds(10));
        when(smsCodeMapper.selectLastByMobile("13800138000", null, null)).thenReturn(recent);
        assertThatThrownBy(() -> smsCodeService.sendSmsCode(sendReq))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(SMS_CODE_SEND_TOO_FAST.getCode()));
        verify(redisTemplate, never()).delete(anyString());

        when(smsCodeMapper.selectLastByMobile("13800138000", null, null))
                .thenThrow(new IllegalStateException("db unavailable"));
        assertThatThrownBy(() -> smsCodeService.sendSmsCode(sendReq))
                .isInstanceOf(IllegalStateException.class);
        verify(redisTemplate).delete(anyString());
    }

    /** 构造测试用短信验证码持久化记录。 */
    private static SmsCodeDO buildRecord(String code, boolean used, LocalDateTime createTime) {
        SmsCodeDO record = new SmsCodeDO();
        record.setCode(code);
        record.setUsed(used);
        record.setCreateTime(createTime);
        record.setTodayIndex(1);
        return record;
    }

    /** 构造验证码校验请求。 */
    private static SmsCodeValidateReqDTO buildValidateReq(String code) {
        SmsCodeValidateReqDTO reqDTO = new SmsCodeValidateReqDTO();
        reqDTO.setMobile("13800138000");
        reqDTO.setScene(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        reqDTO.setCode(code);
        return reqDTO;
    }
}
