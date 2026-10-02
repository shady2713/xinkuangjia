package com.basicframework.framework.apilog.core.filter;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.date.LocalDateTimeUtil;
import cn.hutool.core.exceptions.ExceptionUtil;
import cn.hutool.core.map.MapUtil;
import cn.hutool.core.util.BooleanUtil;
import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.apilog.core.annotation.ApiAccessLog;
import com.basicframework.framework.apilog.core.enums.OperateTypeEnum;
import com.basicframework.framework.common.biz.infra.logger.ApiAccessLogCommonApi;
import com.basicframework.framework.common.biz.infra.logger.dto.ApiAccessLogCreateReqDTO;
import com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.framework.common.util.monitor.TracerUtils;
import com.basicframework.framework.common.util.servlet.ServletUtils;
import com.basicframework.framework.web.config.WebProperties;
import com.basicframework.framework.web.core.filter.ApiRequestFilter;
import com.basicframework.framework.web.core.util.SensitiveDataUtils;
import com.basicframework.framework.web.core.util.WebFrameworkUtils;
import com.fasterxml.jackson.databind.JsonNode;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.method.HandlerMethod;

import java.io.IOException;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.Iterator;
import java.util.Map;

import static com.basicframework.framework.apilog.core.interceptor.ApiAccessLogInterceptor.ATTRIBUTE_HANDLER_METHOD;
import static com.basicframework.framework.common.util.json.JsonUtils.toJsonString;

/**
 * API 访问日志 Filter
 *
 * 目的：记录 API 访问日志到数据库中
 *
 * @author 李杰
 */
@Slf4j
public class ApiAccessLogFilter extends ApiRequestFilter {

    private static final String SANITIZE_FAILURE_PLACEHOLDER = "{\"_sanitized\":true}";

    private final String applicationName;

    private final ApiAccessLogCommonApi apiAccessLogApi;

    /**
     * 创建 API 访问日志过滤器。
     *
     * @param webProperties Web 路径配置
     * @param applicationName 应用名称
     * @param apiAccessLogApi 访问日志 API
     */
    public ApiAccessLogFilter(WebProperties webProperties, String applicationName, ApiAccessLogCommonApi apiAccessLogApi) {
        super(webProperties);
        this.applicationName = applicationName;
        this.apiAccessLogApi = apiAccessLogApi;
    }

    /**
     * 执行请求链并在成功或异常结束后记录访问日志。
     *
     * @param request 请求
     * @param response 响应
     * @param filterChain 过滤链
     * @throws ServletException Servlet 处理异常
     * @throws IOException 输入输出异常
     */
    @Override
    @SuppressWarnings("NullableProblems")
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        LocalDateTime beginTime = LocalDateTime.now();
        Map<String, String> queryString = ServletUtils.getParamMap(request);
        String requestBody = ServletUtils.isJsonRequest(request) ? ServletUtils.getBody(request) : null;

        try {
            filterChain.doFilter(request, response);
            createApiAccessLog(request, beginTime, queryString, requestBody, null);
        } catch (Exception ex) {
            createApiAccessLog(request, beginTime, queryString, requestBody, ex);
            throw ex;
        }
    }

    /**
     * 构建并异步写入访问日志；日志写入失败不覆盖原请求结果。
     *
     * @param request 请求
     * @param beginTime 请求开始时间
     * @param queryString 查询参数
     * @param requestBody 请求体
     * @param ex 请求处理异常，成功时为空
     */
    private void createApiAccessLog(HttpServletRequest request, LocalDateTime beginTime,
                                    Map<String, String> queryString, String requestBody, Exception ex) {
        ApiAccessLogCreateReqDTO accessLog = new ApiAccessLogCreateReqDTO();
        try {
            boolean enable = buildApiAccessLog(accessLog, request, beginTime, queryString, requestBody, ex);
            if (!enable) {
                return;
            }
            apiAccessLogApi.createApiAccessLogAsync(accessLog);
        } catch (Exception exception) {
            log.error("[createApiAccessLog][url({}) traceId({}) resultCode({}) 发生异常]",
                    request.getRequestURI(), accessLog.getTraceId(), accessLog.getResultCode(), exception);
        }
    }

    /**
     * 补全访问日志的用户、请求、响应、耗时和操作信息，并按注解决定是否记录。
     *
     * @param accessLog 访问日志请求
     * @param request 请求
     * @param beginTime 请求开始时间
     * @param queryString 查询参数
     * @param requestBody 请求体
     * @param ex 请求处理异常，成功时为空
     * @return 是否需要写入访问日志
     */
    private boolean buildApiAccessLog(ApiAccessLogCreateReqDTO accessLog, HttpServletRequest request, LocalDateTime beginTime,
                                      Map<String, String> queryString, String requestBody, Exception ex) {
        HandlerMethod handlerMethod = (HandlerMethod) request.getAttribute(ATTRIBUTE_HANDLER_METHOD);
        ApiAccessLog accessLogAnnotation = null;
        if (handlerMethod != null) {
            accessLogAnnotation = handlerMethod.getMethodAnnotation(ApiAccessLog.class);
            if (accessLogAnnotation != null && BooleanUtil.isFalse(accessLogAnnotation.enable())) {
                return false;
            }
        }

        accessLog.setUserId(WebFrameworkUtils.getLoginUserId(request));
        accessLog.setUserType(WebFrameworkUtils.getLoginUserType(request));
        CommonResult<?> result = WebFrameworkUtils.getCommonResult(request);
        if (result != null) {
            accessLog.setResultCode(result.getCode());
            accessLog.setResultMsg(result.getMsg());
        } else if (ex != null) {
            accessLog.setResultCode(GlobalErrorCodeConstants.INTERNAL_SERVER_ERROR.getCode());
            accessLog.setResultMsg(ExceptionUtil.getRootCauseMessage(ex));
        } else {
            accessLog.setResultCode(GlobalErrorCodeConstants.SUCCESS.getCode());
            accessLog.setResultMsg("");
        }
        accessLog.setTraceId(TracerUtils.getTraceId());
        accessLog.setApplicationName(applicationName);
        accessLog.setRequestUrl(request.getRequestURI());
        accessLog.setRequestMethod(request.getMethod());
        accessLog.setUserAgent(ServletUtils.getUserAgent(request));
        accessLog.setUserIp(ServletUtils.getClientIP(request));
        String[] sanitizeKeys = accessLogAnnotation != null ? accessLogAnnotation.sanitizeKeys() : null;
        Boolean requestEnable = accessLogAnnotation != null ? accessLogAnnotation.requestEnable() : Boolean.TRUE;
        if (!BooleanUtil.isFalse(requestEnable)) {
            Map<String, Object> requestParams = MapUtil.<String, Object>builder()
                    .put("query", sanitizeMap(queryString, sanitizeKeys))
                    .put("body", sanitizeJson(requestBody, sanitizeKeys)).build();
            accessLog.setRequestParams(toJsonString(requestParams));
        }
        Boolean responseEnable = accessLogAnnotation != null ? accessLogAnnotation.responseEnable() : Boolean.FALSE;
        if (BooleanUtil.isTrue(responseEnable)) {
            accessLog.setResponseBody(sanitizeJson(result, sanitizeKeys));
        }
        accessLog.setBeginTime(beginTime);
        accessLog.setEndTime(LocalDateTime.now());
        accessLog.setDuration((int) LocalDateTimeUtil.between(
                accessLog.getBeginTime(), accessLog.getEndTime(), ChronoUnit.MILLIS));

        if (handlerMethod != null) {
            Tag tagAnnotation = handlerMethod.getBeanType().getAnnotation(Tag.class);
            Operation operationAnnotation = handlerMethod.getMethodAnnotation(Operation.class);
            String operateModule = accessLogAnnotation != null && StrUtil.isNotBlank(accessLogAnnotation.operateModule()) ?
                    accessLogAnnotation.operateModule() :
                    tagAnnotation != null ? StrUtil.nullToDefault(tagAnnotation.name(), tagAnnotation.description()) : null;
            String operateName = accessLogAnnotation != null && StrUtil.isNotBlank(accessLogAnnotation.operateName()) ?
                    accessLogAnnotation.operateName() :
                    operationAnnotation != null ? operationAnnotation.summary() : null;
            OperateTypeEnum operateType = accessLogAnnotation != null && accessLogAnnotation.operateType().length > 0 ?
                    accessLogAnnotation.operateType()[0] : parseOperateLogType(request);
            accessLog.setOperateModule(operateModule);
            accessLog.setOperateName(operateName);
            accessLog.setOperateType(operateType.getType());
        }
        return true;
    }

    /**
     * 将 HTTP 方法映射为操作类型。
     *
     * @param request 请求
     * @return 操作类型；未知方法返回 OTHER
     */
    private static OperateTypeEnum parseOperateLogType(HttpServletRequest request) {
        RequestMethod requestMethod = RequestMethod.resolve(request.getMethod());
        if (requestMethod == null) {
            return OperateTypeEnum.OTHER;
        }
        switch (requestMethod) {
            case GET:
                return OperateTypeEnum.GET;
            case POST:
                return OperateTypeEnum.CREATE;
            case PUT:
                return OperateTypeEnum.UPDATE;
            case DELETE:
                return OperateTypeEnum.DELETE;
            default:
                return OperateTypeEnum.OTHER;
        }
    }

    /**
     * 移除查询参数中的默认及自定义敏感字段后序列化。
     *
     * @param map 查询参数
     * @param sanitizeKeys 自定义敏感字段
     * @return 脱敏后的 JSON；空参数返回 null
     */
    private static String sanitizeMap(Map<String, ?> map, String[] sanitizeKeys) {
        if (CollUtil.isEmpty(map)) {
            return null;
        }
        Map<String, Object> sanitizedMap = MapUtil.newHashMap(map.size());
        sanitizedMap.putAll(map);
        sanitizedMap.keySet().removeIf(key -> SensitiveDataUtils.isSensitiveKey(key, sanitizeKeys));
        return toJsonString(sanitizedMap);
    }

    /**
     * 递归移除请求 JSON 中的默认及自定义敏感字段。
     *
     * @param jsonString 请求 JSON
     * @param sanitizeKeys 自定义敏感字段
     * @return 脱敏后的 JSON；解析失败返回安全占位内容
     */
    private static String sanitizeJson(String jsonString, String[] sanitizeKeys) {
        if (StrUtil.isEmpty(jsonString)) {
            return null;
        }
        try {
            JsonNode rootNode = JsonUtils.parseTree(jsonString);
            sanitizeJson(rootNode, sanitizeKeys);
            return toJsonString(rootNode);
        } catch (Exception e) {
            log.warn("[sanitizeJson][payloadLength({}) 脱敏失败，降级为占位内容，exception({})]",
                    jsonString.length(), e.getClass().getSimpleName());
            return SANITIZE_FAILURE_PLACEHOLDER;
        }
    }

    /**
     * 递归移除响应 data 中的默认及自定义敏感字段。
     *
     * @param commonResult 通用响应
     * @param sanitizeKeys 自定义敏感字段
     * @return 脱敏后的 JSON；解析失败返回安全占位内容
     */
    private static String sanitizeJson(CommonResult<?> commonResult, String[] sanitizeKeys) {
        if (commonResult == null) {
            return null;
        }
        String jsonString = toJsonString(commonResult);
        try {
            JsonNode rootNode = JsonUtils.parseTree(jsonString);
            sanitizeJson(rootNode.get("data"), sanitizeKeys);
            return toJsonString(rootNode);
        } catch (Exception e) {
            log.warn("[sanitizeJson][resultCode({}) payloadLength({}) 脱敏失败，降级为占位内容，exception({})]",
                    commonResult.getCode(), jsonString.length(), e.getClass().getSimpleName());
            return SANITIZE_FAILURE_PLACEHOLDER;
        }
    }

    /**
     * 遍历 JSON 节点并原地移除敏感字段。
     *
     * @param node JSON 节点
     * @param sanitizeKeys 自定义敏感字段
     */
    private static void sanitizeJson(JsonNode node, String[] sanitizeKeys) {
        if (node == null) {
            return;
        }
        if (node.isArray()) {
            for (JsonNode childNode : node) {
                sanitizeJson(childNode, sanitizeKeys);
            }
            return;
        }
        if (!node.isObject()) {
            return;
        }
        Iterator<Map.Entry<String, JsonNode>> iterator = node.properties().iterator();
        while (iterator.hasNext()) {
            Map.Entry<String, JsonNode> entry = iterator.next();
            if (SensitiveDataUtils.isSensitiveKey(entry.getKey(), sanitizeKeys)) {
                iterator.remove();
                continue;
            }
            sanitizeJson(entry.getValue(), sanitizeKeys);
        }
    }

}
