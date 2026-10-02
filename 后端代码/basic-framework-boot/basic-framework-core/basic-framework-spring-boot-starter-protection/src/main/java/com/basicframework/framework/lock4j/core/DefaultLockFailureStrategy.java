package com.basicframework.framework.lock4j.core;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants;
import com.baomidou.lock.LockFailureStrategy;
import lombok.extern.slf4j.Slf4j;

import java.lang.reflect.Method;

/**
 * 自定义获取锁失败策略，抛出 {@link ServiceException} 异常
 *
 * @author 李杰
 */
@Slf4j
public class DefaultLockFailureStrategy implements LockFailureStrategy {

    /**
     * 获取分布式锁失败时记录调试日志，并抛出统一业务异常。
     *
     * @param key       锁 Key
     * @param method    被加锁的方法
     * @param arguments 方法参数
     */
    @Override
    public void onLockFailure(String key, Method method, Object[] arguments) {
        log.debug("[onLockFailure][线程({}) method({}) key({}) 获取锁失败]",
                Thread.currentThread().getName(), method != null ? method.getName() : null, key);
        throw new ServiceException(GlobalErrorCodeConstants.LOCKED);
    }
}
