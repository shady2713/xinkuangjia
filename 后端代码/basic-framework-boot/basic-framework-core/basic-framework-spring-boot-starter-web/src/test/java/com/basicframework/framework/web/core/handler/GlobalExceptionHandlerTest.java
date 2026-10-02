package com.basicframework.framework.web.core.handler;

import com.basicframework.framework.common.biz.infra.logger.ApiErrorLogCommonApi;
import com.basicframework.framework.common.pojo.CommonResult;
import org.junit.jupiter.api.Test;
import org.springframework.validation.BindException;
import org.springframework.validation.ObjectError;

import static com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants.BAD_REQUEST;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * 验证全局异常处理器的稳定错误语义。
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
}
