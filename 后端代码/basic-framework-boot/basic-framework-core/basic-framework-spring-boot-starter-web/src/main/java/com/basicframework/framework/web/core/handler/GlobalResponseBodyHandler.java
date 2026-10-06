package com.basicframework.framework.web.core.handler;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.web.core.util.WebFrameworkUtils;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;

/**
 * 全局响应结果（ResponseBody）处理器
 *
 * 不同于在网上看到的很多文章，会选择自动将 Controller 返回结果包上 {@link CommonResult}，
 * 在 onemall 中，是 Controller 在返回时，主动自己包上 {@link CommonResult}。
 * 原因是，GlobalResponseBodyHandler 本质上是 AOP，它不应该改变 Controller 返回的数据结构
 *
 * 目前，GlobalResponseBodyHandler 的主要作用是，记录 Controller 的返回结果，
 * 方便 {@link com.basicframework.framework.apilog.core.filter.ApiAccessLogFilter} 记录访问日志
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-framework/yudao-spring-boot-starter-web/src/main/java/cn/
 * 上游文件续：iocoder/yudao/framework/web/core/handler/GlobalResponseBodyHandler.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地补充注释 18 行。
 */
@ControllerAdvice
public class GlobalResponseBodyHandler implements ResponseBodyAdvice {

    /**
     * 判断当前组件是否支持目标类型。
     *
     * @param returnType returnType 参数
     * @param converterType converterType 参数
     * @return 业务条件成立时返回 true，否则返回 false
     */
    @Override
    @SuppressWarnings("NullableProblems") // 避免 IDEA 警告
    public boolean supports(MethodParameter returnType, Class converterType) {
        if (returnType.getMethod() == null) {
            return false;
        }
        // 只拦截返回结果为 CommonResult 类型
        return returnType.getMethod().getReturnType() == CommonResult.class;
    }

    /**
     * 执行前置处理BodyWrite。
     *
     * @param body body 参数
     * @param returnType returnType 参数
     * @param selectedContentType selectedContentType 参数
     * @param selectedConverterType selectedConverterType 参数
     * @param request 当前 HTTP 请求
     * @param response 当前 HTTP 响应
     * @return 方法处理结果
     */
    @Override
    @SuppressWarnings("NullableProblems") // 避免 IDEA 警告
    public Object beforeBodyWrite(Object body, MethodParameter returnType, MediaType selectedContentType, Class selectedConverterType,
                                  ServerHttpRequest request, ServerHttpResponse response) {
        // 记录 Controller 结果
        WebFrameworkUtils.setCommonResult(((ServletServerHttpRequest) request).getServletRequest(), (CommonResult<?>) body);
        return body;
    }

}
