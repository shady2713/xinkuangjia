package com.basicframework.framework.web.core.handler;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.web.core.util.WebFrameworkUtils;
import org.junit.jupiter.api.Test;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.http.server.ServletServerHttpResponse;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 校验全局响应结果处理器的拦截判定与结果登记行为。
 *
 * <p>该处理器不改写响应结构，只把 Controller 返回的 {@link CommonResult} 记录到请求属性，
 * 供访问日志过滤器读取业务错误码与提示。因此有两条必须锁定的契约：只拦截返回类型恰为
 * {@code CommonResult} 的方法（构造方法绑定等无法取得返回类型的情况必须安全跳过），以及
 * 记录后仍返回原对象，避免响应体被替换或包装。</p>
 *
 * @author shady2713
 */
class GlobalResponseBodyHandlerTest {

    /** 被测处理器，无状态可跨用例复用。 */
    private static final GlobalResponseBodyHandler HANDLER = new GlobalResponseBodyHandler();

    /** 只对返回类型恰为 CommonResult 的方法生效，其它返回类型与无法取到方法时一律跳过。 */
    @Test
    void supportsOnlyCommonResultReturnType() throws Exception {
        MethodParameter commonResultParam = returnTypeParameter("returnsCommonResult");
        MethodParameter stringParam = returnTypeParameter("returnsString");
        MethodParameter voidParam = returnTypeParameter("returnsVoid");
        MethodParameter constructorParam = new MethodParameter(
                Holder.class.getDeclaredConstructor(String.class), 0);

        assertThat(HANDLER.supports(commonResultParam, null)).isTrue();
        assertThat(HANDLER.supports(stringParam, null)).as("普通返回类型不得被拦截").isFalse();
        assertThat(HANDLER.supports(voidParam, null)).isFalse();
        assertThat(HANDLER.supports(constructorParam, null))
                .as("构造方法绑定取不到方法，必须安全返回 false").isFalse();
    }

    /** 记录结果的同时必须原样返回响应体，不得改变 Controller 返回的数据结构。 */
    @Test
    void beforeBodyWriteRecordsResultAndKeepsBody() throws Exception {
        MockHttpServletRequest servletRequest = new MockHttpServletRequest("GET", "/admin-api/system/user/get");
        CommonResult<String> body = CommonResult.success("data");

        Object returned = HANDLER.beforeBodyWrite(body, returnTypeParameter("returnsCommonResult"),
                MediaType.APPLICATION_JSON, null,
                new ServletServerHttpRequest(servletRequest),
                new ServletServerHttpResponse(new MockHttpServletResponse()));

        assertThat(returned).as("必须原样返回响应体").isSameAs(body);
        assertThat(WebFrameworkUtils.getCommonResult(servletRequest))
                .as("访问日志过滤器必须能从请求属性读到同一结果").isSameAs(body);
    }

    /** 未登记结果的请求读取时必须返回 null，不能抛出异常。 */
    @Test
    void absentResultReadsAsNull() {
        assertThat(WebFrameworkUtils.getCommonResult(
                new MockHttpServletRequest("GET", "/admin-api/system/user/get"))).isNull();
    }

    /**
     * 构造指向方法返回值的参数描述。
     *
     * @param methodName 样例方法名
     * @return 返回类型参数描述
     */
    private static MethodParameter returnTypeParameter(String methodName) throws NoSuchMethodException {
        return new MethodParameter(Holder.class.getDeclaredMethod(methodName), -1);
    }

    /** 提供不同返回类型的样例方法，用于验证拦截判定。 */
    static class Holder {

        /**
         * 创建样例对象。
         *
         * @param value 样例取值
         */
        Holder(String value) {
        }

        /**
         * 返回业务结果。
         *
         * @return 业务结果
         */
        CommonResult<String> returnsCommonResult() {
            return null;
        }

        /**
         * 返回普通字符串。
         *
         * @return 字符串
         */
        String returnsString() {
            return null;
        }

        /**
         * 无返回值方法，用于验证 void 返回类型不被拦截。
         */
        void returnsVoid() {
        }
    }
}
