package com.basicframework.module.system.controller.admin.sms;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.basicframework.framework.apilog.core.annotation.ApiAccessLog;
import com.basicframework.module.system.framework.sms.core.client.SmsReceiptException;
import com.basicframework.module.system.framework.sms.core.client.impl.AliyunSmsClient;
import com.basicframework.module.system.framework.sms.core.client.impl.TencentSmsClient;
import com.basicframework.module.system.framework.sms.core.enums.SmsChannelEnum;
import com.basicframework.module.system.framework.sms.core.property.SmsChannelProperties;
import com.basicframework.module.system.service.sms.SmsChannelService;
import com.basicframework.module.system.service.sms.SmsLogService;
import com.basicframework.module.system.service.sms.SmsSendServiceImpl;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 保护匿名回执从 HTTP 到真实供应商解析器的契约，仅隔离渠道查找与日志存储资源。
 *
 * <p>不模拟 Controller、发送 Service 或供应商 Client，避免宽松解析、日期转换等问题被业务 mock 掩盖。
 * 不加载真实配置或调用供应商网络接口；测试标识均为本地合成数据。</p>
 *
 * @author shady2713
 */
class SmsCallbackParsingTest {

    /** 合成手机号，仅用于观察真实解析后用于匹配的字段。 */
    private static final String MOBILE = "13800000001";
    /** 合成供应商流水号，不对应任何真实发送记录。 */
    private static final String SERIAL = "synthetic-receipt-serial";
    /** 固定回执时间，避免测试依赖系统时钟。 */
    private static final String REPORT_TIME = "2026-09-30 12:34:56";

    /** 按真实端点调度的 MVC，未加入公共 JSON 缓存过滤器。 */
    private MockMvc mvc;
    /** 隔离渠道缓存资源，不改变真实客户端解析实现。 */
    private SmsChannelService channelService;
    /** 隔离日志存储资源，通过参数断言观察真实解析结果。 */
    private SmsLogService logService;

    /** 装配真实回调链，只将外部渠道资源与日志持久化换成可观察边界。 */
    @BeforeEach
    void setUp() {
        channelService = mock(SmsChannelService.class);
        logService = mock(SmsLogService.class);
        when(channelService.getSmsClient(SmsChannelEnum.ALIYUN.getCode()))
                .thenReturn(new AliyunSmsClient(properties(SmsChannelEnum.ALIYUN)));
        when(channelService.getSmsClient(SmsChannelEnum.TENCENT.getCode()))
                .thenReturn(new TencentSmsClient(properties(SmsChannelEnum.TENCENT)));
        SmsSendServiceImpl sendService = new SmsSendServiceImpl();
        ReflectionTestUtils.setField(sendService, "smsChannelService", channelService);
        ReflectionTestUtils.setField(sendService, "smsLogService", logService);
        SmsCallbackController controller = new SmsCallbackController();
        ReflectionTestUtils.setField(controller, "smsSendService", sendService);
        mvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    /** 阿里云合法回执必须保持原成功应答，并把真实解析的完整匹配字段送往日志边界。 */
    @Test
    void aliyunValidReceiptUsesRealParserAndPreservesSuccessResponse() throws Exception {
        mvc.perform(post("/system/sms/callback/aliyun")
                        .contentType(MediaType.APPLICATION_JSON).content(aliyunBody(REPORT_TIME)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.msg").value("接收成功"));

        verify(logService).updateSmsReceiveResult(SmsChannelEnum.ALIYUN.getCode(), 17L, SERIAL, MOBILE,
                true, LocalDateTime.of(2026, 9, 30, 12, 34, 56), "DELIVERED", "合成送达描述");
    }

    /** 腾讯云合法回执同样经过真实日期和状态转换，不依赖发送 Service 的预设返回。 */
    @Test
    void tencentValidReceiptUsesRealParserAndPreservesSuccessResponse() throws Exception {
        mvc.perform(post("/system/sms/callback/tencent")
                        .contentType(MediaType.APPLICATION_JSON).content(tencentBody(REPORT_TIME)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value(0))
                .andExpect(jsonPath("$.errmsg").value("OK"));

        verify(logService).updateSmsReceiveResult(SmsChannelEnum.TENCENT.getCode(), null, SERIAL, MOBILE,
                true, LocalDateTime.of(2026, 9, 30, 12, 34, 56), "DELIVERED", "合成送达描述");
    }

    /** 供应商报告失败也是有效回执，应推进失败终态而不是拒绝整个协议请求。 */
    @Test
    void tencentDeliveryFailureIsAcceptedAsValidTerminalReceipt() throws Exception {
        String body = tencentBody(REPORT_TIME).replace("\"SUCCESS\"", "\"FAIL\"");
        mvc.perform(post("/system/sms/callback/tencent")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value(0));

        verify(logService).updateSmsReceiveResult(SmsChannelEnum.TENCENT.getCode(), null, SERIAL, MOBILE,
                false, LocalDateTime.of(2026, 9, 30, 12, 34, 56), "DELIVERED", "合成送达描述");
    }

    /** 结构化 JSON 媒体类型使用回调专用流读取，即使没有公共缓存过滤器也能真实解析。 */
    @Test
    void jsonSuffixMediaTypeUsesDedicatedBodyStream() throws Exception {
        mvc.perform(post("/system/sms/callback/aliyun")
                        .contentType("application/vnd.sms-report+json; charset=UTF-8")
                        .content(aliyunBody(REPORT_TIME)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));

        verify(logService).updateSmsReceiveResult(SmsChannelEnum.ALIYUN.getCode(), 17L, SERIAL, MOBILE,
                true, LocalDateTime.of(2026, 9, 30, 12, 34, 56), "DELIVERED", "合成送达描述");
    }

    /** 非 JSON 请求不能因正文看起来像 JSON 就被嗅探接收，也不得进入渠道或存储层。 */
    @ParameterizedTest(name = "{0}: non-JSON -> 415")
    @ValueSource(strings = {"aliyun", "tencent"})
    void nonJsonMediaTypeIsRejectedBeforeResourceAccess(String provider) throws Exception {
        mvc.perform(post("/system/sms/callback/" + provider)
                        .contentType(MediaType.TEXT_PLAIN).content(aliyunBody(REPORT_TIME)))
                .andExpect(status().isUnsupportedMediaType());

        verifyNoInteractions(channelService, logService);
    }

    /** 缺少媒体类型无从确认供应商 JSON 协议，必须用 415 拒绝而不能报告成功。 */
    @Test
    void missingMediaTypeIsRejectedWith415() throws Exception {
        mvc.perform(post("/system/sms/callback/aliyun").content(aliyunBody(REPORT_TIME)))
                .andExpect(status().isUnsupportedMediaType());

        verifyNoInteractions(channelService, logService);
    }

    /** 坏 JSON 属于调用方协议错误，不能被真实解析器异常转成内部故障或成功。 */
    @ParameterizedTest(name = "{0}: malformed JSON -> 400")
    @ValueSource(strings = {"aliyun", "tencent"})
    void malformedJsonIsRejectedWith400(String provider) throws Exception {
        rejectJsonWithoutResourceAccess(provider, "[{\"mobile\":\"" + MOBILE + "\"");
    }

    /** JSON 媒体类型下没有正文时不存在有效回执，不能调用日志更新。 */
    @ParameterizedTest(name = "{0}: empty body -> 400")
    @ValueSource(strings = {"aliyun", "tencent"})
    void emptyJsonBodyIsRejectedWith400(String provider) throws Exception {
        rejectJsonWithoutResourceAccess(provider, "");
    }

    /** 空数组不能冒充一次已处理的回执，否则供应商会停止投递但系统没有任何结果。 */
    @ParameterizedTest(name = "{0}: empty array -> 400")
    @ValueSource(strings = {"aliyun", "tencent"})
    void emptyReceiptArrayIsRejectedWith400(String provider) throws Exception {
        rejectJsonWithoutResourceAccess(provider, "[]");
    }

    /** 缺少供应商流水号无法与已有发送记录交叉匹配，必须在访问资源前拒绝。 */
    @Test
    void aliyunMissingSerialIsRejectedBeforeResourceAccess() throws Exception {
        rejectJsonWithoutResourceAccess("aliyun",
                aliyunBody(REPORT_TIME).replace("\"biz_id\":\"" + SERIAL + "\",", ""));
    }

    /** 缺少手机号无法限定已有发送记录，匿名回执不得只靠流水号命中数据。 */
    @Test
    void tencentMissingMobileIsRejectedBeforeResourceAccess() throws Exception {
        rejectJsonWithoutResourceAccess("tencent",
                tencentBody(REPORT_TIME).replace("\"mobile\":\"" + MOBILE + "\",", ""));
    }

    /** 数字标识不能靠 Hutool 宽松字符串转换冒充供应商协议中的流水号。 */
    @Test
    void numericSerialIsRejectedInsteadOfCoercingToString() throws Exception {
        rejectJsonWithoutResourceAccess("tencent",
                tencentBody(REPORT_TIME).replace("\"sid\":\"" + SERIAL + "\"", "\"sid\":17"));
    }

    /** 阿里云成功标志必须为布尔值，不能把缺失或字符串误解释成失败终态。 */
    @Test
    void aliyunNonBooleanStatusIsRejectedBeforeResourceAccess() throws Exception {
        rejectJsonWithoutResourceAccess("aliyun", aliyunBody(REPORT_TIME)
                .replace("\"success\":true", "\"success\":\"true\""));
    }

    /** 腾讯云缺失状态必须拒绝，不能由真实解析器的默认比较产生错误的失败终态。 */
    @Test
    void tencentMissingStatusIsRejectedBeforeResourceAccess() throws Exception {
        rejectJsonWithoutResourceAccess("tencent",
                tencentBody(REPORT_TIME).replace("\"report_status\":\"SUCCESS\",", ""));
    }

    /** 不可转换的日期由真实供应商解析器处理，仍应归类为 400 且没有存储副作用。 */
    @ParameterizedTest(name = "{0}: unparseable receipt time -> 400")
    @ValueSource(strings = {"aliyun", "tencent"})
    void unparseableReceiptTimeIsRejectedWithoutLogUpdates(String provider) throws Exception {
        String body = "aliyun".equals(provider) ? aliyunBody("invalid-receipt-time")
                : tencentBody("invalid-receipt-time");
        mvc.perform(post("/system/sms/callback/" + provider)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest());

        verify(channelService).getSmsClient(provider.toUpperCase(java.util.Locale.ROOT));
        verifyNoInteractions(logService);
    }

    /** 后续条目日期解析失败时整批结果尚未更新，不能先成功写入第一条再丢弃坏条目。 */
    @ParameterizedTest(name = "{0}: later invalid entry -> 400 with no updates")
    @ValueSource(strings = {"aliyun", "tencent"})
    void laterInvalidReceiptDoesNotPartiallyUpdateEarlierReceipt(String provider) throws Exception {
        String valid = "aliyun".equals(provider) ? aliyunBody(REPORT_TIME) : tencentBody(REPORT_TIME);
        String invalid = "aliyun".equals(provider) ? aliyunBody("invalid-receipt-time")
                : tencentBody("invalid-receipt-time");
        String batch = valid.substring(0, valid.length() - 1) + "," + invalid.substring(1);
        mvc.perform(post("/system/sms/callback/" + provider)
                        .contentType(MediaType.APPLICATION_JSON).content(batch))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(logService);
    }

    /** 无已有日志匹配属于无效匿名输入，日志边界的明确拒绝不能被应答为成功。 */
    @Test
    void unmatchedExistingLogIsReportedAs400() throws Exception {
        doThrow(new SmsReceiptException("unmatched_receipt")).when(logService)
                .updateSmsReceiveResult(anyString(), any(), anyString(), anyString(),
                        any(), any(), any(), any());

        mvc.perform(post("/system/sms/callback/tencent")
                        .contentType(MediaType.APPLICATION_JSON).content(tencentBody(REPORT_TIME)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.result").value(1))
                .andExpect(jsonPath("$.errmsg").value("FAILED"));

        verify(logService).updateSmsReceiveResult(eq(SmsChannelEnum.TENCENT.getCode()), isNull(),
                eq(SERIAL), eq(MOBILE), eq(true), any(), eq("DELIVERED"), eq("合成送达描述"));
    }

    /** 真正内部故障仅使用固定归类日志，响应和日志均不能携带原文、标识或异常细节。 */
    @Test
    void internalFailureLogsOnlySafeMetadataAndReturnsGenericResponse() throws Exception {
        String sensitiveMarker = "synthetic-exception-marker";
        doThrow(new IllegalStateException(sensitiveMarker + MOBILE + SERIAL)).when(logService)
                .updateSmsReceiveResult(anyString(), any(), anyString(), anyString(),
                        any(), any(), any(), any());
        Logger logger = (Logger) LoggerFactory.getLogger(SmsCallbackController.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            String body = tencentBody(REPORT_TIME);
            MvcResult result = mvc.perform(post("/system/sms/callback/tencent")
                            .contentType("Application/JSON; charset=UTF-8")
                            .header("Authorization", "synthetic-authorization-marker")
                            .content(body))
                    .andExpect(status().isInternalServerError())
                    .andExpect(jsonPath("$.result").value(1))
                    .andExpect(jsonPath("$.errmsg").value("FAILED"))
                    .andReturn();

            assertThat(appender.list).hasSize(1);
            ILoggingEvent event = appender.list.get(0);
            assertThat(event.getThrowableProxy()).isNull();
            assertThat(event.getFormattedMessage())
                    .contains("reason(processing_failure)", "traceId(", "mediaType(application/json)",
                            "bodyLength(" + body.getBytes(StandardCharsets.UTF_8).length + ")")
                    .doesNotContain(MOBILE, SERIAL, sensitiveMarker, "Authorization",
                            "synthetic-authorization-marker", "IllegalStateException", "合成送达描述");
            assertThat(result.getResponse().getContentAsString(StandardCharsets.UTF_8))
                    .doesNotContain(MOBILE, SERIAL, sensitiveMarker, "IllegalStateException");
        } finally {
            // Appender 属于本用例，及时移除以免污染后续测试的日志观察结果。
            logger.detachAppender(appender);
            appender.stop();
        }
    }

    /** 两个匿名回调必须关闭请求体访问日志，防止合法报文中的手机号进入统一审计记录。 */
    @Test
    void callbackEndpointsDisableRequestBodyAccessLogging() throws NoSuchMethodException {
        for (String method : new String[]{"receiveAliyunSmsStatus", "receiveTencentSmsStatus"}) {
            ApiAccessLog annotation = SmsCallbackController.class.getMethod(method, HttpServletRequest.class)
                    .getAnnotation(ApiAccessLog.class);
            assertThat(annotation).isNotNull();
            assertThat(annotation.requestEnable()).isFalse();
        }
    }

    /** 构造只满足客户端初始化约束的本地配置，凭据运行时生成且不会发起网络调用。 */
    private static SmsChannelProperties properties(SmsChannelEnum channel) {
        SmsChannelProperties properties = new SmsChannelProperties();
        properties.setId(1L);
        properties.setCode(channel.getCode());
        properties.setSignature("合成测试签名");
        String syntheticKey = UUID.randomUUID().toString();
        properties.setApiKey(channel == SmsChannelEnum.TENCENT ? syntheticKey + " 1400000000" : syntheticKey);
        properties.setApiSecret(UUID.randomUUID().toString());
        return properties;
    }

    /** 构造带内部编号的阿里云数组协议，以确认编号与供应商匹配标识共同透传。 */
    private static String aliyunBody(String reportTime) {
        return "[{\"phone_number\":\"" + MOBILE + "\",\"biz_id\":\"" + SERIAL
                + "\",\"out_id\":\"17\",\"report_time\":\"" + reportTime
                + "\",\"success\":true,\"err_code\":\"DELIVERED\",\"err_msg\":\"合成送达描述\"}]";
    }

    /** 构造无内部编号的腾讯云数组协议，以确认匹配不依赖供应商未提供的字段。 */
    private static String tencentBody(String reportTime) {
        return "[{\"mobile\":\"" + MOBILE + "\",\"sid\":\"" + SERIAL
                + "\",\"user_receive_time\":\"" + reportTime
                + "\",\"report_status\":\"SUCCESS\",\"errmsg\":\"DELIVERED\","
                + "\"description\":\"合成送达描述\"}]";
    }

    /** 协议字段无效应在资源访问前完成整批拒绝，避免匿名输入触达日志更新。 */
    private void rejectJsonWithoutResourceAccess(String provider, String body) throws Exception {
        mvc.perform(post("/system/sms/callback/" + provider)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(channelService, logService);
    }
}
