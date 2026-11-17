package com.basicframework.module.system.controller.admin.sms;

import cn.hutool.crypto.digest.DigestUtil;
import cn.hutool.crypto.digest.HmacAlgorithm;
import com.basicframework.module.system.controller.admin.sms.vo.callback.AliyunSmsCallbackRespVO;
import com.basicframework.module.system.controller.admin.sms.vo.callback.TencentSmsCallbackRespVO;
import com.basicframework.module.system.framework.sms.config.SmsCallbackProperties;
import com.basicframework.module.system.framework.sms.core.callback.SmsCallbackSignatureVerifier;
import com.basicframework.module.system.service.sms.SmsSendService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * 验证短信回调入口先验签再落状态：合法签名进入原有解析流程，缺签、错签和未配置密钥被拒绝。
 *
 * @author shady2713
 */
@ExtendWith(MockitoExtension.class)
class SmsCallbackControllerTest {

    /** 阿里云测试密钥。 */
    private static final String ALIYUN_SECRET = "aliyun-callback-secret";

    /** 腾讯云测试密钥。 */
    private static final String TENCENT_SECRET = "tencent-callback-secret";

    /** 阿里云成功回执样例。 */
    private static final String ALIYUN_BODY = "[{\"phone_number\":\"13811112222\",\"send_time\":\"2026-11-17 10:00:00\","
            + "\"report_time\":\"2026-11-17 10:00:03\",\"success\":true,\"err_code\":\"DELIVERED\","
            + "\"err_msg\":\"用户接收成功\",\"sms_size\":\"1\",\"biz_id\":\"900001\",\"out_id\":\"1001\"}]";

    /** 腾讯云成功回执样例。 */
    private static final String TENCENT_BODY = "[{\"user_receive_time\":\"2026-11-17 10:00:00\",\"nationcode\":\"86\","
            + "\"mobile\":\"13811112222\",\"report_status\":\"SUCCESS\",\"errmsg\":\"DELIVRD\","
            + "\"description\":\"用户短信送达成功\",\"sid\":\"900001\"}]";

    /** 短信发送服务，回执状态最终由它解析并写入。 */
    @Mock
    private SmsSendService smsSendService;

    /** 被测控制器。 */
    private SmsCallbackController controller;

    /** 构造带验签器的控制器，隔离 Spring 容器。 */
    @BeforeEach
    void setUp() {
        SmsCallbackProperties properties = new SmsCallbackProperties();
        properties.setSecrets(Map.of("ALIYUN", ALIYUN_SECRET, "TENCENT", TENCENT_SECRET));
        SmsCallbackSignatureVerifier verifier = new SmsCallbackSignatureVerifier(properties);
        controller = new SmsCallbackController();
        ReflectionTestUtils.setField(controller, "smsSendService", smsSendService);
        ReflectionTestUtils.setField(controller, "smsCallbackSignatureVerifier", verifier);
    }

    /** 验证阿里云合法签名继续走原有解析，并返回协议要求的成功响应。 */
    @Test
    void acceptsAliyunCallbackWithValidSignature() {
        ResponseEntity<AliyunSmsCallbackRespVO> response = controller.receiveAliyunSmsStatus(
                signedJsonRequest("ALIYUN", ALIYUN_BODY, ALIYUN_SECRET));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isEqualTo(AliyunSmsCallbackRespVO.success());
        verify(smsSendService).receiveSmsStatus("ALIYUN", ALIYUN_BODY);
    }

    /** 验证腾讯云合法签名继续走原有解析，并返回协议要求的成功响应。 */
    @Test
    void acceptsTencentCallbackWithValidSignature() {
        ResponseEntity<TencentSmsCallbackRespVO> response = controller.receiveTencentSmsStatus(
                signedJsonRequest("TENCENT", TENCENT_BODY, TENCENT_SECRET));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isEqualTo(TencentSmsCallbackRespVO.success());
        verify(smsSendService).receiveSmsStatus("TENCENT", TENCENT_BODY);
    }

    /** 验证阿里云回调缺少签名时返回 401，且不触达回执写入。 */
    @Test
    void rejectsAliyunCallbackWithoutSignature() {
        ResponseEntity<AliyunSmsCallbackRespVO> response = controller.receiveAliyunSmsStatus(
                jsonRequest(ALIYUN_BODY, currentEpochSecond(), null));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(response.getBody()).isEqualTo(AliyunSmsCallbackRespVO.failure());
        verifyNoInteractions(smsSendService);
    }

    /** 验证腾讯云回调签名错误时返回 401，且不触达回执写入。 */
    @Test
    void rejectsTencentCallbackWithWrongSignature() {
        ResponseEntity<TencentSmsCallbackRespVO> response = controller.receiveTencentSmsStatus(
                jsonRequest(TENCENT_BODY, currentEpochSecond(), "0000000000000000"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(response.getBody()).isEqualTo(TencentSmsCallbackRespVO.failure());
        verifyNoInteractions(smsSendService);
    }

    /** 验证渠道未配置密钥时返回 503，避免匿名回调被当作合法来源。 */
    @Test
    void rejectsCallbackWhenSecretNotConfigured() {
        SmsCallbackProperties properties = new SmsCallbackProperties();
        properties.setSecrets(Map.of("ALIYUN", ALIYUN_SECRET));
        ReflectionTestUtils.setField(controller, "smsCallbackSignatureVerifier",
                new SmsCallbackSignatureVerifier(properties));

        ResponseEntity<TencentSmsCallbackRespVO> response = controller.receiveTencentSmsStatus(
                signedJsonRequest("TENCENT", TENCENT_BODY, TENCENT_SECRET));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(response.getBody()).isEqualTo(TencentSmsCallbackRespVO.failure());
        verifyNoInteractions(smsSendService);
    }

    /** 验证验签通过后原有异常处理不变：解析失败仍返回 500 触发厂商重试。 */
    @Test
    void keepsInternalServerErrorWhenParsingFailsAfterVerification() {
        doThrow(new IllegalArgumentException("回执格式错误"))
                .when(smsSendService).receiveSmsStatus(eq("ALIYUN"), eq(ALIYUN_BODY));

        ResponseEntity<AliyunSmsCallbackRespVO> response = controller.receiveAliyunSmsStatus(
                signedJsonRequest("ALIYUN", ALIYUN_BODY, ALIYUN_SECRET));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(response.getBody()).isEqualTo(AliyunSmsCallbackRespVO.failure());
    }

    /**
     * 构造带合法签名的 JSON 回调请求。
     *
     * @param channelCode 渠道编码
     * @param body        请求体
     * @param secret      签名密钥
     * @return 已带时间戳与签名的请求
     */
    private static MockHttpServletRequest signedJsonRequest(String channelCode, String body, String secret) {
        long timestamp = currentEpochSecond();
        String signature = DigestUtil.hmac(HmacAlgorithm.HmacSHA256, secret.getBytes(StandardCharsets.UTF_8))
                .digestHex(channelCode + "\n" + timestamp + "\n" + body);
        return jsonRequest(body, timestamp, signature);
    }

    /**
     * 构造 JSON 回调请求。
     *
     * @param body      请求体
     * @param timestamp 秒级时间戳
     * @param signature 签名，null 表示不带签名请求头
     * @return 回调请求
     */
    private static MockHttpServletRequest jsonRequest(String body, long timestamp, String signature) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setContentType("application/json");
        request.setContent(body.getBytes(StandardCharsets.UTF_8));
        request.addHeader(SmsCallbackSignatureVerifier.HEADER_TIMESTAMP, Long.toString(timestamp));
        if (signature != null) {
            request.addHeader(SmsCallbackSignatureVerifier.HEADER_SIGNATURE, signature);
        }
        return request;
    }

    /**
     * 获取当前秒级时间戳，作为合法请求的时间。
     *
     * @return 当前 Unix 秒
     */
    private static long currentEpochSecond() {
        return Instant.now().getEpochSecond();
    }

}
