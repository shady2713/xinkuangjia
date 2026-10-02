package com.basicframework.framework.apilog.core.interceptor;

import cn.hutool.core.io.FileUtil;
import cn.hutool.core.io.resource.ResourceUtil;
import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.util.servlet.ServletUtils;
import com.basicframework.framework.common.util.spring.SpringUtils;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.util.StopWatch;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.IntStream;

/**
 * API 访问日志 Interceptor
 *
 * 目的：在非 prod 环境时，打印 request 和 response 两条日志到日志文件（控制台）中。
 * @author 李杰
 */
@Slf4j
public class ApiAccessLogInterceptor implements HandlerInterceptor {

    public static final String ATTRIBUTE_HANDLER_METHOD = "HANDLER_METHOD";

    private static final String ATTRIBUTE_STOP_WATCH = "ApiAccessLogInterceptor.StopWatch";

    /**
     * 执行请求前置处理目标数据。
     *
     * @param request 当前 HTTP 请求
     * @param response 当前 HTTP 响应
     * @param handler handler 参数
     * @return 业务条件成立时返回 true，否则返回 false
     */
    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        HandlerMethod handlerMethod = handler instanceof HandlerMethod ? (HandlerMethod) handler : null;
        if (handlerMethod != null) {
            request.setAttribute(ATTRIBUTE_HANDLER_METHOD, handlerMethod);
        }

        if (!SpringUtils.isProd()) {
            Map<String, String> queryString = ServletUtils.getParamMap(request);
            String requestBody = ServletUtils.isJsonRequest(request) ? ServletUtils.getBody(request) : null;
            log.info("[preHandle][开始请求 URL({}) queryCount({}) bodyLength({})]",
                    request.getRequestURI(), queryString.size(), StrUtil.length(requestBody));
            StopWatch stopWatch = new StopWatch();
            stopWatch.start();
            request.setAttribute(ATTRIBUTE_STOP_WATCH, stopWatch);
            printHandlerMethodPosition(handlerMethod);
        }
        return true;
    }

    /**
     * 执行后置处理Completion。
     *
     * @param request 当前 HTTP 请求
     * @param response 当前 HTTP 响应
     * @param handler handler 参数
     * @param ex ex 参数
     */
    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
        if (!SpringUtils.isProd()) {
            StopWatch stopWatch = (StopWatch) request.getAttribute(ATTRIBUTE_STOP_WATCH);
            stopWatch.stop();
            log.info("[afterCompletion][完成请求 URL({}) status({}) 耗时({} ms)]",
                    request.getRequestURI(), response.getStatus(), stopWatch.getTotalTimeMillis());
        }
    }

    /**
     * 输出处理器方法的代码位置，便于定位配置问题。
     *
     * @param handlerMethod handlerMethod 参数
     */
    private void printHandlerMethodPosition(HandlerMethod handlerMethod) {
        if (handlerMethod == null) {
            return;
        }
        Method method = handlerMethod.getMethod();
        Class<?> clazz = method.getDeclaringClass();
        try {
            List<String> clazzContents = FileUtil.readUtf8Lines(
                    ResourceUtil.getResource(null, clazz).getPath().replace("/target/classes/", "/src/main/java/")
                            + clazz.getSimpleName() + ".java");
            Optional<Integer> lineNumber = IntStream.range(0, clazzContents.size())
                    .filter(i -> clazzContents.get(i).contains(" " + method.getName() + "("))
                    .mapToObj(i -> i + 1)
                    .findFirst();
            if (!lineNumber.isPresent()) {
                return;
            }
            log.debug("Controller 方法路径：{}({}.java:{})", clazz.getName(), clazz.getSimpleName(), lineNumber.get());
        } catch (Exception ex) {
            // 源码位置仅用于开发调试，读取失败不能影响正常请求链路。
            log.debug("[printHandlerMethodPosition][无法定位 Controller 方法源码位置，className({}) methodName({})]",
                    clazz.getName(), method.getName(), ex);
        }
    }

}
