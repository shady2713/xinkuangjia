package com.basicframework.framework.ratelimiter.core.keyresolver;

import com.basicframework.framework.ratelimiter.core.annotation.RateLimiter;
import org.aspectj.lang.JoinPoint;

/**
 * 限流 Key 解析器接口
 *
 * @author 李杰
 */
public interface RateLimiterKeyResolver {

    /**
     * 解析一个 Key
     *
     * @param joinPoint  AOP 切面
     * @param rateLimiter 限流注解
     * @return Key
     */
    String resolver(JoinPoint joinPoint, RateLimiter rateLimiter);

}
