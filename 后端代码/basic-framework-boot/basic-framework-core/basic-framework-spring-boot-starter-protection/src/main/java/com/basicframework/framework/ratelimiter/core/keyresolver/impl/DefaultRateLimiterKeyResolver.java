package com.basicframework.framework.ratelimiter.core.keyresolver.impl;

import cn.hutool.crypto.SecureUtil;
import com.basicframework.framework.protection.core.keyresolver.KeyResolverUtils;
import com.basicframework.framework.ratelimiter.core.annotation.RateLimiter;
import com.basicframework.framework.ratelimiter.core.keyresolver.RateLimiterKeyResolver;
import org.aspectj.lang.JoinPoint;

/**
 * 默认（全局级别）限流 Key 解析器，使用方法名 + 方法参数，组装成一个 Key
 *
 * 为了避免 Key 过长，使用 MD5 进行“压缩”
 *
 * @author 李杰
 */
public class DefaultRateLimiterKeyResolver implements RateLimiterKeyResolver {

    /**
     * 解析当前扩展点对应的业务值。
     *
     * @param joinPoint joinPoint 参数
     * @param rateLimiter rateLimiter 参数
     * @return 查询或转换后的结果
     */
    @Override
    public String resolver(JoinPoint joinPoint, RateLimiter rateLimiter) {
        String methodName = joinPoint.getSignature().toString();
        String argsStr = KeyResolverUtils.joinMethodArgs(joinPoint);
        return SecureUtil.md5(methodName + argsStr);
    }

}
