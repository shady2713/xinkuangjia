package com.basicframework.framework.common.exception;

import com.basicframework.framework.common.exception.util.ServiceExceptionUtil;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 {@link ErrorCode} 的取值契约及其到业务异常的传递行为。
 *
 * <p>各模块用常量声明错误码，再经 {@code ServiceExceptionUtil} 转成 {@link ServiceException}
 * 返回给调用方。错误码或提示在构造时一旦丢失、错位，调用方看到的失败原因就会与声明不符；
 * 带占位符的提示还决定了最终展示文案，因此这里同时锁定单参与带参两条转换路径。</p>
 *
 * @author shady2713
 */
class ErrorCodeTest {

    /** 构造后错误码与提示必须原样保留，不做任何加工或默认值替换。 */
    @Test
    void constructorKeepsCodeAndMessage() {
        ErrorCode errorCode = new ErrorCode(1024000000, "配置不存在");

        assertThat(errorCode.getCode()).isEqualTo(1024000000);
        assertThat(errorCode.getMsg()).isEqualTo("配置不存在");
    }

    /**
     * 无格式化参数的转换路径把错误码与提示原样写入业务异常，占位符保持字面量。
     *
     * <p>该入口不接收参数，缺少参数时不能凭空替换占位符，否则调用方会用错误文案排障。</p>
     */
    @Test
    void exceptionWithoutParamsKeepsMessageLiteral() {
        ErrorCode errorCode = new ErrorCode(1024000000, "配置 {} 不存在");

        ServiceException exception = ServiceExceptionUtil.exception(errorCode);

        assertThat(exception.getCode()).isEqualTo(1024000000);
        assertThat(exception.getMessage()).isEqualTo("配置 {} 不存在");
    }

    /** 带格式化参数的转换路径按顺序替换 {} 占位符，保留其余文案。 */
    @Test
    void exceptionWithParamsFormatsPlaceholders() {
        ErrorCode errorCode = new ErrorCode(1024000001, "配置 {} 的取值 {} 不合法");

        ServiceException exception = ServiceExceptionUtil.exception(errorCode, "timeout", -1);

        assertThat(exception.getCode()).isEqualTo(1024000001);
        assertThat(exception.getMessage()).isEqualTo("配置 timeout 的取值 -1 不合法");
    }

}
