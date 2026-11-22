package com.basicframework.framework.operatelog.core.aop;

import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.biz.system.logger.OperateLogCommonApi;
import com.basicframework.framework.common.biz.system.logger.dto.OperateLogCreateReqDTO;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.util.monitor.TracerUtils;
import com.basicframework.framework.common.util.servlet.ServletUtils;
import com.basicframework.framework.operatelog.core.annotation.OperateLog;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.core.DefaultParameterNameDiscoverer;
import org.springframework.core.ParameterNameDiscoverer;
import org.springframework.expression.EvaluationContext;
import org.springframework.expression.ExpressionParser;
import org.springframework.expression.common.TemplateParserContext;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import org.springframework.expression.spel.support.SimpleEvaluationContext;

import java.lang.reflect.Method;

/**
 * 原生 Spring AOP 操作审计日志切面，替代第三方 bizlog-sdk。
 *
 * @author 李杰
 */
@Aspect
@Slf4j
@RequiredArgsConstructor
public class OperateLogAspect {

    private static final long SYSTEM_USER_ID = 0L;
    private static final ExpressionParser EXPRESSION_PARSER = new SpelExpressionParser();
    private static final TemplateParserContext TEMPLATE_CONTEXT = new TemplateParserContext("#{", "}");
    private static final ParameterNameDiscoverer PARAMETER_NAME_DISCOVERER = new DefaultParameterNameDiscoverer();

    private final ObjectProvider<OperateLogCommonApi> operateLogApiProvider;

    /**
     * 环绕拦截带 {@link OperateLog} 注解的方法，在业务成功完成后异步记录审计日志。
     *
     * @param joinPoint 切点
     * @param operateLog 操作日志注解
     * @return 原方法返回值
     * @throws Throwable 原方法抛出的异常原样传播
     */
    @Around("@annotation(operateLog)")
    public Object around(ProceedingJoinPoint joinPoint, OperateLog operateLog) throws Throwable {
        Object result = joinPoint.proceed();
        recordSafely(joinPoint, operateLog, result);
        return result;
    }

    private void recordSafely(ProceedingJoinPoint joinPoint, OperateLog operateLog, Object result) {
        OperateLogCommonApi operateLogApi = operateLogApiProvider.getIfAvailable();
        if (operateLogApi == null) {
            return;
        }
        OperateLogCreateReqDTO reqDTO = new OperateLogCreateReqDTO();
        try {
            EvaluationContext context = buildContext(joinPoint, result);
            reqDTO.setTraceId(TracerUtils.getTraceId());
            fillUserFields(reqDTO);
            reqDTO.setType(operateLog.type());
            reqDTO.setSubType(operateLog.subType());
            reqDTO.setBizId(resolveBizId(operateLog.bizId(), context));
            reqDTO.setAction(resolveAction(operateLog, context));
            reqDTO.setExtra("{}");
            fillRequestFields(reqDTO);
            operateLogApi.createOperateLogAsync(reqDTO);
        } catch (Exception ex) {
            log.error("[recordSafely][type({}) subType({}) bizId({}) 记录操作日志异常]",
                    operateLog.type(), operateLog.subType(), reqDTO.getBizId(), ex);
        }
    }

    private static EvaluationContext buildContext(ProceedingJoinPoint joinPoint, Object result) {
        SimpleEvaluationContext context = SimpleEvaluationContext.forReadOnlyDataBinding().build();
        context.setVariable("result", result);
        if (joinPoint.getSignature() instanceof MethodSignature signature) {
            Method method = signature.getMethod();
            String[] paramNames = PARAMETER_NAME_DISCOVERER.getParameterNames(method);
            Object[] args = joinPoint.getArgs();
            if (paramNames != null) {
                for (int i = 0; i < Math.min(paramNames.length, args.length); i++) {
                    context.setVariable(paramNames[i], args[i]);
                }
            }
        }
        return context;
    }

    private static Long resolveBizId(String bizIdExpr, EvaluationContext context) {
        if (StrUtil.isBlank(bizIdExpr)) {
            return 0L;
        }
        try {
            Object value = EXPRESSION_PARSER.parseExpression(bizIdExpr).getValue(context);
            if (value instanceof Number number) {
                return number.longValue();
            }
            if (value instanceof String str && StrUtil.isNotBlank(str)) {
                return Long.parseLong(str.trim());
            }
        } catch (Exception ex) {
            log.debug("[resolveBizId][expr({}) 解析失败，降级为 0]", bizIdExpr, ex);
        }
        return 0L;
    }

    private static String resolveAction(OperateLog operateLog, EvaluationContext context) {
        String template = operateLog.action();
        if (StrUtil.isBlank(template)) {
            return operateLog.subType();
        }
        if (!template.contains("#{")) {
            return template;
        }
        try {
            String evaluated = EXPRESSION_PARSER.parseExpression(template, TEMPLATE_CONTEXT)
                    .getValue(context, String.class);
            return StrUtil.isNotBlank(evaluated) ? evaluated : operateLog.subType();
        } catch (Exception ex) {
            log.debug("[resolveAction][template({}) 解析失败，降级为 subType]", template, ex);
            return operateLog.subType();
        }
    }

    private static void fillUserFields(OperateLogCreateReqDTO reqDTO) {
        LoginUser loginUser = SecurityFrameworkUtils.getLoginUser();
        if (loginUser == null) {
            reqDTO.setUserId(SYSTEM_USER_ID);
            reqDTO.setUserType(UserTypeEnum.ADMIN.getValue());
            return;
        }
        reqDTO.setUserId(loginUser.getId());
        reqDTO.setUserType(loginUser.getUserType());
    }

    private static void fillRequestFields(OperateLogCreateReqDTO reqDTO) {
        HttpServletRequest request = ServletUtils.getRequest();
        if (request == null) {
            reqDTO.setRequestMethod("INTERNAL");
            reqDTO.setRequestUrl("");
            reqDTO.setUserIp("");
            reqDTO.setUserAgent("");
            return;
        }
        reqDTO.setRequestMethod(request.getMethod());
        reqDTO.setRequestUrl(request.getRequestURI());
        reqDTO.setUserIp(StrUtil.blankToDefault(ServletUtils.getClientIP(request), ""));
        reqDTO.setUserAgent(StrUtil.blankToDefault(ServletUtils.getUserAgent(request), ""));
    }

}
