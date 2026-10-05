package com.basicframework.framework.idempotent.core.aop;

import cn.hutool.core.lang.Assert;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants;
import com.basicframework.framework.common.util.collection.CollectionUtils;
import com.basicframework.framework.idempotent.core.annotation.Idempotent;
import com.basicframework.framework.idempotent.core.keyresolver.IdempotentKeyResolver;
import com.basicframework.framework.idempotent.core.redis.IdempotentRedisDAO;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;

import java.util.List;
import java.util.Map;

/**
 * 拦截声明了 {@link Idempotent} 注解的方法，实现幂等操作
 *
 * @author 李杰
 */
@Aspect
@Slf4j
public class IdempotentAspect {

    /**
     * IdempotentKeyResolver 集合
     */
    private final Map<Class<? extends IdempotentKeyResolver>, IdempotentKeyResolver> keyResolvers;

    /**
     * 幂等 Redis 访问对象
     */
    private final IdempotentRedisDAO idempotentRedisDAO;

    /**
     * 构造幂等切面，并按解析器类型建立索引，便于注解按类型选择解析器。
     *
     * @param keyResolvers       幂等 Key 解析器集合
     * @param idempotentRedisDAO 幂等 Redis 访问对象
     */
    public IdempotentAspect(List<IdempotentKeyResolver> keyResolvers, IdempotentRedisDAO idempotentRedisDAO) {
        this.keyResolvers = CollectionUtils.convertMap(keyResolvers, IdempotentKeyResolver::getClass);
        this.idempotentRedisDAO = idempotentRedisDAO;
    }

    /**
     * 执行幂等拦截，先写入幂等 Key，重复写入失败时拒绝请求。
     *
     * @param joinPoint  被拦截方法
     * @param idempotent 幂等注解
     * @return 被拦截方法的执行结果
     * @throws Throwable 被拦截方法抛出的异常
     */
    @Around(value = "@annotation(idempotent)")
    @SuppressWarnings("PMD.AvoidCatchingThrowable") // 释放幂等 Key 必须覆盖 Error，否则 Key 会被永久占用；catch 内紧接着原样 rethrow，失败没有被吞掉。
    public Object aroundPointCut(ProceedingJoinPoint joinPoint, Idempotent idempotent) throws Throwable {
        // 获得 IdempotentKeyResolver
        IdempotentKeyResolver keyResolver = keyResolvers.get(idempotent.keyResolver());
        Assert.notNull(keyResolver, "找不到对应的 IdempotentKeyResolver");
        // 解析 Key
        String key = keyResolver.resolver(joinPoint, idempotent);

        // 1. 锁定 Key
        boolean success = idempotentRedisDAO.setIfAbsent(key, idempotent.timeout(), idempotent.timeUnit());
        // 锁定失败，抛出异常
        if (!success) {
            log.info("[aroundPointCut][method({}) 存在重复请求]", joinPoint.getSignature().toShortString());
            throw new ServiceException(GlobalErrorCodeConstants.REPEATED_REQUESTS.getCode(), idempotent.message());
        }

        // 2. 执行逻辑
        try {
            return joinPoint.proceed();
        } catch (Throwable throwable) {
            // 3. 异常时，删除 Key
            // 参考美团 GTIS 思路：https://tech.meituan.com/2016/09/29/distributed-system-mutually-exclusive-idempotence-cerberus-gtis.html
            if (idempotent.deleteKeyWhenException()) {
                idempotentRedisDAO.delete(key);
            }
            throw throwable;
        }
    }

}
