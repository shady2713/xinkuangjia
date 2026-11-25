package com.basicframework.framework.web.core.handler;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.ObjUtil;
import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.exception.util.ServiceExceptionUtil;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.util.monitor.TracerUtils;
import com.basicframework.framework.web.core.util.WebFrameworkUtils;
import com.fasterxml.jackson.databind.exc.InvalidFormatException;
import com.google.common.util.concurrent.UncheckedExecutionException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.ValidationException;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.validation.BindException;
import org.springframework.validation.FieldError;
import org.springframework.validation.ObjectError;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.List;
import java.util.Set;

import static com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants.*;

/**
 * 全局异常处理器，将 Exception 翻译成 CommonResult + 对应的异常编号
 *
 * @author 李杰
 */
@RestControllerAdvice
@AllArgsConstructor
@Slf4j
public class GlobalExceptionHandler {

    /**
     * 忽略的 ServiceException 错误提示，避免打印过多 logger
     */
    public static final Set<String> IGNORE_ERROR_MESSAGES = CollUtil.newHashSet("无效的刷新令牌");

    @SuppressWarnings("SpringJavaInjectionPointsAutowiringInspection")
    private final String applicationName;

    /**
     * 处理所有异常，主要是提供给 Filter 使用
     * 因为 Filter 不走 SpringMVC 的流程，但是我们又需要兜底处理异常，所以这里提供一个全量的异常处理过程，保持逻辑统一。
     *
     * @param request 请求
     * @param ex 异常
     * @return 通用返回
     */
    public CommonResult<?> allExceptionHandler(HttpServletRequest request, Throwable ex) {
        if (ex instanceof MissingServletRequestParameterException) {
            return missingServletRequestParameterExceptionHandler((MissingServletRequestParameterException) ex);
        }
        if (ex instanceof MethodArgumentTypeMismatchException) {
            return methodArgumentTypeMismatchExceptionHandler((MethodArgumentTypeMismatchException) ex);
        }
        if (ex instanceof MethodArgumentNotValidException) {
            return methodArgumentNotValidExceptionExceptionHandler((MethodArgumentNotValidException) ex);
        }
        if (ex instanceof BindException) {
            return bindExceptionHandler((BindException) ex);
        }
        if (ex instanceof ConstraintViolationException) {
            return constraintViolationExceptionHandler((ConstraintViolationException) ex);
        }
        if (ex instanceof ValidationException) {
            return validationException((ValidationException) ex);
        }
        if (ex instanceof MaxUploadSizeExceededException) {
            return maxUploadSizeExceededExceptionHandler((MaxUploadSizeExceededException) ex);
        }
        if (ex instanceof NoHandlerFoundException) {
            return noHandlerFoundExceptionHandler((NoHandlerFoundException) ex);
        }
        if (ex instanceof NoResourceFoundException) {
            return noResourceFoundExceptionHandler((NoResourceFoundException) ex);
        }
        if (ex instanceof HttpRequestMethodNotSupportedException) {
            return httpRequestMethodNotSupportedExceptionHandler((HttpRequestMethodNotSupportedException) ex);
        }
        if (ex instanceof HttpMediaTypeNotSupportedException) {
            return httpMediaTypeNotSupportedExceptionHandler((HttpMediaTypeNotSupportedException) ex);
        }
        if (ex instanceof ServiceException) {
            return serviceExceptionHandler((ServiceException) ex);
        }
        if (ex instanceof AccessDeniedException) {
            return accessDeniedExceptionHandler(request, (AccessDeniedException) ex);
        }
        return defaultExceptionHandler(request, ex);
    }

    /**
     * 处理 SpringMVC 请求参数缺失
     *
     * 例如说，接口上设置了 @RequestParam("xx") 参数，结果并未传递 xx 参数
     */
    @ExceptionHandler(value = MissingServletRequestParameterException.class)
    public CommonResult<?> missingServletRequestParameterExceptionHandler(MissingServletRequestParameterException ex) {
        log.warn("[missingServletRequestParameterExceptionHandler]", ex);
        return CommonResult.error(BAD_REQUEST.getCode(), String.format("请求参数缺失:%s", ex.getParameterName()));
    }

    /**
     * 处理 SpringMVC 请求参数类型错误
     *
     * 例如说，接口上设置了 @RequestParam("xx") 参数为 Integer，结果传递 xx 参数类型为 String
     */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public CommonResult<?> methodArgumentTypeMismatchExceptionHandler(MethodArgumentTypeMismatchException ex) {
        String paramName = StrUtil.blankToDefault(ex.getName(), "未知参数");
        // 仅记录参数名与目标类型，避免把原始请求值或转换异常消息写入日志
        log.warn("[methodArgumentTypeMismatchExceptionHandler][param({}) requiredType({})]", paramName,
                ex.getRequiredType() != null ? ex.getRequiredType().getSimpleName() : null);
        return CommonResult.error(BAD_REQUEST.getCode(), String.format("请求参数类型错误:%s", paramName));
    }

    /**
     * 处理 SpringMVC 参数校验不正确
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public CommonResult<?> methodArgumentNotValidExceptionExceptionHandler(MethodArgumentNotValidException ex) {
        // 获取 errorMessage
        String errorMessage = null;
        FieldError fieldError = ex.getBindingResult().getFieldError();
        logValidationMetadata("methodArgumentNotValidExceptionExceptionHandler", fieldError,
                ex.getBindingResult().getErrorCount());
        if (fieldError == null) {
            // 组合校验时，尝试从全量错误信息中提取提示
            List<ObjectError> allErrors = ex.getBindingResult().getAllErrors();
            if (CollUtil.isNotEmpty(allErrors)) {
                errorMessage = allErrors.get(0).getDefaultMessage();
            }
        } else {
            errorMessage = fieldError.getDefaultMessage();
        }
        // 转换 CommonResult
        if (StrUtil.isEmpty(errorMessage)) {
            return CommonResult.error(BAD_REQUEST);
        }
        return CommonResult.error(BAD_REQUEST.getCode(), errorMessage);
    }

    /**
     * 处理 SpringMVC 参数绑定不正确，本质上也是通过 Validator 校验
     *
     * @param ex 参数绑定异常
     * @return 稳定的参数错误响应
     */
    @ExceptionHandler(BindException.class)
    public CommonResult<?> bindExceptionHandler(BindException ex) {
        FieldError fieldError = ex.getFieldError();
        logValidationMetadata("handleBindException", fieldError, ex.getErrorCount());
        if (fieldError != null) {
            return CommonResult.error(BAD_REQUEST.getCode(), fieldError.getDefaultMessage());
        }
        ObjectError objectError = CollUtil.getFirst(ex.getAllErrors());
        String message = objectError != null ? objectError.getDefaultMessage() : "请求参数校验失败";
        return CommonResult.error(BAD_REQUEST.getCode(), message);
    }

    /**
     * 处理 SpringMVC 请求参数类型错误
     *
     * 例如说，接口上设置了 @RequestBody 实体中 xx 属性类型为 Integer，结果传递 xx 参数类型为 String
     */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    @SuppressWarnings("PatternVariableCanBeUsed")
    public CommonResult<?> methodArgumentTypeInvalidFormatExceptionHandler(HttpMessageNotReadableException ex) {
        // 反序列化异常消息可能回显请求体原文，仅记录异常类型
        log.warn("[methodArgumentTypeInvalidFormatExceptionHandler][cause({})]",
                ex.getCause() != null ? ex.getCause().getClass().getSimpleName() : null);
        if (ex.getCause() instanceof InvalidFormatException) {
            InvalidFormatException invalidFormatException = (InvalidFormatException) ex.getCause();
            String fieldName = CollUtil.isNotEmpty(invalidFormatException.getPath())
                    ? invalidFormatException.getPath().get(invalidFormatException.getPath().size() - 1).getFieldName()
                    : null;
            String message = StrUtil.isNotBlank(fieldName)
                    ? String.format("请求参数类型错误:%s", fieldName)
                    : "请求参数类型错误";
            return CommonResult.error(BAD_REQUEST.getCode(), message);
        }
        if (StrUtil.startWith(ex.getMessage(), "Required request body is missing")) {
            return CommonResult.error(BAD_REQUEST.getCode(), "请求参数类型错误: request body 缺失");
        }
        return CommonResult.error(BAD_REQUEST.getCode(), "请求参数格式错误");
    }

    /**
     * 处理 Validator 校验不通过产生的异常
     */
    @ExceptionHandler(value = ConstraintViolationException.class)
    public CommonResult<?> constraintViolationExceptionHandler(ConstraintViolationException ex) {
        ConstraintViolation<?> constraintViolation = ex.getConstraintViolations().iterator().next();
        log.warn("[constraintViolationExceptionHandler][path({}) violationCount({})]",
                constraintViolation.getPropertyPath(), ex.getConstraintViolations().size());
        return CommonResult.error(BAD_REQUEST.getCode(), constraintViolation.getMessage());
    }

    /**
     * 处理 Dubbo Consumer 本地参数校验时，抛出的 ValidationException 异常
     */
    @ExceptionHandler(value = ValidationException.class)
    public CommonResult<?> validationException(ValidationException ex) {
        // ValidationException 的消息为非结构化字符串，可能包含原始入参，仅记录异常类型
        log.warn("[constraintViolationExceptionHandler][type({})]", ex.getClass().getSimpleName());
        // 无法拼接明细的错误信息，因为 Dubbo Consumer 抛出 ValidationException 异常时，是直接的字符串信息，且人类不可读
        return CommonResult.error(BAD_REQUEST);
    }

    /**
     * 处理上传文件过大异常
     */
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public CommonResult<?> maxUploadSizeExceededExceptionHandler(MaxUploadSizeExceededException ex) {
        return CommonResult.error(BAD_REQUEST.getCode(), "上传文件过大，请调整后重试");
    }

    /**
     * 处理 SpringMVC 请求地址不存在
     *
     * 注意，它需要设置如下两个配置项：
     * 1. spring.mvc.throw-exception-if-no-handler-found 为 true
     * 2. spring.mvc.static-path-pattern 为 /statics/**
     */
    @ExceptionHandler(NoHandlerFoundException.class)
    public CommonResult<?> noHandlerFoundExceptionHandler(NoHandlerFoundException ex) {
        log.warn("[noHandlerFoundExceptionHandler]", ex);
        return CommonResult.error(NOT_FOUND.getCode(), String.format("请求地址不存在:%s", ex.getRequestURL()));
    }

    /**
     * 处理 SpringMVC 请求地址不存在
     */
    @ExceptionHandler(NoResourceFoundException.class)
    private CommonResult<?> noResourceFoundExceptionHandler(NoResourceFoundException ex) {
        log.warn("[noResourceFoundExceptionHandler]", ex);
        return CommonResult.error(NOT_FOUND.getCode(), String.format("请求地址不存在:%s", ex.getResourcePath()));
    }

    /**
     * 处理 SpringMVC 请求方法不正确
     *
     * 例如说，A 接口的方法为 GET 方式，结果请求方法为 POST 方式，导致不匹配
     */
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public CommonResult<?> httpRequestMethodNotSupportedExceptionHandler(HttpRequestMethodNotSupportedException ex) {
        log.warn("[httpRequestMethodNotSupportedExceptionHandler]", ex);
        return CommonResult.error(METHOD_NOT_ALLOWED.getCode(), String.format("请求方法不正确:%s", ex.getMessage()));
    }

    /**
     * 处理 SpringMVC 请求的 Content-Type 不正确
     *
     * 例如说，A 接口的 Content-Type 为 application/json，结果请求的 Content-Type 为 application/octet-stream，导致不匹配
     */
    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public CommonResult<?> httpMediaTypeNotSupportedExceptionHandler(HttpMediaTypeNotSupportedException ex) {
        log.warn("[httpMediaTypeNotSupportedExceptionHandler]", ex);
        return CommonResult.error(BAD_REQUEST.getCode(), String.format("请求类型不正确:%s", ex.getMessage()));
    }

    /**
     * 处理 Spring Security 权限不足的异常
     *
     * 来源是，使用 @PreAuthorize 注解，AOP 进行权限拦截
     */
    @ExceptionHandler(value = AccessDeniedException.class)
    public CommonResult<?> accessDeniedExceptionHandler(HttpServletRequest req, AccessDeniedException ex) {
        log.warn("[accessDeniedExceptionHandler][userId({}) 无法访问 url({})]", WebFrameworkUtils.getLoginUserId(req),
                req.getRequestURL(), ex);
        return CommonResult.error(FORBIDDEN);
    }

    /**
     * 处理 Guava UncheckedExecutionException
     *
     * 例如说，缓存加载报错时，会被包装成该异常
     */
    @ExceptionHandler(value = UncheckedExecutionException.class)
    public CommonResult<?> uncheckedExecutionExceptionHandler(HttpServletRequest req, UncheckedExecutionException ex) {
        return allExceptionHandler(req, ex.getCause() != null ? ex.getCause() : ex);
    }

    /**
     * 处理业务异常 ServiceException
     *
     * 例如说，商品库存不足，用户手机号已存在。
     */
    @ExceptionHandler(value = ServiceException.class)
    public CommonResult<?> serviceExceptionHandler(ServiceException ex) {
        // 不包含的时候，才进行打印，避免 ex 堆栈过多
        if (!IGNORE_ERROR_MESSAGES.contains(ex.getMessage())) {
            // 即使打印，也只打印第一层 StackTraceElement，并且使用 warn 在控制台输出，更容易看到
            try {
                StackTraceElement[] stackTraces = ex.getStackTrace();
                for (StackTraceElement stackTrace : stackTraces) {
                    if (ObjUtil.notEqual(stackTrace.getClassName(), ServiceExceptionUtil.class.getName())) {
                        log.warn("[serviceExceptionHandler]\n\t{}", stackTrace);
                        break;
                    }
                }
            } catch (Exception ignored) {
                // 忽略日志，避免影响主流程
            }
        }
        return CommonResult.error(ex.getCode(), ex.getMessage());
    }

    /**
     * 处理系统异常，兜底处理所有的一切
     */
    @ExceptionHandler(value = Exception.class)
    public CommonResult<?> defaultExceptionHandler(HttpServletRequest req, Throwable ex) {
        // 特殊：如果是 ServiceException 的异常，则直接返回
        // 例如说：https://example.com/external/basicframework/basic_framework-cloud/issues/ICSSRM、https://example.com/external/basicframework/basic_framework-cloud/issues/ICT6FM
        if (ex.getCause() != null && ex.getCause() instanceof ServiceException) {
            return serviceExceptionHandler((ServiceException) ex.getCause());
        }
        // 处理数据库唯一索引冲突
        CommonResult<?> sqlResult = handleSqlException(ex);
        if (sqlResult != null) {
            return sqlResult;
        }
        // 仅记录请求定位元数据与异常堆栈，不输出 query/body 内容，也不写入无 UI 消费的数据库异常表
        logUnhandledException(req, ex);
        // 返回 ERROR CommonResult
        return CommonResult.error(INTERNAL_SERVER_ERROR.getCode(), INTERNAL_SERVER_ERROR.getMsg());
    }

    private static final int MYSQL_DUPLICATE_KEY_ERROR_CODE = 1062;

    /**
     * 仅将明确的唯一索引冲突（DuplicateKeyException 或 MySQL 1062）转为 400 友好提示；
     * 非唯一约束冲突（如 NOT NULL 1048、外键 1451/1452）留交默认异常处理器记错并返回 500。
     */
    private CommonResult<?> handleSqlException(Throwable ex) {
        Throwable cause = ex;
        while (cause != null) {
            boolean isDuplicateKey = cause instanceof org.springframework.dao.DuplicateKeyException
                    || (cause instanceof java.sql.SQLIntegrityConstraintViolationException sqlEx
                            && sqlEx.getErrorCode() == MYSQL_DUPLICATE_KEY_ERROR_CODE);
            if (isDuplicateKey) {
                String message = cause.getMessage();
                log.warn("[handleSqlException][数据库唯一约束冲突: {}]", message);
                if (message != null && message.contains("uk_code")) {
                    return CommonResult.error(BAD_REQUEST.getCode(), "编码已存在，请更换后重试");
                }
                if (message != null && message.contains("uk_name")) {
                    return CommonResult.error(BAD_REQUEST.getCode(), "名称已存在，请更换后重试");
                }
                return CommonResult.error(BAD_REQUEST.getCode(), "数据已存在，请检查后重试");
            }
            cause = cause.getCause();
        }
        return null;
    }

    /**
     * 将请求定位元数据与异常堆栈输出到应用日志，不记录请求参数与请求体内容。
     *
     * @param req HTTP 请求
     * @param ex 未捕获异常
     */
    private void logUnhandledException(HttpServletRequest req, Throwable ex) {
        log.error("[defaultExceptionHandler][app({}) traceId({}) userId({}) method({}) url({})]",
                applicationName, TracerUtils.getTraceId(), WebFrameworkUtils.getLoginUserId(req),
                req.getMethod(), req.getRequestURI(), ex);
    }

    /**
     * 输出参数校验失败的安全元数据（字段名、约束编码、错误数），不记录被拒绝的原始值。
     *
     * @param handler 处理器标识
     * @param fieldError 首个字段错误，可能为空
     * @param errorCount 错误总数
     */
    private static void logValidationMetadata(String handler, FieldError fieldError, int errorCount) {
        log.warn("[{}][field({}) code({}) errorCount({})]", handler,
                fieldError != null ? fieldError.getField() : null,
                fieldError != null ? fieldError.getCode() : null, errorCount);
    }

}
