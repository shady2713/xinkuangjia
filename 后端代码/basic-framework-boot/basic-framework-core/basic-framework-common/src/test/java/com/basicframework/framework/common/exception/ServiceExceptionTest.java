package com.basicframework.framework.common.exception;

import com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证业务异常三种构造方式与链式设值入口的真实契约。
 *
 * <p>{@link ServiceException} 是全局异常处理器读取业务码与提示的唯一来源，
 * 空构造用于反序列化、错误码构造用于业务失败、链式设值用于在抛出处补充上下文。
 * 这里锁定“构造即携带错误码对象的码与文案”和“设值返回同一实例”，
 * 避免未来改成不可变对象或返回新实例导致调用方丢失补充的上下文。</p>
 *
 * @author shady2713
 */
class ServiceExceptionTest {

    /** 空构造保留未设值状态，交由反序列化或后续链式调用填充。 */
    @Test
    void noArgConstructorLeavesCodeAndMessageUnset() {
        ServiceException exception = new ServiceException();

        assertThat(exception.getCode()).isNull();
        assertThat(exception.getMessage()).isNull();
    }

    /** 错误码构造直接把错误码对象的码与文案复制为异常字段。 */
    @Test
    void errorCodeConstructorCopiesCodeAndMessage() {
        ServiceException exception = new ServiceException(GlobalErrorCodeConstants.BAD_REQUEST);

        assertThat(exception.getCode()).isEqualTo(400);
        assertThat(exception.getMessage()).isEqualTo("请求参数不正确");
    }

    /** 显式码与文案构造原样保留入参，不做任何加工。 */
    @Test
    void codeAndMessageConstructorKeepsArguments() {
        ServiceException exception = new ServiceException(1_000_001, "自定义业务失败");

        assertThat(exception.getCode()).isEqualTo(1_000_001);
        assertThat(exception.getMessage()).isEqualTo("自定义业务失败");
    }

    /** 链式设值修改当前实例并返回自身，使抛出点可以一行补充上下文。 */
    @Test
    void settersMutateSameInstanceAndReturnIt() {
        ServiceException exception = new ServiceException(GlobalErrorCodeConstants.BAD_REQUEST);

        assertThat(exception.setCode(500)).isSameAs(exception);
        assertThat(exception.setMessage("补充后的提示")).isSameAs(exception);
        assertThat(exception.getCode()).isEqualTo(500);
        assertThat(exception.getMessage()).isEqualTo("补充后的提示");
    }

}
