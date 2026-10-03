package com.basicframework.framework.lock4j.core;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证获取分布式锁失败时统一抛出业务异常，而不是让原始的锁异常泄漏到业务层。
 *
 * <p>抢锁失败是业务上可预期的并发结果，如果让 Redisson 或 lock4j 的原始异常直接冒泡，接口会返回 500，
 * 前端也无法区分“系统故障”和“有人在提交同一笔业务”。这里锁定错误码、错误提示以及方法参数缺失时
 * 仍能给出同样的结果。</p>
 *
 * @author shady2713
 */
class DefaultLockFailureStrategyTest {

    /**
     * 验证抢锁失败抛出统一的锁定异常。
     *
     * <p>错误码与提示必须与全局常量一致，接入方才能按统一约定处理锁定冲突。</p>
     */
    @Test
    @DisplayName("抢锁失败抛出统一的锁定异常")
    void shouldThrowServiceExceptionWhenLockAcquisitionFails() {
        DefaultLockFailureStrategy strategy = new DefaultLockFailureStrategy();
        Method method = probeMethod();

        assertThatThrownBy(() -> strategy.onLockFailure("lock-key", method, new Object[]{1}))
                .isInstanceOf(ServiceException.class)
                .satisfies(exception -> {
                    ServiceException serviceException = (ServiceException) exception;
                    assertThat(serviceException.getCode())
                            .isEqualTo(GlobalErrorCodeConstants.LOCKED.getCode());
                    assertThat(serviceException.getMessage())
                            .isEqualTo(GlobalErrorCodeConstants.LOCKED.getMsg());
                });
    }

    /**
     * 验证被加锁方法为空时仍抛出同样的异常。
     *
     * <p>方法信息只用于记录日志，不应影响对外错误语义；漏判空会让抢锁失败本身再抛一个空指针异常，
     * 把真正的原因掩盖掉。</p>
     */
    @Test
    @DisplayName("被加锁方法为空时仍抛出同样的锁定异常")
    void shouldThrowSameExceptionWhenMethodIsNull() {
        DefaultLockFailureStrategy strategy = new DefaultLockFailureStrategy();

        assertThatThrownBy(() -> strategy.onLockFailure("lock-key", null, null))
                .isInstanceOf(ServiceException.class)
                .satisfies(exception -> assertThat(((ServiceException) exception).getCode())
                        .isEqualTo(GlobalErrorCodeConstants.LOCKED.getCode()));
    }

    /**
     * 锁定失败策略的日志与异常都不应泄漏方法参数，避免敏感数据进入日志。
     *
     * <p>方法参数可能包含手机号、令牌等敏感内容，策略只把锁 Key 与方法名写进日志。</p>
     */
    @Test
    @DisplayName("锁定失败策略不把方法参数带入异常消息")
    void shouldNotLeakMethodArgumentsIntoExceptionMessage() {
        DefaultLockFailureStrategy strategy = new DefaultLockFailureStrategy();
        Method method = probeMethod();

        assertThatThrownBy(() -> strategy.onLockFailure("lock-key", method, new Object[]{"secret-token"}))
                .isInstanceOf(ServiceException.class)
                .satisfies(exception -> assertThat(((ServiceException) exception).getMessage())
                        .doesNotContain("secret-token"));
    }

    /**
     * 取得占位类型上被加锁方法的反射对象。
     *
     * <p>方法名写错属于用例自身的错误，因此直接包装成非受检异常抛出，不让每个用例都写 try/catch。</p>
     *
     * @return 被加锁方法的反射对象
     */
    private static Method probeMethod() {
        try {
            return Probe.class.getDeclaredMethod("submit", String.class);
        } catch (NoSuchMethodException exception) {
            throw new IllegalStateException("占位类型上不存在方法: submit", exception);
        }
    }

    /**
     * 提供一个被加锁方法的占位类型，用于构造方法签名。
     */
    static class Probe {

        /**
         * 占位方法，只用于取得真实的 {@link Method} 反射对象。
         *
         * @param payload 方法参数
         * @return 固定标记
         */
        public String submit(String payload) {
            return payload;
        }
    }
}
