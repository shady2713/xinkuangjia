package com.basicframework.framework.apilog.core.filter;

import com.basicframework.framework.apilog.core.annotation.ApiAccessLog;
import com.basicframework.framework.apilog.core.enums.OperateTypeEnum;
import com.basicframework.framework.common.biz.infra.logger.ApiAccessLogCommonApi;
import com.basicframework.framework.common.biz.infra.logger.dto.ApiAccessLogCreateReqDTO;
import com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.framework.common.util.monitor.TracerUtils;
import com.basicframework.framework.web.config.WebProperties;
import com.basicframework.framework.web.core.util.WebFrameworkUtils;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.method.HandlerMethod;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static com.basicframework.framework.apilog.core.interceptor.ApiAccessLogInterceptor.ATTRIBUTE_HANDLER_METHOD;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证 {@link ApiAccessLogFilter} 的记录开关、脱敏、结果归因与失败隔离契约。
 *
 * <p>访问日志是"请求已经结束之后才写"的旁路能力，因此它的边界比正常业务更严格：
 * 日志写入失败、请求 JSON 无法解析、字段脱敏都不得改变原请求的结果；同时日志内容必须真实
 * 反映身份、结果码与耗时，不能把异常请求记成成功。这里用真实的 Servlet 请求/响应替身、
 * 真实注解与真实 HandlerMethod 驱动过滤器，只在"跨模块日志写入接口"这一外部边界使用记录型替身
 * （真实实现在 module-infra，web starter 不能反向依赖）。</p>
 *
 * <p>脱敏用例覆盖默认敏感字段、注解追加字段、嵌套对象与数组；解析失败用例断言降级为占位内容，
 * 不把原始请求体写进日志。响应体脱敏失败分支通过框架自身的 {@code JsonUtils.init} 注入点
 * 换成会拒绝解析的 ObjectMapper，并在 finally 中还原。</p>
 *
 * @author shady2713
 */
class ApiAccessLogFilterTest {

    /** 应用名，用于确认日志写入的是配置值而不是请求头。 */
    private static final String APPLICATION_NAME = "basic-framework-probe";
    /** 成功请求的结果码，与框架通用响应约定一致。 */
    private static final int SUCCESS_CODE = GlobalErrorCodeConstants.SUCCESS.getCode();

    private WebProperties webProperties;
    private RecordingAccessLogApi accessLogApi;
    private ApiAccessLogFilter filter;
    private MockHttpServletRequest request;
    private MockHttpServletResponse response;

    /** 为每例准备独立的配置、记录替身与过滤器，避免用例之间共享日志内容。 */
    @BeforeEach
    void setUp() {
        webProperties = new WebProperties();
        // WebFrameworkUtils 的路径前缀约定由静态配置提供，缺失时读取登录平台会失败。
        new WebFrameworkUtils(webProperties);
        accessLogApi = new RecordingAccessLogApi();
        filter = new ApiAccessLogFilter(webProperties, APPLICATION_NAME, accessLogApi);
        request = new MockHttpServletRequest("POST", "/admin-api/system/user/create");
        response = new MockHttpServletResponse();
    }

    /** 每例结束后清空记录替身的失败注入，避免影响后续用例。 */
    @AfterEach
    void tearDown() {
        accessLogApi.failOnWrite = false;
    }

    /** 成功请求必须记录身份、结果码、请求参数与操作信息，且耗时非负。 */
    @Test
    void successfulRequestIsRecordedWithIdentityAndOperateInfo() throws Exception {
        request.addParameter("pageNo", "1");
        request.addParameter("keyword", "alpha");
        request.setContentType("application/json");
        request.setContent("{\"name\":\"alpha\"}".getBytes(StandardCharsets.UTF_8));
        request.addHeader("User-Agent", "probe-agent/1.0");
        // 客户端地址按容器给出的 remoteAddr 记录，转发头不被信任。
        request.setRemoteAddr("203.0.113.9");
        WebFrameworkUtils.setLoginUserId(request, 1001L);
        WebFrameworkUtils.setLoginUserType(request, 2);
        WebFrameworkUtils.setCommonResult(request, CommonResult.success("created"));
        HandlerMethod handlerMethod = handlerMethod(AnnotatedProbeController.class, "create");
        String traceId = TracerUtils.getTraceId();

        filter.doFilter(request, response, chainSettingHandler(handlerMethod));

        ApiAccessLogCreateReqDTO log = singleRecord();
        assertThat(log.getUserId()).isEqualTo(1001L);
        assertThat(log.getUserType()).isEqualTo(2);
        assertThat(log.getResultCode()).isEqualTo(SUCCESS_CODE);
        assertThat(log.getResultMsg()).isEmpty();
        assertThat(log.getTraceId()).isEqualTo(traceId);
        assertThat(log.getApplicationName()).isEqualTo(APPLICATION_NAME);
        assertThat(log.getRequestUrl()).isEqualTo("/admin-api/system/user/create");
        assertThat(log.getRequestMethod()).isEqualTo("POST");
        assertThat(log.getUserAgent()).isEqualTo("probe-agent/1.0");
        assertThat(log.getUserIp()).isEqualTo("203.0.113.9");
        // 真实格式：query 与 body 各自先序列化为 JSON 字符串，再整体序列化一次（双重编码）。
        assertThat(log.getRequestParams()).contains("\"query\":\"{").contains("\"body\":\"{");
        assertThat(log.getRequestParams()).contains("pageNo").contains("keyword").contains("name");
        assertThat(log.getResponseBody()).as("未开启响应记录时不得写入响应体").isNull();
        assertThat(log.getOperateModule()).isEqualTo("探针模块");
        assertThat(log.getOperateName()).isEqualTo("创建用户");
        assertThat(log.getOperateType()).isEqualTo(OperateTypeEnum.CREATE.getType());
        assertThat(log.getBeginTime()).isNotNull();
        assertThat(log.getEndTime()).isNotNull();
        assertThat(log.getDuration()).isGreaterThanOrEqualTo(0);
    }

    /** 请求处理抛错时必须按失败结果码记录并把异常原样抛回请求链。 */
    @Test
    void failedRequestIsRecordedAndExceptionIsRethrown() throws Exception {
        HandlerMethod handlerMethod = handlerMethod(AnnotatedProbeController.class, "create");

        assertThatThrownBy(() -> filter.doFilter(request, response,
                chainSettingHandlerThenFailing(handlerMethod, new IllegalStateException("controlled chain failure"))))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("controlled chain failure");

        ApiAccessLogCreateReqDTO log = singleRecord();
        assertThat(log.getResultCode()).isEqualTo(GlobalErrorCodeConstants.INTERNAL_SERVER_ERROR.getCode());
        assertThat(log.getResultMsg()).contains("controlled chain failure");
        assertThat(log.getOperateType()).isEqualTo(OperateTypeEnum.CREATE.getType());
    }

    /** 注解关闭记录时必须完全跳过写入，但请求本身仍必须继续执行。 */
    @Test
    void disabledAnnotationSkipsLogWithoutBreakingRequest() throws Exception {
        HandlerMethod handlerMethod = handlerMethod(AnnotatedProbeController.class, "disabled");
        FilterChain chain = chainSettingHandler(handlerMethod);

        filter.doFilter(request, response, chain);

        assertThat(accessLogApi.records).isEmpty();
        assertThat(request.getAttribute(ATTRIBUTE_HANDLER_METHOD)).isSameAs(handlerMethod);
    }

    /** 关闭请求参数记录时不得写入查询参数与请求体。 */
    @Test
    void requestParamsAreOmittedWhenRequestRecordingDisabled() throws Exception {
        request.addParameter("keyword", "alpha");
        request.setContentType("application/json");
        request.setContent("{\"name\":\"alpha\"}".getBytes(StandardCharsets.UTF_8));

        filter.doFilter(request, response,
                chainSettingHandler(handlerMethod(AnnotatedProbeController.class, "withoutRequest")));

        assertThat(singleRecord().getRequestParams()).isNull();
    }

    /** 非 JSON 请求没有请求体，查询参数仍必须记录。 */
    @Test
    void nonJsonRequestRecordsQueryOnly() throws Exception {
        request.addParameter("keyword", "alpha");
        request.setContentType("text/plain");
        request.setContent("plain text".getBytes(StandardCharsets.UTF_8));

        filter.doFilter(request, response,
                chainSettingHandler(handlerMethod(AnnotatedProbeController.class, "create")));

        String params = singleRecord().getRequestParams();
        assertThat(params).contains("keyword").doesNotContain("plain text");
    }

    /** 没有查询参数时不得写入空的 query 片段，也不得伪造空请求体。 */
    @Test
    void absentQueryAndBodyAreNotRecorded() throws Exception {
        filter.doFilter(request, response,
                chainSettingHandler(handlerMethod(AnnotatedProbeController.class, "create")));

        String params = singleRecord().getRequestParams();
        assertThat(params).doesNotContain("query").doesNotContain("body");
    }

    /** 默认敏感字段与注解追加字段必须从查询参数与请求体中移除，非敏感字段保留。 */
    @Test
    void sensitiveFieldsAreRemovedFromQueryAndBody() throws Exception {
        request.addParameter("password", "DUMMY-QUERY-SECRET");
        request.addParameter("customField", "DUMMY-CUSTOM-SECRET");
        request.addParameter("keyword", "alpha");
        request.setContentType("application/json");
        request.setContent(("{\"name\":\"alpha\",\"password\":\"DUMMY-BODY-SECRET\","
                + "\"accessToken\":\"DUMMY-TOKEN-SECRET\",\"customField\":\"DUMMY-CUSTOM-BODY-SECRET\"}")
                .getBytes(StandardCharsets.UTF_8));

        filter.doFilter(request, response,
                chainSettingHandler(handlerMethod(AnnotatedProbeController.class, "sanitized")));

        String params = singleRecord().getRequestParams();
        assertThat(params).contains("keyword").contains("name");
        assertThat(params).doesNotContain("password").doesNotContain("DUMMY-QUERY-SECRET")
                .doesNotContain("DUMMY-BODY-SECRET").doesNotContain("accessToken")
                .doesNotContain("DUMMY-TOKEN-SECRET").doesNotContain("customField")
                .doesNotContain("DUMMY-CUSTOM-SECRET").doesNotContain("DUMMY-CUSTOM-BODY-SECRET");
    }

    /** 嵌套对象与数组中的敏感字段同样必须移除，数组元素不得整段保留。 */
    @Test
    void nestedObjectsAndArraysAreSanitized() throws Exception {
        request.setContentType("application/json");
        request.setContent(("{\"profile\":{\"password\":\"DUMMY-NESTED-SECRET\",\"nickname\":\"alpha\"},"
                + "\"accounts\":[{\"token\":\"DUMMY-ARRAY-SECRET\",\"label\":\"primary\"}]}")
                .getBytes(StandardCharsets.UTF_8));

        filter.doFilter(request, response,
                chainSettingHandler(handlerMethod(AnnotatedProbeController.class, "sanitized")));

        String params = singleRecord().getRequestParams();
        assertThat(params).contains("nickname").contains("label");
        assertThat(params).doesNotContain("password").doesNotContain("DUMMY-NESTED-SECRET")
                .doesNotContain("token").doesNotContain("DUMMY-ARRAY-SECRET");
    }

    /** 请求体无法解析时必须降级为安全占位内容，不把原始文本写入日志。 */
    @Test
    void unparsableRequestBodyFallsBackToPlaceholder() throws Exception {
        request.setContentType("application/json");
        request.setContent("{not-valid-json".getBytes(StandardCharsets.UTF_8));

        filter.doFilter(request, response,
                chainSettingHandler(handlerMethod(AnnotatedProbeController.class, "create")));

        String params = singleRecord().getRequestParams();
        assertThat(params).contains("_sanitized");
        assertThat(params).doesNotContain("not-valid-json");
    }

    /** 开启响应记录时只记录响应 data，并按默认与追加敏感字段脱敏。 */
    @Test
    void responseBodyIsRecordedAndSanitizedWhenEnabled() throws Exception {
        request.setContentType("application/json");
        request.setContent("{}".getBytes(StandardCharsets.UTF_8));
        WebFrameworkUtils.setCommonResult(request, CommonResult.success(
                java.util.Map.of("nickname", "alpha", "password", "DUMMY-RESPONSE-SECRET")));

        filter.doFilter(request, response,
                chainSettingHandler(handlerMethod(AnnotatedProbeController.class, "withResponse")));

        String body = singleRecord().getResponseBody();
        // 真实格式：记录的是整个通用响应外壳，敏感字段在 data 内部被移除。
        assertThat(body).contains("\"code\"").contains("\"data\"").contains("nickname").contains("alpha");
        assertThat(body).doesNotContain("password").doesNotContain("DUMMY-RESPONSE-SECRET");
    }

    /** 响应存在但没有 data 内容时必须安全跳过脱敏，只记录响应外壳且不抛错。 */
    @Test
    void responseWithoutDataIsSkippedSafely() throws Exception {
        WebFrameworkUtils.setCommonResult(request, CommonResult.success(null));

        filter.doFilter(request, response,
                chainSettingHandler(handlerMethod(AnnotatedProbeController.class, "withResponse")));

        assertThat(singleRecord().getResponseBody()).as("没有 data 时只记录响应外壳")
                .contains("\"code\"").doesNotContain("data");
    }

    /** 响应为空时不得写入响应体，也不得因此抛错。 */
    @Test
    void absentResponseBodyIsNotRecorded() throws Exception {
        filter.doFilter(request, response,
                chainSettingHandler(handlerMethod(AnnotatedProbeController.class, "withResponse")));

        assertThat(singleRecord().getResponseBody()).isNull();
    }

    /** 注解指定的操作模块、操作名与操作类型必须优先于注解元数据推导结果。 */
    @Test
    void explicitOperateInfoOverridesDerivedValues() throws Exception {
        filter.doFilter(request, response,
                chainSettingHandler(handlerMethod(AnnotatedProbeController.class, "explicitOperate")));

        ApiAccessLogCreateReqDTO log = singleRecord();
        assertThat(log.getOperateModule()).isEqualTo("自定义模块");
        assertThat(log.getOperateName()).isEqualTo("自定义操作");
        assertThat(log.getOperateType()).as("注解数组必须取第一个值").isEqualTo(OperateTypeEnum.EXPORT.getType());
    }

    /**
     * 注解未指定模块与名称时必须回退到 Swagger 注解。
     *
     * <p>{@code @Tag#name} 是必填元素（无默认值，也不可能为 null），因此真实取值只可能是
     * 显式填写的字符串：名称为空串时原样记录空模块，描述回退分支在真实注解上不可达。</p>
     */
    @Test
    void operateInfoFallsBackToSwaggerAnnotations() throws Exception {
        filter.doFilter(request, response,
                chainSettingHandler(handlerMethod(DescribedProbeController.class, "create")));

        ApiAccessLogCreateReqDTO log = singleRecord();
        assertThat(log.getOperateModule()).as("Tag 名称为空时原样记录空模块").isEmpty();
        assertThat(log.getOperateName()).as("缺少 Operation 时操作名为空").isNull();
    }

    /** 既没有访问日志注解也没有 Swagger 注解时不得伪造模块与操作名。 */
    @Test
    void operateInfoIsEmptyWithoutAnnotations() throws Exception {
        filter.doFilter(request, response,
                chainSettingHandler(handlerMethod(PlainProbeController.class, "create")));

        ApiAccessLogCreateReqDTO log = singleRecord();
        assertThat(log.getOperateModule()).isNull();
        assertThat(log.getOperateName()).isNull();
        assertThat(log.getOperateType()).isEqualTo(OperateTypeEnum.CREATE.getType());
    }

    /** 没有访问日志注解时必须按 HTTP 方法推导操作类型。 */
    @Test
    void operateTypeIsDerivedFromHttpMethod() throws Exception {
        assertOperateTypeForMethod("GET", OperateTypeEnum.GET.getType());
        assertOperateTypeForMethod("POST", OperateTypeEnum.CREATE.getType());
        assertOperateTypeForMethod("PUT", OperateTypeEnum.UPDATE.getType());
        assertOperateTypeForMethod("DELETE", OperateTypeEnum.DELETE.getType());
        assertOperateTypeForMethod("PATCH", OperateTypeEnum.OTHER.getType());
        assertOperateTypeForMethod("CUSTOM", OperateTypeEnum.OTHER.getType());
    }

    /** 没有处理器方法（静态资源等）时仍必须记录日志，且不写入操作信息。 */
    @Test
    void requestWithoutHandlerMethodIsStillRecorded() throws Exception {
        request.setMethod("GET");
        WebFrameworkUtils.setCommonResult(request, CommonResult.success(null));

        filter.doFilter(request, response, (servletRequest, servletResponse) -> {
        });

        ApiAccessLogCreateReqDTO log = singleRecord();
        assertThat(log.getOperateModule()).isNull();
        assertThat(log.getOperateName()).isNull();
        assertThat(log.getOperateType()).isNull();
        assertThat(log.getResultCode()).isEqualTo(SUCCESS_CODE);
    }

    /** 登录身份缺失时必须记录空身份，而不是伪造管理员身份。 */
    @Test
    void missingLoginIdentityIsRecordedAsNull() throws Exception {
        request.setServletPath("/admin-api/system/user/create");

        filter.doFilter(request, response,
                chainSettingHandler(handlerMethod(AnnotatedProbeController.class, "create")));

        ApiAccessLogCreateReqDTO log = singleRecord();
        assertThat(log.getUserId()).isNull();
        assertThat(log.getUserType()).as("按 URL 前缀约定识别为管理端").isEqualTo(2);
    }

    /** 日志写入失败不得影响原请求结果，也不能把异常抛回请求链。 */
    @Test
    void writeFailureDoesNotBreakRequest() throws Exception {
        accessLogApi.failOnWrite = true;
        HandlerMethod handlerMethod = handlerMethod(AnnotatedProbeController.class, "create");

        assertThatCode(() -> filter.doFilter(request, response, chainSettingHandler(handlerMethod)))
                .doesNotThrowAnyException();

        assertThat(request.getAttribute(ATTRIBUTE_HANDLER_METHOD)).isSameAs(handlerMethod);
        assertThat(accessLogApi.records).isEmpty();
    }

    /**
     * 响应体脱敏失败时必须降级为占位内容。
     *
     * <p>响应 JSON 由服务端序列化产生，正常路径不会解析失败；这里通过框架自身的
     * {@code JsonUtils.init} 注入点换成拒绝解析的 ObjectMapper 制造真实失败，并在 finally 中还原，
     * 以验证"解析失败返回安全占位内容"的既定降级契约，同时确认原始响应内容没有进入日志。</p>
     */
    @Test
    void responseSanitizeFailureFallsBackToPlaceholder() throws Exception {
        ObjectMapper previous = (ObjectMapper) ReflectionTestUtils.getField(JsonUtils.class, "objectMapper");
        JsonUtils.init(new TreeRejectingObjectMapper());
        try {
            WebFrameworkUtils.setCommonResult(request, CommonResult.success(
                    java.util.Map.of("nickname", "alpha", "password", "DUMMY-RESPONSE-SECRET")));

            filter.doFilter(request, response,
                    chainSettingHandler(handlerMethod(AnnotatedProbeController.class, "withResponse")));

            String body = singleRecord().getResponseBody();
            assertThat(body).isEqualTo("{\"_sanitized\":true}");
            assertThat(body).doesNotContain("alpha").doesNotContain("DUMMY-RESPONSE-SECRET");
        } finally {
            JsonUtils.init(previous);
        }
    }

    /** 非 API 请求必须跳过过滤器，不得为静态资源等路径写访问日志。 */
    @Test
    void nonApiRequestIsSkipped() throws Exception {
        MockHttpServletRequest staticRequest = new MockHttpServletRequest("GET", "/static/index.html");

        filter.doFilter(staticRequest, response, (servletRequest, servletResponse) -> {
        });

        assertThat(accessLogApi.records).isEmpty();
    }

    /** 记录型替身：保存过滤器交给日志接口的 DTO，并可注入写入失败。 */
    private static class RecordingAccessLogApi implements ApiAccessLogCommonApi {

        /** 按调用顺序保存的访问日志请求。 */
        private final List<ApiAccessLogCreateReqDTO> records = new ArrayList<>();
        /** 是否让写入抛错，用于验证日志失败不影响请求。 */
        private boolean failOnWrite;

        /**
         * 记录一次访问日志写入。
         *
         * @param createDTO 访问日志请求，由过滤器构造
         * @throws IllegalStateException 注入失败时抛出，模拟跨模块写入失败
         */
        @Override
        public void createApiAccessLog(ApiAccessLogCreateReqDTO createDTO) {
            if (failOnWrite) {
                throw new IllegalStateException("controlled access log write failure");
            }
            records.add(createDTO);
        }

    }

    /** 拒绝解析 JSON 树的 ObjectMapper，用于制造响应脱敏的真实解析失败。 */
    private static class TreeRejectingObjectMapper extends ObjectMapper {

        /**
         * 拒绝把 JSON 文本解析为树。
         *
         * @param content 待解析文本
         * @return 不会返回，始终抛错
         * @throws JsonProcessingException 始终抛出，模拟解析器不可用
         */
        @Override
        public JsonNode readTree(String content) throws JsonProcessingException {
            throw new JsonProcessingException("controlled tree parse failure") {
            };
        }

    }

    /**
     * 断言指定 HTTP 方法在无注解时推导出的操作类型。
     *
     * @param method HTTP 方法名
     * @param expectedType 期望的操作类型编码
     */
    private void assertOperateTypeForMethod(String method, int expectedType) throws Exception {
        accessLogApi.records.clear();
        MockHttpServletRequest methodRequest = new MockHttpServletRequest(method, "/admin-api/system/user/list");
        FilterChain chain = (servletRequest, servletResponse) ->
                servletRequest.setAttribute(ATTRIBUTE_HANDLER_METHOD,
                        handlerMethod(PlainProbeController.class, "create"));

        filter.doFilter(methodRequest, response, chain);

        assertThat(accessLogApi.records).as("方法 %s 必须产生一条日志", method).hasSize(1);
        assertThat(accessLogApi.records.get(0).getOperateType())
                .as("方法 %s 的操作类型", method).isEqualTo(expectedType);
    }

    /** 构造设置处理器属性后正常返回的过滤链，模拟请求被成功处理。 */
    private static FilterChain chainSettingHandler(HandlerMethod handlerMethod) {
        return (servletRequest, servletResponse) ->
                servletRequest.setAttribute(ATTRIBUTE_HANDLER_METHOD, handlerMethod);
    }

    /** 构造设置处理器属性后抛出指定异常的过滤链，模拟请求处理失败。 */
    private static FilterChain chainSettingHandlerThenFailing(HandlerMethod handlerMethod, RuntimeException failure) {
        return (servletRequest, servletResponse) -> {
            servletRequest.setAttribute(ATTRIBUTE_HANDLER_METHOD, handlerMethod);
            throw failure;
        };
    }

    /**
     * 构造真实 HandlerMethod。
     *
     * @param type 控制器夹具类型
     * @param methodName 无参方法名
     * @return 处理器方法
     */
    private static HandlerMethod handlerMethod(Class<?> type, String methodName) {
        try {
            Object bean = type.getDeclaredConstructor().newInstance();
            return new HandlerMethod(bean, type.getMethod(methodName));
        } catch (ReflectiveOperationException failure) {
            throw new IllegalStateException("探针处理器方法构造失败", failure);
        }
    }

    /** 取出本用例记录的唯一访问日志，并在数量不符时给出明确失败。 */
    private ApiAccessLogCreateReqDTO singleRecord() {
        assertThat(accessLogApi.records).hasSize(1);
        return accessLogApi.records.get(0);
    }

    /**
     * 带完整 Swagger 与访问日志注解的控制器夹具，用于覆盖注解优先与回退分支。
     *
     * @author shady2713
     */
    @Tag(name = "探针模块")
    static class AnnotatedProbeController {

        /** 默认注解方法，用于验证标准记录内容。 */
        @ApiAccessLog
        @Operation(summary = "创建用户")
        public void create() {
        }

        /** 关闭记录的注解方法。 */
        @ApiAccessLog(enable = false)
        public void disabled() {
        }

        /** 关闭请求参数记录的注解方法。 */
        @ApiAccessLog(requestEnable = false)
        public void withoutRequest() {
        }

        /** 开启响应记录并追加自定义敏感字段的注解方法。 */
        @ApiAccessLog(responseEnable = true, sanitizeKeys = {"customField"})
        public void withResponse() {
        }

        /** 追加自定义敏感字段的注解方法。 */
        @ApiAccessLog(sanitizeKeys = {"customField"})
        public void sanitized() {
        }

        /** 显式指定模块、操作名与操作类型的注解方法。 */
        @ApiAccessLog(operateModule = "自定义模块", operateName = "自定义操作",
                operateType = {OperateTypeEnum.EXPORT, OperateTypeEnum.DELETE})
        public void explicitOperate() {
        }

    }

    /**
     * 只有标签描述的控制器夹具，用于验证模块名回退到描述且缺少操作名时保持为空。
     *
     * @author shady2713
     */
    @Tag(name = "", description = "探针模块描述")
    static class DescribedProbeController {

        /** 只有访问日志注解、没有 Operation 注解的方法。 */
        @ApiAccessLog
        public void create() {
        }

    }

    /**
     * 没有任何 Swagger 注解的控制器夹具，用于验证不伪造模块与操作名。
     *
     * @author shady2713
     */
    static class PlainProbeController {

        /** 没有任何注解的方法，操作类型只能按 HTTP 方法推导。 */
        public void create() {
        }

    }

}
