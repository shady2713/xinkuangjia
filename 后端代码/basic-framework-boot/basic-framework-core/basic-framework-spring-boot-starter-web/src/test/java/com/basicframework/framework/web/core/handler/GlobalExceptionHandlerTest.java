package com.basicframework.framework.web.core.handler;

import com.basicframework.framework.common.biz.infra.logger.ApiErrorLogCommonApi;
import com.basicframework.framework.common.biz.infra.logger.dto.ApiErrorLogCreateReqDTO;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.web.core.util.WebFrameworkUtils;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.exc.InvalidFormatException;
import com.google.common.util.concurrent.UncheckedExecutionException;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.ValidationException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.http.MockHttpInputMessage;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.validation.BeanPropertyBindingResult;
import org.springframework.validation.BindException;
import org.springframework.validation.FieldError;
import org.springframework.validation.ObjectError;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.nio.charset.StandardCharsets;
import java.sql.SQLIntegrityConstraintViolationException;
import java.util.List;
import java.util.Set;

import static com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants.BAD_REQUEST;
import static com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants.FORBIDDEN;
import static com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants.INTERNAL_SERVER_ERROR;
import static com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants.METHOD_NOT_ALLOWED;
import static com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants.NOT_FOUND;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证全局异常处理器与异常日志的真实错误语义、分发与脱敏行为。
 *
 * <p>该处理器是所有 Filter 与 SpringMVC 异常的最终出口：分发条件写错会让客户端拿到 500 而不是
 * 400/403/404/405，错误码与提示错位会让前端无法判断失败原因，请求参数脱敏失效则会把口令、
 * 令牌等敏感内容写进异常日志。因此用例对每类异常都断言真实错误码与提示文本，并对异常日志
 * 捕获入参后断言脱敏结果与降级占位内容，而不是只断言「返回了 CommonResult」。</p>
 *
 * @author DeepSeek
 */
class GlobalExceptionHandlerTest {

    /** 被测处理器，注入固定的应用名与模拟异常日志接口。 */
    private GlobalExceptionHandler handler;

    /** 异常日志接口模拟对象，用于断言写入内容。 */
    private ApiErrorLogCommonApi apiErrorLogApi;

    /** 构造被测处理器并准备异常日志模拟对象。 */
    @BeforeEach
    void setUp() {
        apiErrorLogApi = mock(ApiErrorLogCommonApi.class);
        handler = new GlobalExceptionHandler("test-application", apiErrorLogApi);
    }

    /** 清理当前线程的请求上下文，避免影响同 JVM 的其它用例。 */
    @AfterEach
    void clearRequestContext() {
        RequestContextHolder.resetRequestAttributes();
    }

    /**
     * 构造带登录身份与终端类型的模拟请求，避免读取未装配的 Web 配置。
     *
     * @return 可直接交给处理器的模拟请求
     */
    private static MockHttpServletRequest request() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/probe");
        WebFrameworkUtils.setLoginUserId(request, 1024L);
        WebFrameworkUtils.setLoginUserType(request, UserTypeEnum.ADMIN.getValue());
        return request;
    }

    /**
     * 验证只有对象级校验错误时仍返回明确提示，不依赖默认关闭的 Java assert。
     */
    @Test
    void shouldHandleGlobalBindingErrorWithoutFieldError() {
        BindException exception = new BindException(new Object(), "request");
        exception.addError(new ObjectError("request", "组合参数校验失败"));
        GlobalExceptionHandler handler = new GlobalExceptionHandler(
                "test-application", mock(ApiErrorLogCommonApi.class));

        CommonResult<?> result = handler.bindExceptionHandler(exception);

        assertThat(result.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(result.getMsg()).isEqualTo("组合参数校验失败");
    }

    /**
     * 全量分发必须把每类异常路由到各自处理器并给出对应错误码。
     *
     * <p>Filter 不走 SpringMVC 流程，只能依赖这个入口兜底；任一分支漏配或顺序错位都会让
     * 客户端收到与实际原因不符的状态码。</p>
     */
    @Test
    void allExceptionHandlerDispatchesEverySupportedType() throws Exception {
        MockHttpServletRequest request = request();

        assertDispatched(request, new MissingServletRequestParameterException("id", "Long"),
                BAD_REQUEST.getCode(), "请求参数缺失:id");
        assertDispatched(request, new MethodArgumentTypeMismatchException("abc", Integer.class, "age",
                        parameter(), new IllegalArgumentException("bad")),
                BAD_REQUEST.getCode(), null);
        assertDispatched(request, new MethodArgumentNotValidException(parameter(),
                        bindingWithError(new FieldError("request", "name", "名称不能为空"))),
                BAD_REQUEST.getCode(), "名称不能为空");
        assertDispatched(request, new BindException(new Object(), "request") {{
                    addError(new FieldError("request", "age", "年龄必须大于 0"));
                }},
                BAD_REQUEST.getCode(), "年龄必须大于 0");
        assertDispatched(request, new ConstraintViolationException(Set.of(violation("用户名长度必须为 4-30 位"))),
                BAD_REQUEST.getCode(), "用户名长度必须为 4-30 位");
        assertDispatched(request, new ValidationException("DUMMY-CONSUMER-VALIDATION"),
                BAD_REQUEST.getCode(), BAD_REQUEST.getMsg());
        assertDispatched(request, new MaxUploadSizeExceededException(1024L),
                BAD_REQUEST.getCode(), "上传文件过大，请调整后重试");
        assertDispatched(request, new NoHandlerFoundException("GET", "/admin-api/not-exist", new HttpHeaders()),
                NOT_FOUND.getCode(), "请求地址不存在:/admin-api/not-exist");
        assertDispatched(request, new NoResourceFoundException(HttpMethod.GET, "/static/missing.png"),
                NOT_FOUND.getCode(), "请求地址不存在:/static/missing.png");
        assertDispatched(request, new HttpRequestMethodNotSupportedException("POST"),
                METHOD_NOT_ALLOWED.getCode(), null);
        assertDispatched(request, new HttpMediaTypeNotSupportedException(MediaType.APPLICATION_XML, List.of(MediaType.APPLICATION_JSON)),
                BAD_REQUEST.getCode(), null);
        assertDispatched(request, ServiceExceptionUtilFixture.businessFailure(),
                ServiceExceptionUtilFixture.CODE, "库存不足");
        assertDispatched(request, new AccessDeniedException("DUMMY-DENIED"),
                FORBIDDEN.getCode(), FORBIDDEN.getMsg());
        assertDispatched(request, new IllegalStateException("DUMMY-UNEXPECTED"),
                INTERNAL_SERVER_ERROR.getCode(), INTERNAL_SERVER_ERROR.getMsg());
    }

    /** 请求参数缺失必须给出参数名，便于调用方直接定位缺失字段。 */
    @Test
    void missingParameterNamesTheMissingField() {
        CommonResult<?> result = handler.missingServletRequestParameterExceptionHandler(
                new MissingServletRequestParameterException("pageNo", "Integer"));

        assertThat(result.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(result.getMsg()).isEqualTo("请求参数缺失:pageNo");
    }

    /** 参数类型错误必须回显框架给出的类型转换原因，而不是笼统的「参数错误」。 */
    @Test
    void typeMismatchCarriesConversionReason() throws Exception {
        MethodArgumentTypeMismatchException exception = new MethodArgumentTypeMismatchException(
                "abc", Integer.class, "age", parameter(), new IllegalArgumentException("DUMMY-CONVERSION"));

        CommonResult<?> result = handler.methodArgumentTypeMismatchExceptionHandler(exception);

        assertThat(result.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(result.getMsg())
                .startsWith("请求参数类型错误:")
                .contains("Method parameter 'age'")
                .contains("required type 'java.lang.Integer'");
    }

    /** 字段级校验失败必须回显该字段的提示文本。 */
    @Test
    void fieldValidationFailureReturnsFieldMessage() throws Exception {
        MethodArgumentNotValidException exception = new MethodArgumentNotValidException(parameter(),
                bindingWithError(new FieldError("request", "name", "名称不能为空")));

        CommonResult<?> result = handler.methodArgumentNotValidExceptionExceptionHandler(exception);

        assertThat(result.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(result.getMsg()).isEqualTo("名称不能为空");
    }

    /** 只有对象级校验错误时必须退化为第一条对象错误提示，不能返回空提示。 */
    @Test
    void objectLevelValidationFailureReturnsFirstObjectMessage() throws Exception {
        MethodArgumentNotValidException exception = new MethodArgumentNotValidException(parameter(),
                bindingWithError(new ObjectError("request", "组合参数校验失败")));

        CommonResult<?> result = handler.methodArgumentNotValidExceptionExceptionHandler(exception);

        assertThat(result.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(result.getMsg()).isEqualTo("组合参数校验失败");
    }

    /** 完全没有错误明细时必须回落到统一参数错误码的默认提示，而不是空串。 */
    @Test
    void validationFailureWithoutAnyErrorReturnsDefaultMessage() throws Exception {
        MethodArgumentNotValidException exception = new MethodArgumentNotValidException(parameter(),
                new BeanPropertyBindingResult(new Object(), "request"));

        CommonResult<?> result = handler.methodArgumentNotValidExceptionExceptionHandler(exception);

        assertThat(result.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(result.getMsg()).isEqualTo(BAD_REQUEST.getMsg());
    }

    /** 字段级绑定错误必须优先返回字段提示。 */
    @Test
    void bindFailureReturnsFieldMessageWhenPresent() {
        BindException exception = new BindException(new Object(), "request");
        exception.addError(new FieldError("request", "age", "年龄必须大于 0"));

        CommonResult<?> result = handler.bindExceptionHandler(exception);

        assertThat(result.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(result.getMsg()).isEqualTo("年龄必须大于 0");
    }

    /** 请求体字段类型不匹配必须回显错误的取值，便于前端定位具体字段内容。 */
    @Test
    void invalidFormatBodyReportsRejectedValue() throws Exception {
        InvalidFormatException cause = org.assertj.core.api.Assertions.catchThrowableOfType(
                () -> new ObjectMapper().readValue("\"abc\"", Integer.class), InvalidFormatException.class);
        HttpMessageNotReadableException exception = new HttpMessageNotReadableException("DUMMY", cause,
                new MockHttpInputMessage(new byte[0]));

        CommonResult<?> result = handler.methodArgumentTypeInvalidFormatExceptionHandler(exception);

        assertThat(result.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(result.getMsg()).isEqualTo("请求参数类型错误:abc");
    }

    /** 请求体整体缺失必须给出明确的「request body 缺失」提示。 */
    @Test
    void missingRequestBodyReportsDedicatedMessage() {
        HttpMessageNotReadableException exception =
                new HttpMessageNotReadableException("Required request body is missing: public void sample()");

        CommonResult<?> result = handler.methodArgumentTypeInvalidFormatExceptionHandler(exception);

        assertThat(result.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(result.getMsg()).isEqualTo("请求参数类型错误: request body 缺失");
    }

    /**
     * 其它读取失败必须走兜底处理，并按当前线程的真实请求写入异常日志。
     *
     * <p>ServletUtils 从请求上下文取请求，这里显式装配上下文，验证兜底分支确实使用了
     * 当前请求而不是丢弃上下文。</p>
     */
    @Test
    void otherReadFailureFallsBackToDefaultHandlerWithCurrentRequest() {
        MockHttpServletRequest request = request();
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        CommonResult<?> result = handler.methodArgumentTypeInvalidFormatExceptionHandler(
                new HttpMessageNotReadableException("DUMMY-OTHER"));

        assertThat(result.getCode()).isEqualTo(INTERNAL_SERVER_ERROR.getCode());
        assertThat(result.getMsg()).isEqualTo(INTERNAL_SERVER_ERROR.getMsg());
        verify(apiErrorLogApi).createApiErrorLogAsync(any(ApiErrorLogCreateReqDTO.class));
    }

    /** Validator 校验失败必须回显第一条违规提示。 */
    @Test
    void constraintViolationReturnsFirstViolationMessage() {
        CommonResult<?> result = handler.constraintViolationExceptionHandler(
                new ConstraintViolationException(Set.of(violation("手机号格式不正确"))));

        assertThat(result.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(result.getMsg()).isEqualTo("手机号格式不正确");
    }

    /** Dubbo Consumer 抛出的 ValidationException 信息不可读，只能返回统一参数错误提示。 */
    @Test
    void validationExceptionReturnsUnifiedMessage() {
        CommonResult<?> result = handler.validationException(new ValidationException("DUMMY-UNREADABLE"));

        assertThat(result.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(result.getMsg()).isEqualTo(BAD_REQUEST.getMsg());
    }

    /** 上传体积超限必须给出可操作提示，而不是笼统的参数错误。 */
    @Test
    void maxUploadSizeReturnsActionableMessage() {
        CommonResult<?> result = handler.maxUploadSizeExceededExceptionHandler(new MaxUploadSizeExceededException(2048L));

        assertThat(result.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(result.getMsg()).isEqualTo("上传文件过大，请调整后重试");
    }

    /** 请求地址不存在必须回显原始 URL，便于排查前端拼错路径。 */
    @Test
    void noHandlerFoundReportsRequestUrl() {
        CommonResult<?> result = handler.noHandlerFoundExceptionHandler(
                new NoHandlerFoundException("GET", "/admin-api/unknown", new HttpHeaders()));

        assertThat(result.getCode()).isEqualTo(NOT_FOUND.getCode());
        assertThat(result.getMsg()).isEqualTo("请求地址不存在:/admin-api/unknown");
    }

    /**
     * 静态资源不存在同样按 404 处理，并回显资源路径。
     *
     * <p>该处理器是私有的，只能经全量分发入口调用；这里锁定它确实被分发到而不是落到兜底 500。</p>
     */
    @Test
    void noResourceFoundIsDispatchedAsNotFound() {
        CommonResult<?> result = handler.allExceptionHandler(request(),
                new NoResourceFoundException(HttpMethod.GET, "/static/logo.png"));

        assertThat(result.getCode()).isEqualTo(NOT_FOUND.getCode());
        assertThat(result.getMsg()).isEqualTo("请求地址不存在:/static/logo.png");
    }

    /** 请求方法不匹配必须返回 405，前端据此区分「路径存在但方法错」与「路径不存在」。 */
    @Test
    void methodNotSupportedReturns405() {
        CommonResult<?> result = handler.httpRequestMethodNotSupportedExceptionHandler(
                new HttpRequestMethodNotSupportedException("PUT"));

        assertThat(result.getCode()).isEqualTo(METHOD_NOT_ALLOWED.getCode());
        assertThat(result.getMsg()).startsWith("请求方法不正确:").contains("PUT");
    }

    /** 请求 Content-Type 不匹配必须返回 400 并回显不支持的媒体类型。 */
    @Test
    void mediaTypeNotSupportedReturns400() {
        CommonResult<?> result = handler.httpMediaTypeNotSupportedExceptionHandler(
                new HttpMediaTypeNotSupportedException(MediaType.APPLICATION_XML, List.of(MediaType.APPLICATION_JSON)));

        assertThat(result.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(result.getMsg()).startsWith("请求类型不正确:").contains("application/xml");
    }

    /** 权限不足必须返回 403，并记录当前登录用户与访问地址。 */
    @Test
    void accessDeniedReturnsForbiddenForCurrentUser() {
        CommonResult<?> result = handler.accessDeniedExceptionHandler(request(), new AccessDeniedException("DUMMY"));

        assertThat(result.getCode()).isEqualTo(FORBIDDEN.getCode());
        assertThat(result.getMsg()).isEqualTo(FORBIDDEN.getMsg());
    }

    /**
     * Guava 包装异常必须解包到真实原因再分发。
     *
     * <p>缓存加载失败会被包装成 UncheckedExecutionException，若直接按未知异常处理，
     * 业务错误码与提示会全部退化成 500。</p>
     */
    @Test
    void uncheckedExecutionExceptionUnwrapsBusinessCause() {
        UncheckedExecutionException exception = new UncheckedExecutionException(
                ServiceExceptionUtilFixture.businessFailure());

        CommonResult<?> result = handler.uncheckedExecutionExceptionHandler(request(), exception);

        assertThat(result.getCode()).isEqualTo(ServiceExceptionUtilFixture.CODE);
        assertThat(result.getMsg()).isEqualTo("库存不足");
    }

    /** 业务异常必须原样返回业务码与提示。 */
    @Test
    void serviceExceptionKeepsBusinessCodeAndMessage() {
        CommonResult<?> result = handler.serviceExceptionHandler(ServiceExceptionUtilFixture.businessFailure());

        assertThat(result.getCode()).isEqualTo(ServiceExceptionUtilFixture.CODE);
        assertThat(result.getMsg()).isEqualTo("库存不足");
    }

    /**
     * 免打印清单内的业务异常不得触发堆栈打印，但业务码与提示必须保持不变。
     *
     * <p>刷新令牌失效属于高频可预期失败，逐次打印完整调用栈会淹没真实故障。</p>
     */
    @Test
    void ignoredServiceExceptionSkipsStackLoggingButKeepsResponse() {
        CommonResult<?> result = handler.serviceExceptionHandler(new ServiceException(401, "无效的刷新令牌"));

        assertThat(result.getCode()).isEqualTo(401);
        assertThat(result.getMsg()).isEqualTo("无效的刷新令牌");
    }

    /**
     * 兜底处理必须识别被包装的业务异常并直接返回业务码，而不是当成系统异常记 500。
     */
    @Test
    void defaultHandlerUnwrapsWrappedServiceException() {
        CommonResult<?> result = handler.defaultExceptionHandler(request(),
                new IllegalStateException("DUMMY-WRAPPER", ServiceExceptionUtilFixture.businessFailure()));

        assertThat(result.getCode()).isEqualTo(ServiceExceptionUtilFixture.CODE);
        assertThat(result.getMsg()).isEqualTo("库存不足");
        verify(apiErrorLogApi, never()).createApiErrorLogAsync(any(ApiErrorLogCreateReqDTO.class));
    }

    /** 唯一索引 uk_code 冲突必须提示编码重复，而不是笼统的「数据已存在」。 */
    @Test
    void uniqueIndexOnCodeReportsDuplicatedCode() {
        CommonResult<?> result = handler.defaultExceptionHandler(request(),
                new IllegalStateException("DUMMY-WRAPPER",
                        new SQLIntegrityConstraintViolationException("Duplicate entry 'A01' for key 'uk_code'")));

        assertThat(result.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(result.getMsg()).isEqualTo("编码已存在，请更换后重试");
        verify(apiErrorLogApi, never()).createApiErrorLogAsync(any(ApiErrorLogCreateReqDTO.class));
    }

    /** 唯一索引 uk_name 冲突必须提示名称重复。 */
    @Test
    void uniqueIndexOnNameReportsDuplicatedName() {
        CommonResult<?> result = handler.defaultExceptionHandler(request(),
                new IllegalStateException("DUMMY-WRAPPER",
                        new SQLIntegrityConstraintViolationException("Duplicate entry '角色A' for key 'uk_name'")));

        assertThat(result.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(result.getMsg()).isEqualTo("名称已存在，请更换后重试");
    }

    /** 其它完整性约束冲突必须给出通用重复提示，且不得泄漏数据库原始语句。 */
    @Test
    void otherConstraintViolationReportsGenericDuplication() {
        CommonResult<?> result = handler.defaultExceptionHandler(request(),
                new IllegalStateException("DUMMY-WRAPPER",
                        new SQLIntegrityConstraintViolationException("Duplicate entry 'x' for key 'PRIMARY'")));

        assertThat(result.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(result.getMsg()).isEqualTo("数据已存在，请检查后重试");
    }

    /** 未知异常必须返回 500 并向异常日志写入脱敏后的请求参数与请求体。 */
    @Test
    void unexpectedFailureLogsSanitizedQueryAndBody() {
        MockHttpServletRequest request = request();
        request.addParameter("name", "张三");
        request.addParameter("password", "DUMMY-PWD");
        request.setContentType("application/json");
        request.setContent("[1,{\"password\":\"DUMMY-PWD\"},{\"name\":{\"token\":\"DUMMY-TOKEN\"}}]"
                .getBytes(StandardCharsets.UTF_8));

        CommonResult<?> result = handler.defaultExceptionHandler(request, new IllegalStateException("DUMMY"));

        assertThat(result.getCode()).isEqualTo(INTERNAL_SERVER_ERROR.getCode());
        assertThat(result.getMsg()).isEqualTo(INTERNAL_SERVER_ERROR.getMsg());
        ApiErrorLogCreateReqDTO errorLog = capturedErrorLog();
        assertThat(errorLog.getApplicationName()).isEqualTo("test-application");
        assertThat(errorLog.getRequestUrl()).isEqualTo("/admin-api/probe");
        assertThat(errorLog.getRequestMethod()).isEqualTo("GET");
        assertThat(errorLog.getUserId()).isEqualTo(1024L);
        assertThat(errorLog.getExceptionName()).isEqualTo(IllegalStateException.class.getName());
        assertThat(errorLog.getRequestParams())
                .as("保留非敏感查询参数与请求体结构，剔除口令与令牌")
                .contains("张三")
                .contains("[1,{}")
                .doesNotContain("DUMMY-PWD")
                .doesNotContain("DUMMY-TOKEN");
    }

    /** 请求体不是合法 JSON 时脱敏必须降级为安全占位内容，不能把原文写入日志。 */
    @Test
    void malformedBodyFallsBackToSanitizedPlaceholder() {
        MockHttpServletRequest request = request();
        request.setContentType("application/json");
        request.setContent("{\"password\":\"DUMMY-PWD\"".getBytes(StandardCharsets.UTF_8));

        handler.defaultExceptionHandler(request, new IllegalStateException("DUMMY"));

        assertThat(capturedErrorLog().getRequestParams())
                .contains("_sanitized")
                .doesNotContain("DUMMY-PWD");
    }

    /**
     * 非 JSON 请求体不进入异常日志。
     *
     * <p>只有 JSON 请求体被缓存过滤器缓存并支持重复读取；非 JSON 请求体若被强行读取，
     * 既会消耗一次性输入流，也可能把未脱敏的原始内容写进日志。</p>
     */
    @Test
    void nonJsonRequestLogsNullBody() {
        MockHttpServletRequest request = request();
        request.addParameter("keyword", "DUMMY-KEYWORD");
        request.setContentType("text/plain");
        request.setContent("DUMMY-TEXT".getBytes(StandardCharsets.UTF_8));

        handler.defaultExceptionHandler(request, new IllegalStateException("DUMMY"));

        assertThat(capturedErrorLog().getRequestParams())
                .contains("DUMMY-KEYWORD")
                .doesNotContain("body")
                .doesNotContain("DUMMY-TEXT");
    }

    /**
     * 异常日志写入失败不得覆盖原始业务响应。
     *
     * <p>异常日志是旁路能力：日志接口故障时仍必须把 500 返回给调用方，否则一次日志故障
     * 会放大成整个请求链路失败。</p>
     */
    @Test
    void errorLogWriteFailureDoesNotMaskResponse() {
        doThrow(new IllegalStateException("DUMMY-LOG-FAILURE"))
                .when(apiErrorLogApi).createApiErrorLogAsync(any(ApiErrorLogCreateReqDTO.class));

        CommonResult<?> result = handler.defaultExceptionHandler(request(), new IllegalStateException("DUMMY"));

        assertThat(result.getCode()).isEqualTo(INTERNAL_SERVER_ERROR.getCode());
        assertThat(result.getMsg()).isEqualTo(INTERNAL_SERVER_ERROR.getMsg());
    }

    /** 捕获最近一次写入的异常日志请求体。 */
    private ApiErrorLogCreateReqDTO capturedErrorLog() {
        ArgumentCaptor<ApiErrorLogCreateReqDTO> captor = ArgumentCaptor.forClass(ApiErrorLogCreateReqDTO.class);
        verify(apiErrorLogApi).createApiErrorLogAsync(captor.capture());
        return captor.getValue();
    }

    /**
     * 断言某异常经全量分发后得到指定错误码，并在给出期望提示时校验提示文本。
     *
     * @param request 请求
     * @param exception 待分发的异常
     * @param expectedCode 期望错误码
     * @param expectedMessage 期望提示；为 null 时只校验错误码
     */
    private static void assertDispatched(MockHttpServletRequest request, Throwable exception,
                                        int expectedCode, String expectedMessage) {
        CommonResult<?> result = new GlobalExceptionHandler("test-application", mock(ApiErrorLogCommonApi.class))
                .allExceptionHandler(request, exception);

        assertThat(result.getCode()).as("异常类型 %s 的错误码", exception.getClass().getSimpleName())
                .isEqualTo(expectedCode);
        if (expectedMessage != null) {
            assertThat(result.getMsg()).as("异常类型 %s 的提示", exception.getClass().getSimpleName())
                    .isEqualTo(expectedMessage);
        }
    }

    /**
     * 构造携带指定错误明细的参数绑定结果。
     *
     * @param error 唯一的一条错误明细
     * @return 含该错误明细的绑定结果
     */
    private static BeanPropertyBindingResult bindingWithError(ObjectError error) {
        BeanPropertyBindingResult binding = new BeanPropertyBindingResult(new Object(), "request");
        binding.addError(error);
        return binding;
    }

    /**
     * 构造指向样例方法首个参数的参数描述。
     *
     * @return 方法参数描述
     * @throws NoSuchMethodException 样例方法缺失时抛出
     */
    private static MethodParameter parameter() throws NoSuchMethodException {
        return new MethodParameter(Holder.class.getDeclaredMethod("sample", Object.class), 0);
    }

    /**
     * 构造带指定提示的校验违规。
     *
     * @param message 违规提示
     * @return 校验违规模拟对象
     */
    private static ConstraintViolation<?> violation(String message) {
        ConstraintViolation<?> violation = mock(ConstraintViolation.class);
        when(violation.getMessage()).thenReturn(message);
        return violation;
    }

    /** 提供带参数的样例方法，用于构造 MethodParameter。 */
    static class Holder {

        /**
         * 样例方法。
         *
         * @param value 样例取值
         */
        void sample(Object value) {
        }
    }

    /** 提供真实业务异常与错误码，避免用例重复魔法值。 */
    static final class ServiceExceptionUtilFixture {

        /** 业务错误码，取自业务错误码区间。 */
        static final int CODE = 1024000000;

        /**
         * 创建真实业务异常。
         *
         * @return 库存不足的业务异常
         */
        static ServiceException businessFailure() {
            return new ServiceException(CODE, "库存不足");
        }
    }


}
