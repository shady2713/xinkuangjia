package com.basicframework.module.system.framework.sms.core.callback;

import cn.hutool.crypto.digest.DigestUtil;
import cn.hutool.crypto.digest.HmacAlgorithm;
import com.basicframework.module.system.framework.sms.config.SmsCallbackProperties;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证短信回调验签结论：合法签名通过，缺失、错误、过期、跨渠道签名均被拒绝。
 *
 * @author shady2713
 */
class SmsCallbackSignatureVerifierTest {

    /** 阿里云测试用 HMAC 密钥占位符，仅用于单元测试。 */
    private static final String ALIYUN_TEST_HMAC_KEY = "CHANGE_ME_ALIYUN_HMAC";

    /** 腾讯云测试用 HMAC 密钥占位符，仅用于单元测试。 */
    private static final String TENCENT_TEST_HMAC_KEY = "CHANGE_ME_TENCENT_HMAC";

    /** 阿里云回执样例，覆盖多字段与中文说明。 */
    private static final String ALIYUN_BODY = "[{\"phone_number\":\"13811112222\",\"send_time\":\"2026-11-17 10:00:00\","
            + "\"report_time\":\"2026-11-17 10:00:03\",\"success\":true,\"err_code\":\"DELIVERED\","
            + "\"err_msg\":\"用户接收成功\",\"sms_size\":\"1\",\"biz_id\":\"900001\",\"out_id\":\"1001\"}]";

    /** 验证时间戳与签名都正确时通过。 */
    @Test
    void passesWithValidSignature() {
        long timestamp = currentEpochSecond();

        SmsCallbackVerificationResult result = newVerifier().verify("ALIYUN", request(Long.toString(timestamp),
                sign("ALIYUN", timestamp, ALIYUN_BODY, ALIYUN_TEST_HMAC_KEY)), ALIYUN_BODY);

        assertThat(result).isEqualTo(SmsCallbackVerificationResult.PASS);
    }

    /** 验证签名大小写不影响十六进制比较。 */
    @Test
    void passesWithUppercaseSignature() {
        long timestamp = currentEpochSecond();
        String signature = sign("ALIYUN", timestamp, ALIYUN_BODY, ALIYUN_TEST_HMAC_KEY).toUpperCase();

        SmsCallbackVerificationResult result = newVerifier().verify("ALIYUN", request(Long.toString(timestamp), signature),
                ALIYUN_BODY);

        assertThat(result).isEqualTo(SmsCallbackVerificationResult.PASS);
    }

    /** 验证缺少签名请求头时拒绝。 */
    @Test
    void rejectsMissingSignature() {
        SmsCallbackVerificationResult result = newVerifier().verify("ALIYUN",
                request(Long.toString(currentEpochSecond()), null), ALIYUN_BODY);

        assertThat(result).isEqualTo(SmsCallbackVerificationResult.INVALID);
    }

    /** 验证签名与请求体不匹配时拒绝，避免伪造回执内容。 */
    @Test
    void rejectsSignatureOfTamperedBody() {
        long timestamp = currentEpochSecond();
        String signature = sign("ALIYUN", timestamp, ALIYUN_BODY, ALIYUN_TEST_HMAC_KEY);

        SmsCallbackVerificationResult result = newVerifier().verify("ALIYUN", request(Long.toString(timestamp), signature),
                ALIYUN_BODY.replace("DELIVERED", "UNDELIV"));

        assertThat(result).isEqualTo(SmsCallbackVerificationResult.INVALID);
    }

    /** 验证缺少时间戳请求头时拒绝，签名无法单独成立。 */
    @Test
    void rejectsMissingTimestamp() {
        String signature = sign("ALIYUN", currentEpochSecond(), ALIYUN_BODY, ALIYUN_TEST_HMAC_KEY);

        SmsCallbackVerificationResult result = newVerifier().verify("ALIYUN", request(null, signature),
                ALIYUN_BODY);

        assertThat(result).isEqualTo(SmsCallbackVerificationResult.INVALID);
    }

    /** 验证超出时间窗口的请求被拒绝，限制重放价值。 */
    @Test
    void rejectsExpiredTimestamp() {
        long timestamp = currentEpochSecond() - 600;

        SmsCallbackVerificationResult result = newVerifier().verify("ALIYUN", request(Long.toString(timestamp),
                sign("ALIYUN", timestamp, ALIYUN_BODY, ALIYUN_TEST_HMAC_KEY)), ALIYUN_BODY);

        assertThat(result).isEqualTo(SmsCallbackVerificationResult.INVALID);
    }

    /** 验证非法时间戳不会导致异常，而是按拒绝处理。 */
    @Test
    void rejectsMalformedTimestamp() {
        SmsCallbackVerificationResult result = newVerifier().verify("ALIYUN", request("not-a-timestamp", "abc"),
                ALIYUN_BODY);

        assertThat(result).isEqualTo(SmsCallbackVerificationResult.INVALID);
    }

    /** 验证超出 long 秒换算范围的时间戳按拒绝处理，不因溢出绕过窗口比较。 */
    @Test
    void rejectsOverflowTimestamp() {
        SmsCallbackVerificationResult result = newVerifier().verify("ALIYUN",
                request(Long.toString(Long.MAX_VALUE), "abc"), ALIYUN_BODY);

        assertThat(result).isEqualTo(SmsCallbackVerificationResult.INVALID);
    }

    /** 验证用阿里云密钥签名的请求不能用于腾讯云回调，防止跨渠道复用。 */
    @Test
    void rejectsSignatureForAnotherChannel() {
        long timestamp = currentEpochSecond();
        String signature = sign("ALIYUN", timestamp, ALIYUN_BODY, ALIYUN_TEST_HMAC_KEY);

        SmsCallbackVerificationResult result = newVerifier().verify("TENCENT", request(Long.toString(timestamp), signature),
                ALIYUN_BODY);

        assertThat(result).isEqualTo(SmsCallbackVerificationResult.INVALID);
    }

    /** 验证渠道没有配置密钥时失败关闭，不把匿名回调当作通过。 */
    @Test
    void rejectsWhenChannelNotConfigured() {
        SmsCallbackProperties properties = new SmsCallbackProperties();
        properties.setSecrets(Map.of("ALIYUN", ALIYUN_TEST_HMAC_KEY));
        long timestamp = currentEpochSecond();
        SmsCallbackSignatureVerifier verifier = new SmsCallbackSignatureVerifier(properties);

        SmsCallbackVerificationResult result = verifier.verify("TENCENT", request(Long.toString(timestamp),
                sign("TENCENT", timestamp, ALIYUN_BODY, TENCENT_TEST_HMAC_KEY)), ALIYUN_BODY);

        assertThat(result).isEqualTo(SmsCallbackVerificationResult.NOT_CONFIGURED);
    }

    /** 验证配置 key 不区分大小写，避免环境变量注入后渠道被误判为未配置。 */
    @Test
    void matchesSecretIgnoringChannelCodeCase() {
        SmsCallbackProperties properties = new SmsCallbackProperties();
        properties.setSecrets(Map.of("aliyun", ALIYUN_TEST_HMAC_KEY));
        long timestamp = currentEpochSecond();
        SmsCallbackSignatureVerifier verifier = new SmsCallbackSignatureVerifier(properties);

        SmsCallbackVerificationResult result = verifier.verify("ALIYUN", request(Long.toString(timestamp),
                sign("ALIYUN", timestamp, ALIYUN_BODY, ALIYUN_TEST_HMAC_KEY)), ALIYUN_BODY);

        assertThat(result).isEqualTo(SmsCallbackVerificationResult.PASS);
    }

    /** 验证同一签名在重放窗口内第二次提交会被去重拦截，阻断窗口内重复重放。 */
    @Test
    void rejectsReplayedSignatureWithinWindow() {
        SmsCallbackSignatureVerifier verifier = newVerifier();
        long timestamp = currentEpochSecond();
        String signature = sign("ALIYUN", timestamp, ALIYUN_BODY, ALIYUN_TEST_HMAC_KEY);

        assertThat(verifier.verify("ALIYUN", request(Long.toString(timestamp), signature), ALIYUN_BODY))
                .isEqualTo(SmsCallbackVerificationResult.PASS);
        assertThat(verifier.verify("ALIYUN", request(Long.toString(timestamp), signature), ALIYUN_BODY))
                .isEqualTo(SmsCallbackVerificationResult.INVALID);
    }

    /**
     * 创建使用默认时间窗口的校验器，密钥大小写混合以覆盖归一化逻辑。
     *
     * @return 短信回调签名校验器
     */
    private static SmsCallbackSignatureVerifier newVerifier() {
        SmsCallbackProperties properties = new SmsCallbackProperties();
        properties.setSecrets(Map.of("aliyun", ALIYUN_TEST_HMAC_KEY, "TENCENT", TENCENT_TEST_HMAC_KEY));
        properties.setTimestampTolerance(Duration.ofMinutes(5));
        return new SmsCallbackSignatureVerifier(properties);
    }

    /**
     * 构造只携带指定请求头的回调请求。
     *
     * @param timestamp 秒级时间戳原文，null 表示不带该请求头
     * @param signature 签名，null 表示不带该请求头
     * @return 回调请求
     */
    private static MockHttpServletRequest request(String timestamp, String signature) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (timestamp != null) {
            request.addHeader(SmsCallbackSignatureVerifier.HEADER_TIMESTAMP, timestamp);
        }
        if (signature != null) {
            request.addHeader(SmsCallbackSignatureVerifier.HEADER_SIGNATURE, signature);
        }
        return request;
    }

    /**
     * 按回调协议计算测试签名。
     *
     * @param channelCode 渠道编码
     * @param timestamp   秒级时间戳
     * @param body        请求体
     * @param secret      签名密钥
     * @return 小写十六进制签名
     */
    private static String sign(String channelCode, long timestamp, String body, String secret) {
        return DigestUtil.hmac(HmacAlgorithm.HmacSHA256, secret.getBytes(StandardCharsets.UTF_8))
                .digestHex(channelCode + "\n" + timestamp + "\n" + body);
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
