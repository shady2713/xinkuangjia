package com.basicframework.module.system.framework.sms.core.client.impl;

import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import com.basicframework.framework.common.core.KeyValue;
import com.basicframework.framework.common.util.http.HttpUtils;
import com.basicframework.module.system.framework.sms.core.client.dto.SmsReceiveRespDTO;
import com.basicframework.module.system.framework.sms.core.client.dto.SmsSendRespDTO;
import com.basicframework.module.system.framework.sms.core.client.dto.SmsTemplateRespDTO;
import com.basicframework.module.system.framework.sms.core.enums.SmsTemplateAuditStatusEnum;
import com.basicframework.module.system.framework.sms.core.property.SmsChannelProperties;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;

/**
 * 验证阿里云短信客户端的配置校验、请求签名、URL 编码、响应解析与状态映射契约。
 *
 * <p>该客户端按 ACS3-HMAC-SHA256 规范构造 RPC 请求：查询串必须按规范化规则做百分号编码，
 * 编码错误会让签名校验失败；请求头必须带 Action／Version／内容摘要与凭据签名；响应必须区分
 * 业务错误与查询结果，模板查询失败返回 null 而不是半成品对象。</p>
 *
 * <p>唯一的进程外边界是真实 HTTPS 调用：用例拦截 {@link HttpUtils#post} 并捕获真实请求的地址、
 * 请求头与请求体，签名串、查询串编码与响应解析全部走真实实现。替身只返回预置的云端报文，
 * 不访问外网、不使用任何真实凭据。</p>
 *
 * <p><b>本仓库首次使用 {@code mockStatic}（方法级静态替身）。</b>被拦截的方法是
 * {@link HttpUtils#post(String, java.util.Map, String)}，同时按真实规则转发
 * {@link HttpUtils#encodeUtf8(String)}。原因是目标地址由 {@code AliyunSmsClient} 的私有静态常量
 * {@code URL} 拼成、只能指向真实外网 HTTPS，而本机禁止访问外网且本轮不允许改生产源码；
 * 不拦截就无法覆盖发送、模板查询与查询串编码链路。该替身只隔离外部 HTTP 边界，不伪造被测类
 * 内部逻辑，也不用于把不可达分支伪造成可达。<b>若将来提供可注入的 HTTP 客户端（构造参数或容器
 * Bean），本用例应改为注入该客户端的替身并移除 {@code mockStatic}。</b>除本类与同包的
 * {@code TencentSmsClientTest} 外，本轮未在其它测试引入 {@code mockStatic}。</p>
 *
 * @author shady2713
 */
class AliyunSmsClientTest {

    /** 渠道 apiKey（阿里云 AccessKeyId）。 */
    private static final String API_KEY = "DUMMY-ACCESS-KEY-ID";
    /** 渠道 apiSecret（阿里云 AccessKeySecret），仅用于本地签名计算。 */
    private static final String API_SECRET = "CHANGE_ME_ALIYUN_API_SECRET";
    /** 渠道短信签名，含空格与需要特殊替换的字符以验证编码规则。 */
    private static final String SIGNATURE = "DUMMY 签名*~";

    /** apiKey 为空时必须拒绝构造。 */
    @Test
    void constructorRejectsEmptyApiKey() {
        SmsChannelProperties properties = properties();
        properties.setApiKey("");

        assertThatThrownBy(() -> new AliyunSmsClient(properties))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("apiKey 不能为空");
    }

    /** apiSecret 为空时必须拒绝构造。 */
    @Test
    void constructorRejectsEmptyApiSecret() {
        SmsChannelProperties properties = properties();
        properties.setApiSecret("");

        assertThatThrownBy(() -> new AliyunSmsClient(properties))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("apiSecret 不能为空");
    }

    /** 短信签名为空时必须在发起请求前拒绝，避免云端因签名缺失返回无意义错误。 */
    @Test
    void sendSmsRejectsBlankSignature() {
        SmsChannelProperties properties = properties();
        properties.setSignature(" ");
        AliyunSmsClient client = new AliyunSmsClient(properties);

        assertThatThrownBy(() -> client.sendSms(1024L, "13800000000", "DUMMY-TEMPLATE-CODE", List.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("短信签名不能为空");
    }

    /**
     * 发送成功时必须解析出序列号与请求编号，并按 ACS3 规范构造请求。
     *
     * <p>断言查询串中的签名与模板参数真实经过百分号编码（空格转 {@code %20}、星号转 {@code %2A}、
     * 波浪号还原），以及签名头包含凭据、已签名头列表与内容摘要。</p>
     */
    @Test
    void sendSmsParsesSuccessAndBuildsSignedRequest() {
        AliyunSmsClient client = new AliyunSmsClient(properties());
        AtomicReference<String> url = new AtomicReference<>();
        AtomicReference<Map<String, String>> headers = new AtomicReference<>();
        AtomicReference<String> body = new AtomicReference<>();
        String response = "{\"Code\":\"OK\",\"BizId\":\"DUMMY-BIZ-ID\",\"RequestId\":\"DUMMY-REQUEST-ID\","
                + "\"Message\":\"OK\"}";

        SmsSendRespDTO result;
        try (MockedStatic<HttpUtils> ignored = intercept(url, headers, body, response)) {
            result = client.sendSms(1024L, "13800000000", "DUMMY-TEMPLATE-CODE",
                    List.of(new KeyValue<>("code", "DUMMY-CODE")));
        }

        assertThat(url.get()).startsWith("https://dysmsapi.aliyuncs.com?");
        assertThat(url.get()).contains("PhoneNumbers=13800000000")
                .contains("TemplateCode=DUMMY-TEMPLATE-CODE")
                .contains("OutId=1024")
                .contains("SignName=DUMMY%20%E7%AD%BE%E5%90%8D%2A~")
                .contains("TemplateParam=%7B%22code%22%3A%22DUMMY-CODE%22%7D");
        assertThat(headers.get()).containsEntry("host", "dysmsapi.aliyuncs.com")
                .containsEntry("x-acs-version", "2017-05-25")
                .containsEntry("x-acs-action", "SendSms")
                .containsEntry("x-acs-content-sha256",
                        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assertThat(headers.get().get("Authorization"))
                .startsWith("ACS3-HMAC-SHA256 Credential=DUMMY-ACCESS-KEY-ID, SignedHeaders=")
                .contains("host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version")
                .contains("Signature=");
        assertThat(headers.get().get("x-acs-signature-nonce")).isNotBlank();
        assertThat(body.get()).as("RPC 接口的请求体必须为空").isEmpty();

        assertThat(result.getSuccess()).isTrue();
        assertThat(result.getSerialNo()).isEqualTo("DUMMY-BIZ-ID");
        assertThat(result.getApiRequestId()).isEqualTo("DUMMY-REQUEST-ID");
        assertThat(result.getApiCode()).isEqualTo("OK");
        assertThat(result.getApiMsg()).isEqualTo("OK");
    }

    /**
     * 查询串百分号编码失败必须原样抛出，且不得发出任何请求。
     *
     * <p>签名依赖完整查询串：编码失败时若继续请求，发出去的会是缺参数或未签名的报文，
     * 云端会以业务失败返回，而真实原因（本地编码异常）被掩盖。这里让编码器抛错，
     * 断言异常类型与消息保持不变，并确认 HTTP 调用一次都没有发生。</p>
     */
    @Test
    void percentEncodingFailurePropagatesWithoutSendingRequest() {
        AliyunSmsClient client = new AliyunSmsClient(properties());
        try (MockedStatic<HttpUtils> httpUtils = mockStatic(HttpUtils.class)) {
            httpUtils.when(() -> HttpUtils.encodeUtf8(anyString()))
                    .thenThrow(new IllegalStateException("DUMMY-ENCODE-FAILURE"));

            assertThatThrownBy(() -> client.sendSms(1024L, "13800000000", "DUMMY-TEMPLATE-CODE", List.of()))
                    .as("本地编码失败必须显式失败，不能发出不完整请求")
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("DUMMY-ENCODE-FAILURE");

            httpUtils.verify(() -> HttpUtils.post(anyString(), anyMap(), anyString()), never());
        }
    }

    /** 云端返回非 OK 业务码时必须判为失败并保留错误信息。 */
    @Test
    void sendSmsReportsBusinessFailure() {
        AliyunSmsClient client = new AliyunSmsClient(properties());
        String response = "{\"Code\":\"isv.AMOUNT_NOT_ENOUGH\",\"Message\":\"DUMMY-余额不足\","
                + "\"RequestId\":\"DUMMY-REQUEST-ID\"}";

        SmsSendRespDTO result;
        try (MockedStatic<HttpUtils> ignored = intercept(new AtomicReference<>(), new AtomicReference<>(),
                new AtomicReference<>(), response)) {
            result = client.sendSms(1024L, "13800000000", "DUMMY-TEMPLATE-CODE", List.of());
        }

        assertThat(result.getSuccess()).isFalse();
        assertThat(result.getApiCode()).isEqualTo("isv.AMOUNT_NOT_ENOUGH");
        assertThat(result.getApiMsg()).isEqualTo("DUMMY-余额不足");
        assertThat(result.getSerialNo()).isNull();
    }

    /** 状态报告必须按阿里云字段映射成功标记、错误信息、手机号、时间、序列号与业务编号。 */
    @Test
    void parseSmsReceiveStatusMapsCloudFields() {
        AliyunSmsClient client = new AliyunSmsClient(properties());
        JSONArray statuses = new JSONArray();
        statuses.add(new JSONObject().set("success", true).set("err_code", "DELIVRD")
                .set("err_msg", "DUMMY-成功").set("phone_number", "13800000000")
                .set("report_time", "2024-03-04 05:06:07").set("biz_id", "DUMMY-BIZ-ID").set("out_id", 1024L));
        statuses.add(new JSONObject().set("success", false).set("err_code", "UNDELIV")
                .set("err_msg", "DUMMY-失败").set("phone_number", "13900000000")
                .set("report_time", "2024-03-04 05:06:08").set("biz_id", "DUMMY-BIZ-ID-2").set("out_id", 1025L));

        List<SmsReceiveRespDTO> result = client.parseSmsReceiveStatus(statuses.toString());

        assertThat(result).hasSize(2);
        assertThat(result.get(0).getSuccess()).isTrue();
        assertThat(result.get(0).getErrorCode()).isEqualTo("DELIVRD");
        assertThat(result.get(0).getErrorMsg()).isEqualTo("DUMMY-成功");
        assertThat(result.get(0).getMobile()).isEqualTo("13800000000");
        assertThat(result.get(0).getReceiveTime()).isEqualTo(LocalDateTime.of(2024, 3, 4, 5, 6, 7));
        assertThat(result.get(0).getSerialNo()).isEqualTo("DUMMY-BIZ-ID");
        assertThat(result.get(0).getLogId()).isEqualTo(1024L);
        assertThat(result.get(1).getSuccess()).isFalse();
        assertThat(result.get(1).getLogId()).isEqualTo(1025L);
    }

    /** 空状态报告必须返回空列表而不是 null。 */
    @Test
    void parseSmsReceiveStatusHandlesEmptyArray() {
        AliyunSmsClient client = new AliyunSmsClient(properties());

        assertThat(client.parseSmsReceiveStatus("[]")).isEmpty();
    }

    /** 模板查询成功时必须映射模板编号、内容、审核状态与原因。 */
    @Test
    void getSmsTemplateMapsAuditResult() {
        AliyunSmsClient client = new AliyunSmsClient(properties());
        AtomicReference<String> url = new AtomicReference<>();
        AtomicReference<Map<String, String>> headers = new AtomicReference<>();
        String response = "{\"Code\":\"OK\",\"TemplateCode\":\"DUMMY-TEMPLATE-CODE\","
                + "\"TemplateContent\":\"DUMMY-模板内容\",\"TemplateStatus\":1,\"Reason\":\"DUMMY-审核通过\","
                + "\"RequestId\":\"DUMMY-REQUEST-ID\"}";

        SmsTemplateRespDTO result;
        try (MockedStatic<HttpUtils> ignored = intercept(url, headers, new AtomicReference<>(), response)) {
            result = client.getSmsTemplate("DUMMY-TEMPLATE-CODE");
        }

        assertThat(url.get()).contains("TemplateCode=DUMMY-TEMPLATE-CODE");
        assertThat(headers.get()).containsEntry("x-acs-action", "GetSmsTemplate");
        assertThat(result.getId()).isEqualTo("DUMMY-TEMPLATE-CODE");
        assertThat(result.getContent()).isEqualTo("DUMMY-模板内容");
        assertThat(result.getAuditStatus()).isEqualTo(SmsTemplateAuditStatusEnum.SUCCESS.getStatus());
        assertThat(result.getAuditReason()).isEqualTo("DUMMY-审核通过");
    }

    /** 模板查询返回非 OK 时必须返回 null，不得返回半成品模板。 */
    @Test
    void getSmsTemplateReturnsNullOnBusinessFailure() {
        AliyunSmsClient client = new AliyunSmsClient(properties());
        String response = "{\"Code\":\"isv.TEMPLATE_MISSING_PARAMETERS\",\"Message\":\"DUMMY-参数缺失\","
                + "\"RequestId\":\"DUMMY-REQUEST-ID\",\"TemplateStatus\":0}";

        SmsTemplateRespDTO result;
        try (MockedStatic<HttpUtils> ignored = intercept(new AtomicReference<>(), new AtomicReference<>(),
                new AtomicReference<>(), response)) {
            result = client.getSmsTemplate("DUMMY-TEMPLATE-CODE");
        }

        assertThat(result).isNull();
    }

    /** 审核状态映射必须覆盖三个已知取值，未知取值显式报错。 */
    @Test
    void convertSmsTemplateAuditStatusCoversKnownValues() {
        AliyunSmsClient client = new AliyunSmsClient(properties());

        assertThat(client.convertSmsTemplateAuditStatus(0)).isEqualTo(SmsTemplateAuditStatusEnum.CHECKING.getStatus());
        assertThat(client.convertSmsTemplateAuditStatus(1)).isEqualTo(SmsTemplateAuditStatusEnum.SUCCESS.getStatus());
        assertThat(client.convertSmsTemplateAuditStatus(2)).isEqualTo(SmsTemplateAuditStatusEnum.FAIL.getStatus());
        assertThatThrownBy(() -> client.convertSmsTemplateAuditStatus(99))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("未知审核状态(99)");
    }

    /**
     * 在方法级替身上拦截真实 HTTPS 调用，并捕获请求地址、请求头与请求体。
     *
     * <p>阿里云客户端的唯一进程外边界是 {@link HttpUtils#post}；查询串编码依赖的
     * {@link HttpUtils#encodeUtf8} 是纯函数，替身按同一规则转发，不改变被测逻辑。</p>
     *
     * @param url 接收请求地址的引用
     * @param headers 接收请求头的引用
     * @param body 接收请求体的引用
     * @param response 预置的云端响应报文
     * @return 可关闭的方法级替身，必须在用例作用域内关闭
     */
    private static MockedStatic<HttpUtils> intercept(AtomicReference<String> url,
                                                     AtomicReference<Map<String, String>> headers,
                                                     AtomicReference<String> body, String response) {
        MockedStatic<HttpUtils> httpUtils = mockStatic(HttpUtils.class);
        httpUtils.when(() -> HttpUtils.encodeUtf8(anyString()))
                .thenAnswer(invocation -> java.net.URLEncoder.encode(invocation.getArgument(0),
                        StandardCharsets.UTF_8));
        httpUtils.when(() -> HttpUtils.post(anyString(), anyMap(), anyString())).thenAnswer(invocation -> {
            url.set(invocation.getArgument(0));
            headers.set(invocation.getArgument(1));
            body.set(invocation.getArgument(2));
            return response;
        });
        return httpUtils;
    }

    /** 构造合法的阿里云短信渠道配置。 */
    private static SmsChannelProperties properties() {
        SmsChannelProperties properties = new SmsChannelProperties();
        properties.setId(1L);
        properties.setCode("ALIYUN");
        properties.setSignature(SIGNATURE);
        properties.setApiKey(API_KEY);
        properties.setApiSecret(API_SECRET);
        return properties;
    }

}
