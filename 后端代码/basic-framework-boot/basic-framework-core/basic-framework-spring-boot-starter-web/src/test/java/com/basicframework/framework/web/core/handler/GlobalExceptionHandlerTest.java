package com.basicframework.framework.web.core.handler;

import com.basicframework.framework.apilog.core.annotation.ApiAccessLog;
import com.basicframework.framework.apilog.core.interceptor.ApiAccessLogInterceptor;
import com.basicframework.framework.common.biz.infra.logger.ApiErrorLogCommonApi;
import com.basicframework.framework.common.biz.infra.logger.dto.ApiErrorLogCreateReqDTO;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.framework.web.core.util.SensitiveDataUtils;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.validation.BindException;
import org.springframework.validation.ObjectError;
import org.springframework.web.method.HandlerMethod;

import java.nio.charset.StandardCharsets;

import static com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants.BAD_REQUEST;
import static com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants.INTERNAL_SERVER_ERROR;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * 验证全局异常处理器的稳定错误语义与异常日志脱敏契约。
 *
 * @author 李杰
 */
class GlobalExceptionHandlerTest {

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
     * 验证未捕获异常日志对查询参数与请求体执行统一脱敏，并尊重方法注解上的 {@code sanitizeKeys}。
     */
    @Test
    void shouldSanitizeQueryBodyAndCustomKeysOnExceptionLog() throws NoSuchMethodException {
        ApiErrorLogCommonApi errorLogApi = mock(ApiErrorLogCommonApi.class);
        GlobalExceptionHandler handler = new GlobalExceptionHandler("test-application", errorLogApi);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/system/auth/login");
        request.setRemoteAddr("127.0.0.1");
        request.setContentType("application/json");
        request.addParameter("username", "alice");
        request.addParameter("token", "secret-token");
        request.addParameter("id_card_no", "110101");
        request.setContent("{\"username\":\"alice\",\"password\":\"raw-pwd\",\"idCardNo\":\"110101\",\"nested\":[{\"secret\":\"s1\"}]}"
                .getBytes(StandardCharsets.UTF_8));
        HandlerMethod handlerMethod = new HandlerMethod(
                new AnnotatedEndpoint(), AnnotatedEndpoint.class.getDeclaredMethod("handle"));
        request.setAttribute(ApiAccessLogInterceptor.ATTRIBUTE_HANDLER_METHOD, handlerMethod);

        CommonResult<?> result = handler.allExceptionHandler(request, new RuntimeException("boom"));

        assertThat(result.getCode()).isEqualTo(INTERNAL_SERVER_ERROR.getCode());
        ArgumentCaptor<ApiErrorLogCreateReqDTO> captor = ArgumentCaptor.forClass(ApiErrorLogCreateReqDTO.class);
        verify(errorLogApi).createApiErrorLogAsync(captor.capture());
        JsonNode paramsTree = JsonUtils.parseTree(captor.getValue().getRequestParams());
        assertThat(paramsTree.get("query").asText())
                .contains("alice")
                .doesNotContain("secret-token", "110101", "token", "id_card_no");
        assertThat(paramsTree.get("body").asText())
                .contains("alice")
                .doesNotContain("raw-pwd", "110101", "s1", "password", "idCardNo", "secret");
    }

    /**
     * 验证异常请求体解析失败时降级为统一占位内容而不泄露原文。
     */
    @Test
    void shouldFallbackToPlaceholderForMalformedBodyInExceptionLog() {
        ApiErrorLogCommonApi errorLogApi = mock(ApiErrorLogCommonApi.class);
        GlobalExceptionHandler handler = new GlobalExceptionHandler("test-application", errorLogApi);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/system/auth/login");
        request.setRemoteAddr("127.0.0.1");
        request.setContentType("application/json");
        request.setContent("{\"password\":\"raw-secret\"} trailing".getBytes(StandardCharsets.UTF_8));

        handler.allExceptionHandler(request, new RuntimeException("boom"));

        ArgumentCaptor<ApiErrorLogCreateReqDTO> captor = ArgumentCaptor.forClass(ApiErrorLogCreateReqDTO.class);
        verify(errorLogApi).createApiErrorLogAsync(captor.capture());
        JsonNode paramsTree = JsonUtils.parseTree(captor.getValue().getRequestParams());
        assertThat(paramsTree.get("body").asText()).isEqualTo(SensitiveDataUtils.SANITIZE_FAILURE_PLACEHOLDER);
        assertThat(captor.getValue().getRequestParams()).doesNotContain("raw-secret");
    }

    /** 验证 400 参数类型异常响应只返回参数名，不回显原始异常堆栈或非法输入值。 */
    @Test
    void typeMismatchAndInvalidFormatShouldNotEchoRawInternals() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler("basic-framework-server", mock(ApiErrorLogCommonApi.class));
        org.springframework.web.method.annotation.MethodArgumentTypeMismatchException mismatch =
                new org.springframework.web.method.annotation.MethodArgumentTypeMismatchException(
                        "bad-secret-value", Long.class, "userId", null, new NumberFormatException("For input string: \"bad-secret-value\""));
        com.basicframework.framework.common.pojo.CommonResult<?> mismatchResult =
                handler.methodArgumentTypeMismatchExceptionHandler(mismatch);
        assertThat(mismatchResult.getMsg()).contains("userId").doesNotContain("bad-secret-value").doesNotContain("NumberFormatException");

        com.fasterxml.jackson.databind.exc.InvalidFormatException invalidFormat =
                com.fasterxml.jackson.databind.exc.InvalidFormatException.from(null, "invalid", "raw-input-payload", Integer.class);
        invalidFormat.prependPath(Object.class, "status");
        com.basicframework.framework.common.pojo.CommonResult<?> formatResult =
                handler.methodArgumentTypeInvalidFormatExceptionHandler(
                        new org.springframework.http.converter.HttpMessageNotReadableException("bad body", invalidFormat, null));
        assertThat(formatResult.getMsg()).contains("status").doesNotContain("raw-input-payload");
    }

    /** 用于提供 {@link ApiAccessLog#sanitizeKeys()} 元数据的测试控制器桩。 */
    private static final class AnnotatedEndpoint {

        /** 声明自定义敏感字段的测试处理方法。 */
        @ApiAccessLog(sanitizeKeys = {"idCardNo"})
        void handle() {
        }
    }
}
