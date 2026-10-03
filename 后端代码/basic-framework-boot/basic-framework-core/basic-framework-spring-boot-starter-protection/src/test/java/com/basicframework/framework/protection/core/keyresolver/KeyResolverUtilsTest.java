package com.basicframework.framework.protection.core.keyresolver;

import com.basicframework.framework.protection.support.JoinPointRecorder;
import jakarta.servlet.http.Cookie;
import org.aspectj.lang.JoinPoint;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.web.util.UriComponentsBuilder;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证保护组件 Key 解析的参数拼接规则。
 *
 * <p>幂等与限流的默认、用户、客户端 IP、节点级 Key 解析器都把方法参数原样拼进去作为 Key 的组成部分，
 * 拼接结果一旦不稳定，重复请求就会算出两个不同的 Key，幂等与限流同时失效；一旦把 Web 对象也拼进去，
 * 又会因为 {@code toString()} 随请求变化而让 Key 抖动。因此这里逐条锁定：空参数、null 参数、
 * Servlet 对象与 Spring Web 对象各自应得到什么文本。</p>
 *
 * <p>连接点通过真实 Spring AOP 代理取得，而不是手工构造的假对象，这样断言的实参与生产一致。</p>
 *
 * @author shady2713
 */
class KeyResolverUtilsTest {

    /**
     * 每例结束后清空记录的连接点，避免把上一次调用的实参误当成本次结果。
     */
    @AfterEach
    void resetRecorder() {
        JoinPointRecorder.reset();
    }

    /**
     * 验证没有参数的方法拼接为空字符串，不会给 Key 引入多余的逗号。
     *
     * <p>无参方法对每个调用方都会得到同一个 Key，这是“全局只允许执行一次”的预期语义，
     * 因此必须是空串而不是 null 或逗号。</p>
     */
    @Test
    @DisplayName("无参方法的方法参数拼接为空字符串")
    void shouldJoinToEmptyTextWhenMethodHasNoArguments() {
        ArgumentProbe probe = JoinPointRecorder.proxyFor(new ArgumentProbeImpl());

        JoinPointRecorder.reset();
        probe.invokeWithoutArgs();

        assertThat(KeyResolverUtils.joinMethodArgs(JoinPointRecorder.lastJoinPoint())).isEmpty();
    }

    /**
     * 验证普通业务参数按调用顺序用英文逗号拼接，调用方顺序不同的重载会得到不同的 Key。
     */
    @Test
    @DisplayName("普通业务参数按调用顺序用英文逗号拼接")
    void shouldJoinBusinessArgumentsInDeclarationOrder() {
        ArgumentProbe probe = JoinPointRecorder.proxyFor(new ArgumentProbeImpl());

        JoinPointRecorder.reset();
        probe.invoke(7, "alpha");
        String first = KeyResolverUtils.joinMethodArgs(JoinPointRecorder.lastJoinPoint());

        JoinPointRecorder.reset();
        probe.invoke("alpha", 7);
        String swapped = KeyResolverUtils.joinMethodArgs(JoinPointRecorder.lastJoinPoint());

        assertThat(first).isEqualTo("7,alpha");
        assertThat(swapped).isEqualTo("alpha,7");
        assertThat(first).as("实参顺序不同必须算出不同的 Key，否则不同请求会互相命中幂等或限流")
                .isNotEqualTo(swapped);
    }

    /**
     * 验证 null 参数退化为空位而不是字符串 "null"。
     *
     * <p>若把 null 拼成字面量 "null"，{@code invoke(null, "a")} 与 {@code invoke("null", "a")} 就会算出
     * 同一个 Key，两次语义完全不同的调用会互相命中保护，因此必须留空。</p>
     */
    @Test
    @DisplayName("null 参数退化为空位，不会与字面量 \"null\" 混成同一个 Key")
    void shouldBlankOutNullArgumentInsteadOfLiteralText() {
        ArgumentProbe probe = JoinPointRecorder.proxyFor(new ArgumentProbeImpl());

        JoinPointRecorder.reset();
        probe.invoke(null, "alpha");
        String nullArgument = KeyResolverUtils.joinMethodArgs(JoinPointRecorder.lastJoinPoint());

        JoinPointRecorder.reset();
        probe.invoke("null", "alpha");
        String literalText = KeyResolverUtils.joinMethodArgs(JoinPointRecorder.lastJoinPoint());

        assertThat(nullArgument).isEqualTo(",alpha");
        assertThat(literalText).isEqualTo("null,alpha");
        assertThat(nullArgument).as("null 实参与字面量 \"null\" 必须算出不同的 Key")
                .isNotEqualTo(literalText);
    }

    /**
     * 验证 Servlet 对象不参与 Key 计算。
     *
     * <p>{@code jakarta.servlet} 下的对象每个请求都是新实例，{@code toString()} 随请求变化；一旦拼进 Key，
     * 同一份业务请求每次都会得到不同 Key，幂等与限流直接失效。</p>
     */
    @Test
    @DisplayName("Servlet 对象不参与 Key 计算，同一业务参数下的 Key 保持稳定")
    void shouldExcludeServletObjectFromKey() {
        ArgumentProbe probe = JoinPointRecorder.proxyFor(new ArgumentProbeImpl());

        JoinPointRecorder.reset();
        probe.invoke(new Cookie("session", "request-one"), "alpha");
        String firstRequest = KeyResolverUtils.joinMethodArgs(JoinPointRecorder.lastJoinPoint());

        JoinPointRecorder.reset();
        probe.invoke(new Cookie("session", "request-two"), "alpha");
        String secondRequest = KeyResolverUtils.joinMethodArgs(JoinPointRecorder.lastJoinPoint());

        assertThat(firstRequest).isEqualTo(",alpha");
        assertThat(secondRequest).as("Servlet 对象换了实例也必须得到相同的 Key 文本")
                .isEqualTo(firstRequest);
    }

    /**
     * 验证 Spring Web 对象不参与 Key 计算。
     *
     * <p>{@code org.springframework.web} 下的对象同样不可稳定序列化，与 Servlet 对象属于同一类风险，
     * 必须一起排除，否则一条带查询对象的方法会永远限流不生效。</p>
     */
    @Test
    @DisplayName("Spring Web 对象不参与 Key 计算")
    void shouldExcludeSpringWebObjectFromKey() {
        ArgumentProbe probe = JoinPointRecorder.proxyFor(new ArgumentProbeImpl());

        JoinPointRecorder.reset();
        probe.invoke(UriComponentsBuilder.fromPath("/order/1001").build(), "alpha");

        assertThat(KeyResolverUtils.joinMethodArgs(JoinPointRecorder.lastJoinPoint()))
                .isEqualTo(",alpha");
    }

    /**
     * 验证 Web 对象与 null 混合出现时仍按位置留空，不会把后面的实参挤到错误的位置上。
     */
    @Test
    @DisplayName("Web 对象与 null 混合时按位置留空，实参位置保持稳定")
    void shouldKeepArgumentPositionsWhenWebObjectsAndNullsAreMixed() {
        ArgumentProbe probe = JoinPointRecorder.proxyFor(new ArgumentProbeImpl());

        JoinPointRecorder.reset();
        probe.invoke(new Cookie("session", "request-one"), null);

        assertThat(KeyResolverUtils.joinMethodArgs(JoinPointRecorder.lastJoinPoint())).isEqualTo(",");
    }

    /**
     * 接受任意类型实参的参数探针，用于通过真实 AOP 代理取得带指定实参的连接点。
     */
    interface ArgumentProbe {

        /**
         * 以两个任意类型的实参调用。
         *
         * @param first  第一个实参，可为 null 或 Web 对象
         * @param second 第二个实参，可为 null 或 Web 对象
         * @return 原样返回第二个实参，确认调用确实执行到了目标方法
         */
        Object invoke(Object first, Object second);

        /**
         * 不带实参调用。
         *
         * @return 固定返回值，确认调用确实执行到了目标方法
         */
        Object invokeWithoutArgs();
    }

    /**
     * 参数探针的实现，只负责被调用，实参与签名才是测试关注点。
     */
    static class ArgumentProbeImpl implements ArgumentProbe {

        /**
         * 原样返回第二个实参。
         *
         * @param first  未使用的第一个实参
         * @param second 第二个实参
         * @return 第二个实参
         */
        @Override
        public Object invoke(Object first, Object second) {
            return second;
        }

        /**
         * 返回固定标记，确认无参调用走到了目标方法。
         *
         * @return 固定标记
         */
        @Override
        public Object invokeWithoutArgs() {
            return "no-args";
        }
    }
}
