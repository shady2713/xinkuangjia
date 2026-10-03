package com.basicframework.module.system.controller.admin.sms;

import com.basicframework.module.system.controller.admin.sms.vo.channel.SmsChannelSaveReqVO;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.dal.dataobject.sms.SmsChannelDO;
import com.basicframework.module.system.dal.dataobject.sms.SmsTemplateDO;
import com.basicframework.module.system.framework.sms.core.enums.SmsChannelEnum;
import com.basicframework.module.system.service.sms.SmsChannelService;
import com.basicframework.module.system.service.sms.SmsSendService;
import com.basicframework.module.system.service.sms.SmsTemplateService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.validation.Validator;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.authorization.AuthorizationDeniedException;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 用真实 Spring MVC、真实参数校验与真实方法级鉴权验证短信 Controller 的 HTTP 契约。
 *
 * <p>Controller 层此前完全没有用例，而它承载三类无法由 Service 测试发现的真实风险：
 * 匿名回执入口必须按供应商协议应答、处理失败要让供应商重试而不是假装成功；
 * {@code @PreAuthorize} 声明的权限串一旦漂移，前端按钮与后端鉴权会静默失配；
 * 参数校验必须发生在业务调用之前，非法请求不得触达 Service。</p>
 *
 * <p>Service 层已在 SmsSendPipelineMySqlIT 覆盖真实数据库、缓存与供应商交互，因此这里
 * 用替身隔离，只锁定 Controller 自身的校验、鉴权、参数转发与响应组装行为。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class SmsControllerWebTest {

    /** 生产导出单次上限，Controller 会无视调用方分页参数改用该值。 */
    private static final int MAX_EXPORT_SIZE = 10_000;

    /** 阿里云回执原文，用真实协议字段而不是占位串，便于核对透传是否保真。 */
    private static final String ALIYUN_RECEIPT =
            "[{\"phone_number\":\"13800000001\",\"report_time\":\"2026-01-01 10:00:00\","
                    + "\"success\":true,\"err_code\":\"0\",\"err_msg\":\"OK\",\"biz_id\":\"biz-1\",\"out_id\":\"9\"}]";

    /** 腾讯云真实数组回执，用于确认协议字段与渠道编码均按供应商边界转发。 */
    private static final String TENCENT_RECEIPT =
            "[{\"mobile\":\"13800000001\",\"user_receive_time\":\"2026-01-01 10:00:00\","
                    + "\"report_status\":\"SUCCESS\",\"errmsg\":\"0\",\"description\":\"OK\",\"sid\":\"sid-1\"}]";

    private AnnotationConfigWebApplicationContext context;
    private MockMvc mvc;
    private ObjectMapper objectMapper = new ObjectMapper();

    private PermissionGate permissionGate;

    /** 配置类是静态嵌套类，必须通过静态字段拿到在 refresh 之前创建的替身。 */
    private static SmsChannelService channelService;
    private static SmsTemplateService templateService;
    private static SmsSendService sendService;

    /** 装配真实 MVC 容器、真实校验器与真实方法级鉴权，Service 用替身隔离。 */
    @BeforeAll
    void startWebContext() {
        channelService = mock(SmsChannelService.class);
        templateService = mock(SmsTemplateService.class);
        sendService = mock(SmsSendService.class);
        context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.register(WebTestConfiguration.class);
        context.refresh();
        permissionGate = context.getBean(PermissionGate.class);
        mvc = MockMvcBuilders.webAppContextSetup(context).build();
    }

    /** 每例复位替身与鉴权记录，避免“从未调用”类断言被上一例污染。 */
    @BeforeEach
    void resetFixture() {
        reset(channelService, templateService, sendService);
        permissionGate.reset();
    }

    /**
     * 阿里云回执必须原样透传给业务层并按协议应答成功。
     *
     * <p>回执是匿名的，成功应答的内容必须是供应商约定的 code=0；业务层收到 null 或被
     * 改写的原文都会让回执无法匹配到发送日志。</p>
     */
    @Test
    void aliyunReceiptIsForwardedVerbatimAndAcknowledged() throws Exception {
        MvcResult result = mvc.perform(post("/system/sms/callback/aliyun")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(ALIYUN_RECEIPT))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode body = readBody(result);
        assertThat(body.get("code").asInt()).as("阿里云协议要求 0 表示接收成功").isZero();
        assertThat(body.get("msg").asText()).isEqualTo("接收成功");
        verify(sendService).receiveSmsStatus(eq(SmsChannelEnum.ALIYUN.getCode()), eq(ALIYUN_RECEIPT));
    }

    /** 腾讯云回执走独立入口，必须带上腾讯云渠道编码而不是复用阿里云。 */
    @Test
    void tencentReceiptUsesTencentChannelCode() throws Exception {
        MvcResult result = mvc.perform(post("/system/sms/callback/tencent")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(TENCENT_RECEIPT))
                .andExpect(status().isOk())
                .andReturn();

        assertThat(readBody(result).get("result").asInt()).as("腾讯云协议用 result 表示接收结果").isZero();
        verify(sendService).receiveSmsStatus(eq(SmsChannelEnum.TENCENT.getCode()), eq(TENCENT_RECEIPT));
    }

    /**
     * 回执处理失败必须返回 50X，让供应商按协议重投。
     *
     * <p>返回成功应答会让供应商认为已接收，这条回执将永久丢失，发送状态无法收敛。</p>
     */
    @Test
    void receiptProcessingFailureReturnsServerErrorToTriggerRetry() throws Exception {
        // receiveSmsStatus 返回 void，必须用 doThrow 而不是 when(...).thenThrow
        doThrow(new IllegalStateException("controlled-receipt-failure"))
                .when(sendService).receiveSmsStatus(anyString(), anyString());

        MvcResult aliyun = mvc.perform(post("/system/sms/callback/aliyun")
                        .contentType(MediaType.APPLICATION_JSON).content(ALIYUN_RECEIPT))
                .andExpect(status().isInternalServerError()).andReturn();
        assertThat(readBody(aliyun).get("code").asInt()).as("失败应答不能与成功混淆").isEqualTo(1);

        MvcResult tencent = mvc.perform(post("/system/sms/callback/tencent")
                        .contentType(MediaType.APPLICATION_JSON).content(TENCENT_RECEIPT))
                .andExpect(status().isInternalServerError()).andReturn();
        assertThat(readBody(tencent).get("result").asInt())
                .as("腾讯云失败应答不能与成功混淆").isEqualTo(1);
    }

    /**
     * 非 JSON 回执必须以 415 拒绝，不能把未读取的正文当作成功接收。
     *
     * <p>两家已实现的协议都是 JSON 数组；错误媒体类型不得触达 Service，也不能靠成功响应掩盖丢弃。</p>
     */
    @Test
    void nonJsonReceiptIsRejectedWithoutCallingService() throws Exception {
        MvcResult aliyun = mvc.perform(post("/system/sms/callback/aliyun")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .content(ALIYUN_RECEIPT))
                .andExpect(status().isUnsupportedMediaType())
                .andReturn();

        MvcResult tencent = mvc.perform(post("/system/sms/callback/tencent")
                        .contentType(MediaType.TEXT_XML).content(TENCENT_RECEIPT))
                .andExpect(status().isUnsupportedMediaType()).andReturn();
        assertThat(readBody(aliyun).get("code").asInt()).isEqualTo(1);
        assertThat(readBody(tencent).get("result").asInt()).isEqualTo(1);
        verifyNoInteractions(sendService);
    }

    /** 缺失或畸形媒体类型均不具备 JSON 协议依据，不能探测正文后误认成功。 */
    @Test
    void missingAndMalformedMediaTypesAreRejected() throws Exception {
        mvc.perform(post("/system/sms/callback/aliyun").content(ALIYUN_RECEIPT))
                .andExpect(status().isUnsupportedMediaType());
        mvc.perform(post("/system/sms/callback/tencent")
                        .header("Content-Type", "invalid").content(TENCENT_RECEIPT))
                .andExpect(status().isUnsupportedMediaType());
        verifyNoInteractions(sendService);
    }

    /** JSON 声明不能替代内容校验；空体、坏语法、空数组和必要标识缺失均在业务前拒绝。 */
    @Test
    void invalidJsonReceiptsReturnBadRequestBeforeService() throws Exception {
        for (String body : List.of("", " ", "not-json", "null", "[]", "{}", "[{}]",
                ALIYUN_RECEIPT + " trailing", "[{\"phone_number\":\"13800000001\",\"biz_id\":null}]")) {
            mvc.perform(post("/system/sms/callback/aliyun")
                            .contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(sendService);
    }

    /**
     * 供应商会重复投递同一条回执，入口必须每次都按成功处理并保留原文。
     *
     * <p>去重责任在业务层的流水号匹配，入口既不能因为重复而返回失败诱发无限重投，
     * 也不能在重复投递时丢掉原文。</p>
     */
    @Test
    void repeatedReceiptIsAlwaysAcceptedWithIdenticalText() throws Exception {
        for (int delivery = 0; delivery < 3; delivery++) {
            MvcResult result = mvc.perform(post("/system/sms/callback/aliyun")
                            .contentType(MediaType.APPLICATION_JSON).content(ALIYUN_RECEIPT))
                    .andExpect(status().isOk())
                    .andReturn();
            assertThat(readBody(result).get("code").asInt()).isZero();
        }

        verify(sendService, times(3))
                .receiveSmsStatus(eq(SmsChannelEnum.ALIYUN.getCode()), eq(ALIYUN_RECEIPT));
    }

    /** 创建渠道成功时返回业务层生成的编号，参数必须原样透传。 */
    @Test
    void createChannelReturnsGeneratedIdentifier() throws Exception {
        when(channelService.createSmsChannel(any())).thenReturn(1024L);

        MvcResult result = mvc.perform(post("/system/sms-channel/create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validChannelJson()))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode body = readBody(result);
        assertThat(body.get("code").asInt()).isZero();
        assertThat(body.get("data").asLong()).isEqualTo(1024L);
        verify(channelService).createSmsChannel(argThatSignature("测试签名"));
    }

    /** 缺少必填字段时必须在进入业务层之前被参数校验拦下。 */
    @Test
    void invalidChannelRequestIsRejectedBeforeService() throws Exception {
        mvc.perform(post("/system/sms-channel/create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"ALIYUN\"}"))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(channelService);
    }

    /** 渠道签名超长属于校验失败，而不是把超长内容写库后再报错。 */
    @Test
    void oversizedChannelSignatureIsRejected() throws Exception {
        String oversized = "{\"signature\":\"" + "长".repeat(20) + "\",\"code\":\"ALIYUN\","
                + "\"status\":1,\"apiKey\":\"k\",\"apiSecret\":\"s\"}";

        mvc.perform(post("/system/sms-channel/create")
                        .contentType(MediaType.APPLICATION_JSON).content(oversized))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(channelService);
    }

    /** 权限被拒时必须在业务调用之前中断，不能只靠前端隐藏按钮。 */
    @Test
    void deniedPermissionStopsChannelCreate() {
        permissionGate.deny("system:sms-channel:create");

        assertThatThrownBy(() -> mvc.perform(post("/system/sms-channel/create")
                        .contentType(MediaType.APPLICATION_JSON).content(validChannelJson())))
                .hasRootCauseInstanceOf(AuthorizationDeniedException.class);

        verify(channelService, never()).createSmsChannel(any());
    }

    /**
     * 每个端点声明的权限串必须与前端菜单一致。
     *
     * <p>权限串写错不会报错，只会让已授权用户被拒或越权用户被放行，因此逐个端点锁定。</p>
     */
    @Test
    void channelEndpointsDeclareExpectedPermissions() {
        assertPermission("system:sms-channel:create",
                () -> mvc.perform(post("/system/sms-channel/create").contentType(MediaType.APPLICATION_JSON)
                        .content(validChannelJson())));
        assertPermission("system:sms-channel:update",
                () -> mvc.perform(put("/system/sms-channel/update").contentType(MediaType.APPLICATION_JSON)
                        .content(validChannelJson())));
        assertPermission("system:sms-channel:delete",
                () -> mvc.perform(delete("/system/sms-channel/delete").param("id", "1")));
        assertPermission("system:sms-channel:delete",
                () -> mvc.perform(delete("/system/sms-channel/delete-list").param("ids", "1", "2")));
        assertPermission("system:sms-channel:query",
                () -> mvc.perform(get("/system/sms-channel/get").param("id", "1")));
        assertPermission("system:sms-channel:query",
                () -> mvc.perform(get("/system/sms-channel/page").param("pageNo", "1").param("pageSize", "10")));
    }

    /** 精简列表按编号升序返回，前端下拉框的展示顺序不能依赖数据库返回顺序。 */
    @Test
    void simpleChannelListIsSortedById() throws Exception {
        when(channelService.getSmsChannelList()).thenReturn(new ArrayList<>(Arrays.asList(
                channel(30L, "第三个"), channel(10L, "第一个"), channel(20L, "第二个"))));

        MvcResult result = mvc.perform(get("/system/sms-channel/list-all-simple"))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode data = readBody(result).get("data");
        assertThat(data).hasSize(3);
        assertThat(data.get(0).get("id").asLong()).isEqualTo(10L);
        assertThat(data.get(1).get("id").asLong()).isEqualTo(20L);
        assertThat(data.get(2).get("id").asLong()).isEqualTo(30L);
    }

    /** 渠道不存在时返回空数据而不是把内部异常抛给前端。 */
    @Test
    void missingChannelReturnsNullDataInsteadOfFailing() throws Exception {
        when(channelService.getSmsChannel(any(Long.class))).thenReturn(null);

        MvcResult result = mvc.perform(get("/system/sms-channel/get").param("id", "404"))
                .andExpect(status().isOk())
                .andReturn();

        assertThat(readBody(result).get("code").asInt()).isZero();
        assertThat(readBody(result).get("data").isNull()).isTrue();
    }

    /** 批量删除必须把所有编号一次性透传，避免只删掉第一个。 */
    @Test
    void deleteListForwardsEveryIdentifier() throws Exception {
        mvc.perform(delete("/system/sms-channel/delete-list").param("ids", "7", "8", "9"))
                .andExpect(status().isOk());

        verify(channelService).deleteSmsChannelList(argThatIds(7L, 8L, 9L));
    }

    /** 手工发送短信成功时返回日志编号，手机号与模板编码必须原样到达发送通道。 */
    @Test
    void manualSendReturnsLogIdentifier() throws Exception {
        when(sendService.sendSingleSmsToAdmin(anyString(), any(), anyString(), any())).thenReturn(55L);

        MvcResult result = mvc.perform(post("/system/sms-template/send-sms")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"13800000001\",\"templateCode\":\"sms_login\","
                                + "\"templateParams\":{\"code\":\"123456\"}}"))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode body = readBody(result);
        assertThat(body.get("code").asInt()).isZero();
        assertThat(body.get("data").asLong()).isEqualTo(55L);
        verify(sendService).sendSingleSmsToAdmin(eq("13800000001"), isNull(), eq("sms_login"),
                eq(Map.of("code", "123456")));
    }

    /** 非法手机号必须在进入业务层之前被拦下，否则会真的向一个无效号码下单。 */
    @Test
    void invalidMobileIsRejectedBeforeSending() throws Exception {
        mvc.perform(post("/system/sms-template/send-sms")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"12345\",\"templateCode\":\"sms_login\"}"))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(sendService);
    }

    /** 权限被拒时不得真的发出短信。 */
    @Test
    void deniedSendPermissionPreventsManualSend() {
        permissionGate.deny("system:sms-template:send-sms");

        assertThatThrownBy(() -> mvc.perform(post("/system/sms-template/send-sms")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"13800000001\",\"templateCode\":\"sms_login\"}")))
                .hasRootCauseInstanceOf(AuthorizationDeniedException.class);

        verify(sendService, never()).sendSingleSmsToAdmin(anyString(), any(), anyString(), any());
    }

    /** 模板端点的权限串同样逐个锁定，包含导出与手工发送这两个独立权限。 */
    @Test
    void templateEndpointsDeclareExpectedPermissions() {
        assertPermission("system:sms-template:query",
                () -> mvc.perform(get("/system/sms-template/get").param("id", "1")));
        assertPermission("system:sms-template:query",
                () -> mvc.perform(get("/system/sms-template/page").param("pageNo", "1").param("pageSize", "10")));
        assertPermission("system:sms-template:delete",
                () -> mvc.perform(delete("/system/sms-template/delete").param("id", "1")));
        assertPermission("system:sms-template:export",
                () -> mvc.perform(get("/system/sms-template/export-excel")));
        assertPermission("system:sms-template:send-sms",
                () -> mvc.perform(post("/system/sms-template/send-sms").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"13800000001\",\"templateCode\":\"sms_login\"}")));
    }

    /** 更新渠道固定返回成功，业务失败由全局异常处理转成业务错误码。 */
    @Test
    void updateChannelReturnsSuccess() throws Exception {
        mvc.perform(put("/system/sms-channel/update")
                        .contentType(MediaType.APPLICATION_JSON).content(validChannelJson()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data").value(true));

        verify(channelService).updateSmsChannel(argThatSignature("测试签名"));
    }

    /** 删除渠道必须把编号原样透传给业务层。 */
    @Test
    void deleteChannelForwardsIdentifier() throws Exception {
        mvc.perform(delete("/system/sms-channel/delete").param("id", "17"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").value(true));

        verify(channelService).deleteSmsChannel(17L);
    }

    /** 渠道分页必须把页码与筛选条件交给业务层，并原样返回分页结构。 */
    @Test
    void channelPageReturnsPagedData() throws Exception {
        when(channelService.getSmsChannelPage(any())).thenReturn(new PageResult<>(List.of(channel(1L, "甲")), 1L));

        mvc.perform(get("/system/sms-channel/page")
                        .param("pageNo", "1").param("pageSize", "10").param("code", "ALIYUN"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.list[0].id").value(1));

        verify(channelService).getSmsChannelPage(
                argThat(page -> "ALIYUN".equals(page.getCode()) && page.getPageNo() == 1));
    }

    /** 创建模板成功时返回业务层生成的编号。 */
    @Test
    void createTemplateReturnsGeneratedIdentifier() throws Exception {
        when(templateService.createSmsTemplate(any())).thenReturn(88L);

        mvc.perform(post("/system/sms-template/create")
                        .contentType(MediaType.APPLICATION_JSON).content(validTemplateJson()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").value(88L));

        verify(templateService).createSmsTemplate(argThat(request -> "sms_login".equals(request.getCode())));
    }

    /** 模板缺少必填字段时不得进入业务层。 */
    @Test
    void invalidTemplateRequestIsRejectedBeforeService() throws Exception {
        mvc.perform(post("/system/sms-template/create")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"code\":\"sms_login\"}"))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(templateService);
    }

    /** 更新模板固定返回成功。 */
    @Test
    void updateTemplateReturnsSuccess() throws Exception {
        mvc.perform(put("/system/sms-template/update")
                        .contentType(MediaType.APPLICATION_JSON).content(validTemplateJson()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").value(true));

        verify(templateService).updateSmsTemplate(argThat(request -> "sms_login".equals(request.getCode())));
    }

    /** 删除与批量删除必须把所有编号一次性透传。 */
    @Test
    void templateDeleteForwardsEveryIdentifier() throws Exception {
        mvc.perform(delete("/system/sms-template/delete").param("id", "5"))
                .andExpect(status().isOk());
        verify(templateService).deleteSmsTemplate(5L);

        mvc.perform(delete("/system/sms-template/delete-list").param("ids", "6", "7"))
                .andExpect(status().isOk());
        verify(templateService).deleteSmsTemplateList(argThatIds(6L, 7L));
    }

    /** 查询单个模板必须返回业务层数据，渠道编码等冗余字段一并透出。 */
    @Test
    void getTemplateReturnsChannelCode() throws Exception {
        when(templateService.getSmsTemplate(any(Long.class))).thenReturn(template(3L));

        mvc.perform(get("/system/sms-template/get").param("id", "3"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(3))
                .andExpect(jsonPath("$.data.channelCode").value("ALIYUN"));

        verify(templateService).getSmsTemplate(3L);
    }

    /** 模板分页必须把筛选条件交给业务层并原样返回分页结构。 */
    @Test
    void templatePageReturnsPagedData() throws Exception {
        when(templateService.getSmsTemplatePage(any()))
                .thenReturn(new PageResult<>(List.of(template(1L)), 12L));

        mvc.perform(get("/system/sms-template/page")
                        .param("pageNo", "2").param("pageSize", "5").param("status", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(12))
                .andExpect(jsonPath("$.data.list[0].code").value("sms_login"));

        verify(templateService).getSmsTemplatePage(
                argThat(page -> page.getPageNo() == 2 && Integer.valueOf(1).equals(page.getStatus())));
    }

    /**
     * 导出必须无视调用方的分页参数，改为一次性取上限条数并在超限时整体拒绝。
     *
     * <p>分页参数本身有 {@code @Max} 校验，因此这里用一个合法的小页号来证明覆盖确实发生；
     * 分批导出会得到与总数不一致的半份快照，所以超限时必须整体报错而不是截断。</p>
     */
    @Test
    void exportForcesCappedPageSizeAndRejectsOversizedResult() {
        when(templateService.getSmsTemplatePage(any()))
                .thenReturn(new PageResult<>(List.of(template(1L)), 10_001L));

        assertThatThrownBy(() -> mvc.perform(get("/system/sms-template/export-excel")
                        .param("pageNo", "9").param("pageSize", "100")))
                .hasRootCauseInstanceOf(ServiceException.class);

        verify(templateService).getSmsTemplatePage(argThat(page -> page.getPageNo() == 1
                && page.getPageSize() == MAX_EXPORT_SIZE));
    }

    /**
     * 断言某个端点确实声明了指定权限。
     *
     * <p>用拒绝该权限来驱动：被拒会在进入方法体前抛出，从而既验证了权限串文本，
     * 也不会真的执行导出或发送这类有副作用的分支。</p>
     */
    private void assertPermission(String expected, RequestCall call) {
        permissionGate.reset();
        permissionGate.deny(expected);

        assertThatThrownBy(call::invoke).hasRootCauseInstanceOf(AuthorizationDeniedException.class);
        assertThat(permissionGate.requested)
                .as("端点实际校验的权限必须与声明一致").containsExactly(expected);
    }

    /** 构造一个只执行请求的可调用对象。 */
    private interface RequestCall {

        /**
         * 构造并执行该请求。
         *
         * @throws Exception 请求执行异常
         */
        ResultActions invoke() throws Exception;
    }

    /** 断言收到的是指定签名的渠道请求。 */
    private SmsChannelSaveReqVO argThatSignature(String signature) {
        return org.mockito.ArgumentMatchers.argThat(request -> signature.equals(request.getSignature()));
    }

    /** 断言收到的删除编号与预期完全一致。 */
    private List<Long> argThatIds(Long... ids) {
        List<Long> expected = Arrays.asList(ids);
        return org.mockito.ArgumentMatchers.argThat(actual -> actual != null && actual.equals(expected));
    }

    /** 构造一条渠道记录。 */
    private SmsChannelDO channel(Long id, String signature) {
        SmsChannelDO channel = new SmsChannelDO();
        channel.setId(id);
        channel.setSignature(signature);
        channel.setCode("ALIYUN");
        return channel;
    }

    /** 构造一条模板记录。 */
    private SmsTemplateDO template(Long id) {
        SmsTemplateDO template = new SmsTemplateDO();
        template.setId(id);
        template.setCode("sms_login");
        template.setName("登录验证码");
        template.setContent("验证码 {code}");
        template.setChannelId(1L);
        template.setChannelCode("ALIYUN");
        return template;
    }

    /** 通过校验的模板请求体。 */
    private String validTemplateJson() {
        return "{\"type\":1,\"status\":1,\"code\":\"sms_login\",\"name\":\"登录验证码\","
                + "\"content\":\"验证码 {code}\",\"apiTemplateId\":\"SMS_001\",\"channelId\":1}";
    }

    /** 通过校验的渠道请求体，签名长度必须落在 12 个字符内。 */
    private String validChannelJson() {
        return "{\"signature\":\"测试签名\",\"code\":\"ALIYUN\",\"status\":1,"
                + "\"apiKey\":\"k\",\"apiSecret\":\"s\"}";
    }

    /** 按 UTF-8 解析响应体，避免中文应答被按默认字符集读成乱码。 */
    private JsonNode readBody(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    /**
     * 真实 MVC、真实校验与真实方法级鉴权的最小装配。
     *
     * <p>不引入 Security 过滤链：回执入口的匿名可访问性由缺少鉴权即成功来证明，
     * 渠道与模板的拒绝由方法级 {@code @PreAuthorize} 决定，两者互不干扰。</p>
     */
    @Configuration(proxyBeanMethods = false)
    @EnableWebMvc
    @EnableMethodSecurity
    static class WebTestConfiguration {

        /** 使用真实 Bean Validation，非法请求才会被真正拦下。 */
        @Bean
        public Validator mvcValidator() {
            return new LocalValidatorFactoryBean();
        }

        /** {@code @ss} 表达式引用的权限判定替身。 */
        @Bean
        public PermissionGate ss() {
            return new PermissionGate();
        }

        /** 按 @Resource 的字段名注册，保留生产按名注入的装配方式。 */
        @Bean
        public SmsChannelService smsChannelService() {
            return channelService;
        }

        /** 模板 Controller 同时依赖模板与发送两个 Service。 */
        @Bean
        public SmsTemplateService smsTemplateService() {
            return templateService;
        }

        /** 回调与手工发送共用发送 Service。 */
        @Bean
        public SmsSendService smsSendService() {
            return sendService;
        }

        /** 注册三个被测 Controller，走生产按名注入装配。 */
        @Bean
        public SmsChannelController smsChannelController() {
            return new SmsChannelController();
        }

        /** 模板 Controller 同时依赖模板与发送两个 Service。 */
        @Bean
        public SmsTemplateController smsTemplateController() {
            return new SmsTemplateController();
        }

        /** 回调 Controller 依赖发送 Service。 */
        @Bean
        public SmsCallbackController smsCallbackController() {
            return new SmsCallbackController();
        }
    }

    /**
     * 可编程的权限判定替身。
     *
     * <p>保留生产 {@code @ss.hasPermission(String)} 的调用契约，只把“当前用户有哪些权限”
     * 换成测试可控的开关，并记录每次被请求的权限串用于逐端点断言。</p>
     */
    static class PermissionGate {

        /** 被显式拒绝的权限串；为空表示全部放行。 */
        private String denied;

        /** 按调用顺序记录被请求的权限串。 */
        private final List<String> requested = new ArrayList<>();

        /**
         * 判定当前请求是否具备该权限。
         *
         * @param permission 端点声明的权限串
         * @return 是否放行
         */
        public boolean hasPermission(String permission) {
            requested.add(permission);
            return !permission.equals(denied);
        }

        /** 拒绝指定权限。 */
        void deny(String permission) {
            this.denied = permission;
        }

        /** 复位开关与记录。 */
        void reset() {
            this.denied = null;
            this.requested.clear();
        }
    }
}
