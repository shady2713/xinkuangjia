package com.basicframework.framework.ratelimiter.core.keyresolver.impl;

import cn.hutool.core.util.ArrayUtil;
import com.basicframework.framework.ratelimiter.core.annotation.RateLimiter;
import com.basicframework.framework.ratelimiter.core.keyresolver.RateLimiterKeyResolver;
import org.aspectj.lang.JoinPoint;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.core.DefaultParameterNameDiscoverer;
import org.springframework.core.ParameterNameDiscoverer;
import org.springframework.expression.Expression;
import org.springframework.expression.ExpressionParser;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import org.springframework.expression.spel.support.StandardEvaluationContext;

import java.lang.reflect.Method;

/**
 * 基于 Spring EL 表达式的 {@link RateLimiterKeyResolver} 实现类
 *
 * @author 李杰
 */
public class ExpressionRateLimiterKeyResolver implements RateLimiterKeyResolver {

    /**
     * 方法参数名发现器
     */
    private final ParameterNameDiscoverer parameterNameDiscoverer = new DefaultParameterNameDiscoverer();

    /**
     * Spring EL 表达式解析器
     */
    private final ExpressionParser expressionParser = new SpelExpressionParser();

    /**
     * 解析当前扩展点对应的业务值。
     *
     * @param joinPoint joinPoint 参数
     * @param rateLimiter rateLimiter 参数
     * @return 查询或转换后的结果
     */
    @Override
    public String resolver(JoinPoint joinPoint, RateLimiter rateLimiter) {
        // 获得被拦截方法参数名列表
        Method method = getMethod(joinPoint);
        Object[] args = joinPoint.getArgs();
        String[] parameterNames = this.parameterNameDiscoverer.getParameterNames(method);
        // 准备 Spring EL 表达式解析的上下文
        StandardEvaluationContext evaluationContext = new StandardEvaluationContext();
        if (ArrayUtil.isNotEmpty(parameterNames)) {
            for (int i = 0; i < parameterNames.length; i++) {
                evaluationContext.setVariable(parameterNames[i], args[i]);
            }
        }

        // 解析参数
        Expression expression = expressionParser.parseExpression(rateLimiter.keyArg());
        return expression.getValue(evaluationContext, String.class);
    }

    /**
     * 获取Method。
     */
    private static Method getMethod(JoinPoint point) {
        // 处理，声明在类上的情况
        MethodSignature signature = (MethodSignature) point.getSignature();
        Method method = signature.getMethod();
        if (!method.getDeclaringClass().isInterface()) {
            return method;
        }

        // 处理，声明在接口上的情况
        try {
            return point.getTarget().getClass().getDeclaredMethod(
                    point.getSignature().getName(), method.getParameterTypes());
        } catch (NoSuchMethodException e) {
            throw new RuntimeException(e);
        }
    }

}
