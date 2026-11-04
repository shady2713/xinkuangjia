package com.basicframework.module.system.framework.security.sm2;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.security.config.SecurityProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.time.Duration;
import java.util.concurrent.TimeUnit;

import static com.basicframework.module.system.enums.ErrorCodeConstants.AUTH_PASSWORD_TRANSPORT_INVALID;
import static com.basicframework.module.system.enums.ErrorCodeConstants.PASSWORD_TRANSPORT_INVALID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证 SM2 密码载荷的时间窗和 nonce 防重放规则。
 *
 * @author shady2713
 */
@ExtendWith(MockitoExtension.class)
class Sm2PasswordTransportServiceTest {

    /** 仅用于测试的 SM2 私钥。 */
    private static final String TEST_PRIVATE_KEY =
            "fab85826985d339820dc4b9914487069e2b67ff67275b67ca00fc1d682d810f6";

    @Mock
    private StringRedisTemplate stringRedisTemplate;
    @Mock
    private ValueOperations<String, String> valueOperations;

    private SecurityProperties securityProperties;
    private Sm2PasswordCipher cipher;
    private Sm2PasswordTransportService transportService;

    /**
     * 构造使用测试密钥和模拟 Redis 的传输服务。
     */
    @BeforeEach
    void setUp() {
        securityProperties = new SecurityProperties();
        securityProperties.getSm2().setPrivateKey(TEST_PRIVATE_KEY);
        securityProperties.getSm2().setTimestampWindow(Duration.ofMinutes(5));
        securityProperties.getSm2().setNonceTtl(Duration.ofMinutes(10));
        securityProperties.getSm2().setReplayCheckEnabled(true);
        cipher = new Sm2PasswordCipher(securityProperties);
        transportService = new Sm2PasswordTransportService(securityProperties, cipher, stringRedisTemplate);
        lenient().when(stringRedisTemplate.opsForValue()).thenReturn(valueOperations);
    }

    /** 验证有效载荷可以解密，并以 SETNX+TTL 占用 nonce。 */
    @Test
    void decryptsValidPayloadAndMarksNonce() {
        when(valueOperations.setIfAbsent(anyString(), eq("1"), anyLong(), eq(TimeUnit.MILLISECONDS)))
                .thenReturn(true);
        String ciphertext = encryptPayload("Valid#Pass1", System.currentTimeMillis(),
                "0123456789abcdef0123456789abcdef");

        String password = transportService.decryptPassword(ciphertext);

        assertThat(password).isEqualTo("Valid#Pass1");
    }

    /** 验证超过时间窗的历史载荷被拒绝。 */
    @Test
    void rejectsExpiredTimestamp() {
        String ciphertext = encryptPayload("Valid#Pass1",
                System.currentTimeMillis() - Duration.ofMinutes(6).toMillis(),
                "0123456789abcdef0123456789abcdef");

        assertThatThrownBy(() -> transportService.decryptPassword(ciphertext))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(PASSWORD_TRANSPORT_INVALID.getCode()));
        verifyNoInteractions(valueOperations);
    }

    /** 验证超前时间戳同样被拒绝，避免客户端时间被无限放大。 */
    @Test
    void rejectsFutureTimestamp() {
        String ciphertext = encryptPayload("Valid#Pass1",
                System.currentTimeMillis() + Duration.ofMinutes(6).toMillis(),
                "0123456789abcdef0123456789abcdef");

        assertThatThrownBy(() -> transportService.decryptPassword(ciphertext))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(PASSWORD_TRANSPORT_INVALID.getCode()));
        verifyNoInteractions(valueOperations);
    }

    /** 验证 Redis 中已存在的 nonce 被视为重放。 */
    @Test
    void rejectsReplayedNonce() {
        when(valueOperations.setIfAbsent(anyString(), eq("1"), anyLong(), eq(TimeUnit.MILLISECONDS)))
                .thenReturn(false);
        String ciphertext = encryptPayload("Valid#Pass1", System.currentTimeMillis(),
                "0123456789abcdef0123456789abcdef");

        assertThatThrownBy(() -> transportService.decryptPassword(ciphertext))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(PASSWORD_TRANSPORT_INVALID.getCode()));
    }

    /** 验证 nonce 格式非法时不写入 Redis。 */
    @Test
    void rejectsInvalidNonceFormat() {
        String ciphertext = encryptPayload("Valid#Pass1", System.currentTimeMillis(), "short");

        assertThatThrownBy(() -> transportService.decryptPassword(ciphertext))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(PASSWORD_TRANSPORT_INVALID.getCode()));
        verifyNoInteractions(valueOperations);
    }

    /** 验证解出的明文不是约定 JSON 时被拒绝。 */
    @Test
    void rejectsMalformedPayload() {
        String ciphertext = cipher.encrypt("not-a-json");

        assertThatThrownBy(() -> transportService.decryptPassword(ciphertext))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(PASSWORD_TRANSPORT_INVALID.getCode()));
    }

    /** 验证登录入口的传输失败统一返回账号密码错误码。 */
    @Test
    void loginTransportFailureUsesGenericCredentialError() {
        assertThatThrownBy(() -> transportService.decryptLoginPassword("not-hex"))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(AUTH_PASSWORD_TRANSPORT_INVALID.getCode()));
    }

    /** 验证关闭防重放后只校验时间窗，不依赖 Redis。 */
    @Test
    void skipsNonceCheckWhenReplayProtectionDisabled() {
        securityProperties.getSm2().setReplayCheckEnabled(false);
        String ciphertext = encryptPayload("Valid#Pass1", System.currentTimeMillis(),
                "0123456789abcdef0123456789abcdef");

        String password = transportService.decryptPassword(ciphertext);

        assertThat(password).isEqualTo("Valid#Pass1");
        verifyNoInteractions(valueOperations);
    }

    /**
     * 构造指定载荷的密文。
     *
     * @param password 明文密码
     * @param timestamp 毫秒时间戳
     * @param nonce 随机串
     * @return SM2 密文
     */
    private String encryptPayload(String password, long timestamp, String nonce) {
        String payload = "{\"p\":\"" + password + "\",\"t\":" + timestamp + ",\"n\":\"" + nonce + "\"}";
        return cipher.encrypt(payload);
    }
}
