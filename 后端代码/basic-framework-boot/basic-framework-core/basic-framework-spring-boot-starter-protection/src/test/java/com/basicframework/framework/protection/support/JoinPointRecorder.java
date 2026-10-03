package com.basicframework.framework.protection.support;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.aop.aspectj.annotation.AspectJProxyFactory;
import org.aspectj.lang.JoinPoint;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 用真实 Spring AOP 代理产生 {@link JoinPoint}，供保护组件的 Key 解析器测试使用。
 *
 * <p>Key 解析器全部依赖 {@code JoinPoint} 上的方法签名、真实目标与实参，而 {@code MethodSignature.getMethod()}
 * 到底返回接口方法还是实现类方法，会直接改变 {@code ExpressionIdempotentKeyResolver} 等解析器
 * {@code getMethod} 走的分支。用手写的假连接点只能验证“自己写的假数据”，无法证明生产路径，
 * 因此这里通过 {@link AspectJProxyFactory} 生成真实代理并记录真实连接点：目标实现了接口时得到 JDK
 * 代理（签名来自接口方法），否则得到 CGLIB 代理（签名来自实现类方法），两种形态都对应一种生产形态。</p>
 *
 * <p>记录下来的连接点只用于读取签名与实参，不会再次 {@code proceed}，因此每次调用前需要先
 * {@link #reset()}，避免把上一次调用的连接点误当成本次结果。</p>
 *
 * @author shady2713
 */
public final class JoinPointRecorder {

    /** 最近若干次代理调用产生的连接点，按调用顺序保存。 */
    private static final List<JoinPoint> CAPTURED = new ArrayList<>();

    /**
     * 工具类不允许实例化。
     */
    private JoinPointRecorder() {
    }

    /**
     * 为目标创建真实 AOP 代理，所有对代理的调用都会被记录成连接点。
     *
     * <p>目标实现接口时返回 JDK 动态代理，{@code getSignature().getMethod().getDeclaringClass()} 是接口；
     * 目标没有接口时返回 CGLIB 代理，签名来自实现类。解析器对两种形态的处理不同，因此两种都要能造出来。</p>
     *
     * @param target 被代理的目标对象
     * @param <T>    代理的静态类型，需为目标的接口或类
     * @return 记录调用连接点的代理
     */
    public static <T> T proxyFor(T target) {
        AspectJProxyFactory factory = new AspectJProxyFactory(target);
        factory.addAspect(new CapturingAspect());
        @SuppressWarnings("unchecked")
        T proxy = (T) factory.getProxy();
        return proxy;
    }

    /**
     * 取出最近一次代理调用产生的连接点。
     *
     * @return 最近记录的连接点
     */
    public static JoinPoint lastJoinPoint() {
        assertThat(CAPTURED).as("必须先通过代理调用目标方法，才能取得连接点").isNotEmpty();
        return CAPTURED.get(CAPTURED.size() - 1);
    }

    /**
     * 取出最近一次代理调用产生的连接点，并要求连接点的签名确实来自接口方法。
     *
     * <p>解析器对“注解声明在接口方法上”的兼容分支只能这样触发，用它来防止测试悄悄退化成实现类形态
     * 而失去对该分支的覆盖。</p>
     *
     * @return 签名声明在接口上的连接点
     */
    public static JoinPoint lastInterfaceJoinPoint() {
        JoinPoint joinPoint = lastJoinPoint();
        assertThat(joinPoint.getSignature().getDeclaringType().isInterface())
                .as("该用例依赖注解声明在接口方法上的场景，实际签名来自 %s",
                        joinPoint.getSignature().getDeclaringType().getName())
                .isTrue();
        return joinPoint;
    }

    /**
     * 取出最近一次代理调用产生的连接点，并要求连接点的签名声明在实现类上。
     *
     * @return 签名声明在实现类上的连接点
     */
    public static JoinPoint lastClassJoinPoint() {
        JoinPoint joinPoint = lastJoinPoint();
        assertThat(joinPoint.getSignature().getDeclaringType().isInterface())
                .as("该用例依赖注解声明在实现类方法上的场景，实际签名来自 %s",
                        joinPoint.getSignature().getDeclaringType().getName())
                .isFalse();
        return joinPoint;
    }

    /**
     * 清空已记录的连接点，使下一次断言只反映随后的那一次调用。
     */
    public static void reset() {
        CAPTURED.clear();
    }

    /**
     * 记录所有经过代理的方法调用，使测试能拿到真实连接点而不是手工伪造的对象。
     *
     * @author shady2713
     */
    @Aspect
    public static class CapturingAspect {

        /**
         * 记录连接点后继续执行目标方法。
         *
         * @param joinPoint 真实连接点
         * @return 目标方法的返回值
         * @throws Throwable 目标方法抛出的异常
         */
        @Around("execution(* *(..))")
        public Object capture(ProceedingJoinPoint joinPoint) throws Throwable {
            CAPTURED.add(joinPoint);
            return joinPoint.proceed();
        }
    }
}
