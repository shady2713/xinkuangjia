package com.basicframework.framework.common.exception.enums;

import org.junit.jupiter.api.Test;

import java.lang.reflect.Constructor;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证业务异常错误码区间登记类的形态契约。
 *
 * <p>{@link ServiceErrorCodeRange} 是各模块划分错误码段位的唯一登记点，只承载说明而不参与运行逻辑。
 * 因此它必须是一个可直接引用的普通类，且不保存任何运行期状态；一旦被改造成需要注入或持有字段的组件，
 * 引用它的模块就会被迫承担额外装配成本，段位说明也会与实现耦合。</p>
 *
 * @author shady2713
 */
class ServiceErrorCodeRangeTest {

    /** 登记类保持无状态并可无参实例化，引用方无需提供任何依赖。 */
    @Test
    void rangeAnchorIsStatelessAndInstantiable() throws ReflectiveOperationException {
        assertThat(ServiceErrorCodeRange.class.getDeclaredFields())
                .as("错误码区间登记类只承载段位说明，不应保存运行期状态")
                .isEmpty();

        Constructor<ServiceErrorCodeRange> constructor = ServiceErrorCodeRange.class.getDeclaredConstructor();
        assertThat(constructor.newInstance())
                .as("登记类必须可以直接实例化，供模块引用其段位说明")
                .isInstanceOf(ServiceErrorCodeRange.class);
    }
}
