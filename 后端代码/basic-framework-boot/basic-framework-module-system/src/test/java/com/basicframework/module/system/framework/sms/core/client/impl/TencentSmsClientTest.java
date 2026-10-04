package com.basicframework.module.system.framework.sms.core.client.impl;

import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
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

/**
 * 验证腾讯云短信客户端的配置校验、请求构造、响应解析与状态映射契约。
 *
 * <p>该客户端把渠道配置翻译成腾讯云短信 API 请求：apiKey 必须按 {@code secretId sdkAppId}
 * 的约定拆分，拆错会让签名身份与发送应用不匹配；请求头必须带 TC3-HMAC-SHA256 签名与正确的
 * Action／Version／Region，否则云端直接拒绝；响应必须区分业务错误与发送结果，把错误当成功会让
 * 短信日志出现假成功。</p>
 *
 * <p>唯一的进程外边界是真实 HTTPS 调用：用例拦截 {@link HttpUtils#post} 并捕获真实请求的地址、
 * 请求头与请求体，其余逻辑（签名串构造、请求体组装、响应解析、状态映射）全部走真实实现。
 * 替身只返回预置的云端报文，不访问外网、不使用任何真实凭据。</p>
 *
 * <p><b>本仓库首次使用 {@code mockStatic}（方法级静态替身）。</b>被拦截的方法是
 * {@link HttpUtils#post(String, java.util.Map, String)}，同时按真实规则转发
 * {@link HttpUtils#encodeUtf8(String)}。原因是目标地址由 {@code TencentSmsClient} 的私有静态常量
 * {@code HOST} 拼成、只能指向真实外网 HTTPS，而本机禁止访问外网且本轮不允许改生产源码；
 * 不拦截就无法覆盖发送与模板查询链路。该替身只隔离外部 HTTP 边界，不伪造被测类内部逻辑，
 * 也不用于把不可达分支伪造成可达。<b>若将来提供可注入的 HTTP 客户端（构造参数或容器 Bean），
 * 本用例应改为注入该客户端的替身并移除 {@code mockStatic}。</b>除本类与同包的
 * {@code AliyunSmsClientTest} 外，本轮未在其它测试引入 {@code mockStatic}。</p>
 *
 * @author shady2713
 */
class TencentSmsClientTest {

    /** 渠道 apiKey，按约定由 secretId 与 sdkAppId 以空格拼接。 */
    private static final String COMBINED_API_KEY = "DUMMY-SECRET-ID DUMMY-SDK-APP-ID";
    /** 渠道 apiSecret，仅用于本地签名计算。 */
    private static final String API_SECRET = "CHANGE_ME_TENCENT_API_SECRET";
    /** 渠道短信签名。 */
    private static final String SIGNATURE = "DUMMY签名";

    /** apiKey 为空时必须拒绝构造，避免运行期用空身份调用云端。 */
    @Test
    void constructorRejectsEmptyApiKey() {
        SmsChannelProperties properties = properties();
        properties.setApiKey("");

        assertThatThrownBy(() -> new TencentSmsClient(properties))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("apiKey 不能为空");
    }

    /** apiSecret 为空时必须拒绝构造。 */
    @Test
    void constructorRejectsEmptyApiSecret() {
        SmsChannelProperties properties = properties();
        properties.setApiSecret("");

        assertThatThrownBy(() -> new TencentSmsClient(properties))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("apiSecret 不能为空");
    }

    /** apiKey 不是两段时必须拒绝构造，避免把 secretId 或 sdkAppId 解析成空值。 */
    @Test
    void constructorRejectsMalformedApiKey() {
        SmsChannelProperties singleToken = properties();
        singleToken.setApiKey("DUMMY-SECRET-ID");
        assertThatThrownBy(() -> new TencentSmsClient(singleToken))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("腾讯云短信 apiKey 配置格式错误");

        SmsChannelProperties threeTokens = properties();
        threeTokens.setApiKey("DUMMY-SECRET-ID DUMMY-SDK-APP-ID EXTRA");
        assertThatThrownBy(() -> new TencentSmsClient(threeTokens))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("腾讯云短信 apiKey 配置格式错误");
    }

    /**
     * 发送成功时必须解析出序列号与请求编号，并把渠道配置真实写入请求。
     *
     * <p>断言请求体中的 {@code SmsSdkAppId} 取自 apiKey 的第二段，证明"secretId sdkAppId"
     * 的拆分约定生效；同时核对签名头包含凭据范围与签名头列表。</p>
     */
    @Test
    void sendSmsParsesSuccessAndBuildsSignedRequest() {
        TencentSmsClient client = new TencentSmsClient(properties());
        AtomicReference<String> url = new AtomicReference<>();
        AtomicReference<Map<String, String>> headers = new AtomicReference<>();
        AtomicReference<String> body = new AtomicReference<>();
        String response = "{\"Response\":{\"RequestId\":\"DUMMY-REQUEST-ID\",\"SendStatusSet\":"
                + "[{\"Code\":\"Ok\",\"SerialNo\":\"DUMMY-SERIAL-NO\",\"Message\":\"send success\"}]}}";

        SmsSendRespDTO result;
        try (MockedStatic<HttpUtils> httpUtils = intercept(url, headers, body, response)) {
            result = client.sendSms(1024L, "13800000000", "DUMMY-TEMPLATE-ID",
                    List.of(new KeyValue<>("code", "DUMMY-CODE"), new KeyValue<>("minutes", 5)));
        }

        assertThat(url.get()).isEqualTo("https://sms.tencentcloudapi.com");
        assertThat(headers.get()).containsEntry("X-TC-Action", "SendSms")
                .containsEntry("X-TC-Version", "2021-01-11")
                .containsEntry("X-TC-Region", "ap-guangzhou")
                .containsEntry("Host", "sms.tencentcloudapi.com")
                .containsEntry("Content-Type", "application/json; charset=utf-8");
        assertThat(headers.get().get("Authorization"))
                .as("签名头必须带 secretId 凭据范围与已签名头列表")
                .startsWith("TC3-HMAC-SHA256 Credential=DUMMY-SECRET-ID/")
                .contains("/sms/tc3_request")
                .contains("SignedHeaders=content-type;host;x-tc-action")
                .contains("Signature=");
        assertThat(headers.get().get("X-TC-Timestamp")).matches("\\d+");

        JSONObject requestBody = JSONUtil.parseObj(body.get());
        assertThat(requestBody.getJSONArray("PhoneNumberSet").toList(String.class))
                .containsExactly("13800000000");
        assertThat(requestBody.getStr("SmsSdkAppId")).as("sdkAppId 必须取自 apiKey 的第二段")
                .isEqualTo("DUMMY-SDK-APP-ID");
        assertThat(requestBody.getStr("SignName")).isEqualTo(SIGNATURE);
        assertThat(requestBody.getStr("TemplateId")).isEqualTo("DUMMY-TEMPLATE-ID");
        assertThat(requestBody.getJSONArray("TemplateParamSet").toList(String.class))
                .as("模板参数必须按顺序转成字符串").containsExactly("DUMMY-CODE", "5");

        assertThat(result.getSuccess()).isTrue();
        assertThat(result.getSerialNo()).isEqualTo("DUMMY-SERIAL-NO");
        assertThat(result.getApiRequestId()).isEqualTo("DUMMY-REQUEST-ID");
        assertThat(result.getApiMsg()).isEqualTo("send success");
    }

    /** 云端返回 Error 节点时必须判为失败并保留错误码与描述，不得当成发送成功。 */
    @Test
    void sendSmsReportsCloudError() {
        TencentSmsClient client = new TencentSmsClient(properties());
        String response = "{\"Response\":{\"Error\":{\"Code\":\"FailedOperation.PhoneNumberInBlacklist\","
                + "\"Message\":\"DUMMY-黑名单\"},\"RequestId\":\"DUMMY-REQUEST-ID\"}}";

        SmsSendRespDTO result;
        try (MockedStatic<HttpUtils> ignored = intercept(new AtomicReference<>(), new AtomicReference<>(),
                new AtomicReference<>(), response)) {
            result = client.sendSms(1024L, "13800000000", "DUMMY-TEMPLATE-ID", List.of());
        }

        assertThat(result.getSuccess()).isFalse();
        assertThat(result.getApiCode()).isEqualTo("FailedOperation.PhoneNumberInBlacklist");
        assertThat(result.getApiMsg()).isEqualTo("DUMMY-黑名单");
        assertThat(result.getApiRequestId()).isEqualTo("DUMMY-REQUEST-ID");
        assertThat(result.getSerialNo()).as("失败时没有序列号").isNull();
    }

    /** 发送结果 code 不是 Ok 时必须判为失败，即使 HTTP 层没有错误节点。 */
    @Test
    void sendSmsTreatsNonOkSendStatusAsFailure() {
        TencentSmsClient client = new TencentSmsClient(properties());
        String response = "{\"Response\":{\"RequestId\":\"DUMMY-REQUEST-ID\",\"SendStatusSet\":"
                + "[{\"Code\":\"LimitExceeded\",\"SerialNo\":\"DUMMY-SERIAL-NO\",\"Message\":\"DUMMY-限流\"}]}}";

        SmsSendRespDTO result;
        try (MockedStatic<HttpUtils> ignored = intercept(new AtomicReference<>(), new AtomicReference<>(),
                new AtomicReference<>(), response)) {
            result = client.sendSms(1024L, "13800000000", "DUMMY-TEMPLATE-ID", List.of());
        }

        assertThat(result.getSuccess()).isFalse();
        assertThat(result.getApiMsg()).isEqualTo("DUMMY-限流");
        assertThat(result.getSerialNo()).isEqualTo("DUMMY-SERIAL-NO");
    }

    /** 状态报告必须按腾讯云字段映射成功标记、错误信息、手机号、时间与序列号。 */
    @Test
    void parseSmsReceiveStatusMapsCloudFields() {
        TencentSmsClient client = new TencentSmsClient(properties());
        JSONArray statuses = new JSONArray();
        statuses.add(new JSONObject().set("report_status", "SUCCESS").set("errmsg", "")
                .set("description", "DUMMY-成功").set("mobile", "13800000000")
                .set("user_receive_time", "2024-03-04 05:06:07").set("sid", "DUMMY-SERIAL-NO"));
        statuses.add(new JSONObject().set("report_status", "FAIL").set("errmsg", "DELIVRD_FAIL")
                .set("description", "DUMMY-失败").set("mobile", "13900000000")
                .set("user_receive_time", "2024-03-04 05:06:08").set("sid", "DUMMY-SERIAL-NO-2"));

        List<SmsReceiveRespDTO> result = client.parseSmsReceiveStatus(statuses.toString());

        assertThat(result).hasSize(2);
        assertThat(result.get(0).getSuccess()).isTrue();
        assertThat(result.get(0).getErrorMsg()).isEqualTo("DUMMY-成功");
        assertThat(result.get(0).getMobile()).isEqualTo("13800000000");
        assertThat(result.get(0).getReceiveTime()).isEqualTo(LocalDateTime.of(2024, 3, 4, 5, 6, 7));
        assertThat(result.get(0).getSerialNo()).isEqualTo("DUMMY-SERIAL-NO");
        assertThat(result.get(1).getSuccess()).isFalse();
        assertThat(result.get(1).getErrorCode()).isEqualTo("DELIVRD_FAIL");
        assertThat(result.get(1).getSerialNo()).isEqualTo("DUMMY-SERIAL-NO-2");
    }

    /** 空状态报告必须返回空列表而不是 null。 */
    @Test
    void parseSmsReceiveStatusHandlesEmptyArray() {
        TencentSmsClient client = new TencentSmsClient(properties());

        assertThat(client.parseSmsReceiveStatus("[]")).isEmpty();
    }

    /** 模板查询必须按模板编号与国内短信标记构造请求，并映射审核状态与内容。 */
    @Test
    void getSmsTemplateMapsAuditResultAndRequest() {
        TencentSmsClient client = new TencentSmsClient(properties());
        AtomicReference<String> body = new AtomicReference<>();
        String response = "{\"Response\":{\"DescribeTemplateStatusSet\":[{\"TemplateContent\":\"DUMMY-模板内容\","
                + "\"StatusCode\":0,\"ReviewReply\":\"DUMMY-审核通过\"}]}}";

        SmsTemplateRespDTO result;
        try (MockedStatic<HttpUtils> ignored = intercept(new AtomicReference<>(), new AtomicReference<>(), body,
                response)) {
            result = client.getSmsTemplate("1234567");
        }

        JSONObject requestBody = JSONUtil.parseObj(body.get());
        assertThat(requestBody.getLong("International")).as("必须显式声明国内短信").isZero();
        assertThat(requestBody.getJSONArray("TemplateIdSet").toList(Integer.class)).containsExactly(1234567);
        assertThat(result.getId()).isEqualTo("1234567");
        assertThat(result.getContent()).isEqualTo("DUMMY-模板内容");
        assertThat(result.getAuditStatus()).isEqualTo(SmsTemplateAuditStatusEnum.SUCCESS.getStatus());
        assertThat(result.getAuditReason()).isEqualTo("DUMMY-审核通过");
    }

    /** 审核状态映射必须覆盖三个已知取值，未知取值显式报错。 */
    @Test
    void convertSmsTemplateAuditStatusCoversKnownValues() {
        TencentSmsClient client = new TencentSmsClient(properties());

        assertThat(client.convertSmsTemplateAuditStatus(1)).isEqualTo(SmsTemplateAuditStatusEnum.CHECKING.getStatus());
        assertThat(client.convertSmsTemplateAuditStatus(0)).isEqualTo(SmsTemplateAuditStatusEnum.SUCCESS.getStatus());
        assertThat(client.convertSmsTemplateAuditStatus(-1)).isEqualTo(SmsTemplateAuditStatusEnum.FAIL.getStatus());
        assertThatThrownBy(() -> client.convertSmsTemplateAuditStatus(99))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("未知审核状态(99)");
    }

    /**
     * 在方法级替身上拦截真实 HTTPS 调用，并捕获请求地址、请求头与请求体。
     *
     * <p>腾讯云客户端的唯一进程外边界是 {@link HttpUtils#post}；替身只替换该方法，
     * {@link HttpUtils#encodeUtf8} 等纯函数仍按真实实现执行。</p>
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

    /** 构造合法的腾讯云短信渠道配置。 */
    private static SmsChannelProperties properties() {
        SmsChannelProperties properties = new SmsChannelProperties();
        properties.setId(1L);
        properties.setCode("TENCENT");
        properties.setSignature(SIGNATURE);
        properties.setApiKey(COMBINED_API_KEY);
        properties.setApiSecret(API_SECRET);
        return properties;
    }

}
