package com.basicframework.framework.web.core.handler;

import com.basicframework.framework.common.pojo.CommonResult;
import com.fasterxml.jackson.databind.exc.InvalidFormatException;
import com.google.common.util.concurrent.UncheckedExecutionException;
import jakarta.validation.ValidationException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.validation.BindException;
import org.springframework.validation.FieldError;
import org.springframework.validation.ObjectError;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.nio.charset.StandardCharsets;
import java.sql.SQLIntegrityConstraintViolationException;

import static com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants.BAD_REQUEST;
import static com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants.INTERNAL_SERVER_ERROR;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证全局异常处理器的稳定错误语义。
 *
 * @author 李杰
 */
class GlobalExceptionHandlerTest {

    @Test
    void shouldHandleGlobalBindingErrorWithoutFieldError() {
        BindException exception = new BindException(new Object(), "request");
        exception.addError(new ObjectError("request", "组合参数校验失败"));
        GlobalExceptionHandler handler = new GlobalExceptionHandler("test-application");

        CommonResult<?> result = handler.bindExceptionHandler(exception);

        assertThat(result.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(result.getMsg()).isEqualTo("组合参数校验失败");
    }

    @Test
    void shouldReturnFieldMessageForFieldBindingError() {
        BindException exception = new BindException(new Object(), "request");
        exception.addError(new FieldError("request", "username", "用户名不能为空"));
        GlobalExceptionHandler handler = new GlobalExceptionHandler("test-application");

        CommonResult<?> result = handler.bindExceptionHandler(exception);

        assertThat(result.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(result.getMsg()).isEqualTo("用户名不能为空");
    }

    @Test
    void shouldKeepGenericBadRequestForValidationException() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler("test-application");

        CommonResult<?> result = handler.validationException(new ValidationException("validation failed"));

        assertThat(result.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(result.getMsg()).isEqualTo(BAD_REQUEST.getMsg());
    }

    @Test
    void shouldReturnInternalServerErrorForUnhandledException() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler("test-application");
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/system/auth/login");
        request.setRemoteAddr("127.0.0.1");
        request.setContentType("application/json");
        request.addParameter("username", "alice");
        request.addParameter("token", "secret-token");
        request.setContent("{\"username\":\"alice\",\"password\":\"raw-pwd\"}".getBytes(StandardCharsets.UTF_8));

        CommonResult<?> result = handler.allExceptionHandler(request, new RuntimeException("boom"));

        assertThat(result.getCode()).isEqualTo(INTERNAL_SERVER_ERROR.getCode());
        assertThat(result.getMsg()).isEqualTo(INTERNAL_SERVER_ERROR.getMsg());
    }

    @Test
    void typeMismatchAndInvalidFormatShouldNotEchoRawInternals() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler("basic-framework-server");
        MethodArgumentTypeMismatchException mismatch = new MethodArgumentTypeMismatchException(
                "bad-secret-value", Long.class, "userId", null,
                new NumberFormatException("For input string: \"bad-secret-value\""));
        CommonResult<?> mismatchResult = handler.methodArgumentTypeMismatchExceptionHandler(mismatch);
        assertThat(mismatchResult.getMsg())
                .contains("userId")
                .doesNotContain("bad-secret-value")
                .doesNotContain("NumberFormatException");

        InvalidFormatException invalidFormat =
                InvalidFormatException.from(null, "invalid", "raw-input-payload", Integer.class);
        invalidFormat.prependPath(Object.class, "status");
        CommonResult<?> formatResult = handler.methodArgumentTypeInvalidFormatExceptionHandler(
                new HttpMessageNotReadableException("bad body", invalidFormat, null));
        assertThat(formatResult.getMsg()).contains("status").doesNotContain("raw-input-payload");

        CommonResult<?> malformedResult = handler.methodArgumentTypeInvalidFormatExceptionHandler(
                new HttpMessageNotReadableException("JSON parse error", new RuntimeException("unexpected token"), null));
        assertThat(malformedResult.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(malformedResult.getMsg()).isEqualTo("请求参数格式错误");
    }

    @Test
    void sqlIntegrityViolationOnlyMapsDuplicateKeyToBadRequest() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler("test-application");
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/system/user/create");

        SQLIntegrityConstraintViolationException dupEx =
                new SQLIntegrityConstraintViolationException("Duplicate entry 'admin'", "23000", 1062);
        CommonResult<?> dupResult = handler.allExceptionHandler(
                request, new DataIntegrityViolationException("dup", dupEx));
        assertThat(dupResult.getCode()).isEqualTo(BAD_REQUEST.getCode());
        assertThat(dupResult.getMsg()).isEqualTo("数据已存在，请检查后重试");

        SQLIntegrityConstraintViolationException notNullEx =
                new SQLIntegrityConstraintViolationException("Column 'nickname' cannot be null", "23000", 1048);
        CommonResult<?> notNullResult = handler.allExceptionHandler(
                request, new DataIntegrityViolationException("not null", notNullEx));
        assertThat(notNullResult.getCode()).isEqualTo(INTERNAL_SERVER_ERROR.getCode());
    }

    @Test
    void uncheckedExecutionExceptionWithNullCauseDoesNotThrowNpe() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler("test-application");
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/system/dict-type/list");

        CommonResult<?> result = handler.uncheckedExecutionExceptionHandler(
                request, new UncheckedExecutionException((Throwable) null));
        assertThat(result.getCode()).isEqualTo(INTERNAL_SERVER_ERROR.getCode());
    }

}
