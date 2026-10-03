package com.basicframework.framework.ratelimiter.core.keyresolver;

import com.basicframework.framework.protection.support.JoinPointRecorder;
import com.basicframework.framework.ratelimiter.core.annotation.RateLimiter;
import com.basicframework.framework.ratelimiter.core.keyresolver.impl.ClientIpRateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.keyresolver.impl.DefaultRateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.keyresolver.impl.ExpressionRateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.keyresolver.impl.ServerNodeRateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.keyresolver.impl.UserRateLimiterKeyResolver;
import com.basicframework.framework.web.core.util.WebFrameworkUtils;
import jakarta.servlet.http.Cookie;
import org.aspectj.lang.JoinPoint;
import org.aspectj.lang.reflect.MethodSignature;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 验证五种内置限流 Key 解析器算出的 Key 是否满足各自的限流维度。
 *
 * <p>限流组件的作用域完全由 Key 决定：限错了维度，要么限不住真正的滥用方（键按用户算、攻击按 IP 来），
 * 要么误伤正常用户。因此这里逐个断言隔离维度是否真的进了 Key：方法与参数、登录用户、客户端 IP、
 * 服务节点，以及由调用方指定的表达式。</p>
 *
 * @author shady2713
 */
class RateLimiterKeyResolversTest {

    /** 测试使用的登录用户编号。 */
    private static final Long LOGIN_USER_ID = 1001L;

    /** 测试使用的登录用户类型。 */
    private static final Integer LOGIN_USER_TYPE = 2;

    /** 另一个登录用户编号。 */
    private static final Long OTHER_LOGIN_USER_ID = 2002L;

    /** 第一个客户端 IP。 */
    private static final String FIRST_CLIENT_IP = "203.0.113.7";

    /** 第二个客户端 IP。 */
    private static final String SECOND_CLIENT_IP = "198.51.100.9";

    /**
     * 每例结束后清空请求上下文与连接点记录，避免跨用例串数据。
     */
    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
        JoinPointRecorder.reset();
    }

    /**
     * 验证默认级解析器对同一方法同一参数稳定、对不同参数敏感，并排除 Servlet 对象。
     *
     * <p>默认级限流的语义是“全服务同一方法同一参数在周期内只放行 N 次”，因此入参里多带一个
     * Servlet 对象不能让限流失效。排除规则按 Servlet API 与 Spring Web 的包名匹配，所以这里传入
     * 真实的 {@code jakarta.servlet} 对象而不是测试用的请求替身。</p>
     */
    @Test
    @DisplayName("默认级解析器对同一方法同一参数稳定、对不同参数敏感并排除 Servlet 对象")
    void defaultResolverShouldSeparateCallsByMethodAndArguments() {
        RateLimitedTarget target = JoinPointRecorder.proxyFor(new RateLimitedTargetImpl());
        DefaultRateLimiterKeyResolver resolver = new DefaultRateLimiterKeyResolver();

        JoinPointRecorder.reset();
        target.globallyScoped("1001");
        String first = resolver.resolver(JoinPointRecorder.lastJoinPoint(),
                annotationOf("globallyScoped", String.class));

        JoinPointRecorder.reset();
        target.globallyScoped("1001");
        String sameCall = resolver.resolver(JoinPointRecorder.lastJoinPoint(),
                annotationOf("globallyScoped", String.class));

        JoinPointRecorder.reset();
        target.globallyScoped("1002");
        String otherArgument = resolver.resolver(JoinPointRecorder.lastJoinPoint(),
                annotationOf("globallyScoped", String.class));

        JoinPointRecorder.reset();
        target.globallyScopedWithServletObject("1001", new Cookie("session", "request-one"));
        String withServletOne = resolver.resolver(JoinPointRecorder.lastJoinPoint(),
                annotationOf("globallyScopedWithServletObject", String.class, Object.class));

        JoinPointRecorder.reset();
        target.globallyScopedWithServletObject("1001", new Cookie("session", "request-two"));
        String withServletTwo = resolver.resolver(JoinPointRecorder.lastJoinPoint(),
                annotationOf("globallyScopedWithServletObject", String.class, Object.class));

        assertThat(first).as("同一方法同一参数必须算出同一个 Key").isEqualTo(sameCall);
        assertThat(first).as("参数不同必须算出不同的 Key").isNotEqualTo(otherArgument);
        assertThat(withServletOne).as("换了 Servlet 实例也必须算出同一个 Key")
                .isEqualTo(withServletTwo)
                .hasSize(32)
                .matches("[0-9a-f]{32}");
    }

    /**
     * 验证用户级解析器把登录用户混入 Key，不同用户之间互不共享配额。
     */
    @Test
    @DisplayName("用户级解析器把登录用户混入 Key，不同用户互不共享配额")
    void userResolverShouldSeparateCallsByLoginUser() {
        RateLimitedTarget target = JoinPointRecorder.proxyFor(new RateLimitedTargetImpl());
        UserRateLimiterKeyResolver resolver = new UserRateLimiterKeyResolver();
        RateLimiter rateLimiter = annotationOf("userScoped", String.class);

        bindRequest(FIRST_CLIENT_IP, LOGIN_USER_ID);
        JoinPointRecorder.reset();
        target.userScoped("1001");
        String firstUser = resolver.resolver(JoinPointRecorder.lastJoinPoint(), rateLimiter);

        bindRequest(FIRST_CLIENT_IP, OTHER_LOGIN_USER_ID);
        JoinPointRecorder.reset();
        target.userScoped("1001");
        String secondUser = resolver.resolver(JoinPointRecorder.lastJoinPoint(), rateLimiter);

        bindRequest(FIRST_CLIENT_IP, LOGIN_USER_ID);
        JoinPointRecorder.reset();
        target.userScoped("1001");
        String firstUserAgain = resolver.resolver(JoinPointRecorder.lastJoinPoint(), rateLimiter);

        assertThat(firstUser).as("同一用户重复请求必须算出同一个 Key")
                .isEqualTo(firstUserAgain);
        assertThat(firstUser).as("不同用户对同一业务参数必须算出不同的 Key")
                .isNotEqualTo(secondUser);
    }

    /**
     * 验证客户端 IP 级解析器按请求来源 IP 隔离配额。
     *
     * <p>IP 级限流是防刷场景的主力：同一用户换 IP 不应共享配额，不同 IP 的同一业务参数也不应互相限流。</p>
     */
    @Test
    @DisplayName("客户端 IP 级解析器按请求来源 IP 隔离配额")
    void clientIpResolverShouldSeparateCallsByClientIp() {
        RateLimitedTarget target = JoinPointRecorder.proxyFor(new RateLimitedTargetImpl());
        ClientIpRateLimiterKeyResolver resolver = new ClientIpRateLimiterKeyResolver();
        RateLimiter rateLimiter = annotationOf("clientIpScoped", String.class);

        bindRequest(FIRST_CLIENT_IP, null);
        JoinPointRecorder.reset();
        target.clientIpScoped("1001");
        String firstIp = resolver.resolver(JoinPointRecorder.lastJoinPoint(), rateLimiter);

        bindRequest(FIRST_CLIENT_IP, null);
        JoinPointRecorder.reset();
        target.clientIpScoped("1001");
        String sameIp = resolver.resolver(JoinPointRecorder.lastJoinPoint(), rateLimiter);

        bindRequest(SECOND_CLIENT_IP, null);
        JoinPointRecorder.reset();
        target.clientIpScoped("1001");
        String otherIp = resolver.resolver(JoinPointRecorder.lastJoinPoint(), rateLimiter);

        assertThat(firstIp).as("同一 IP 的重复请求必须算出同一个 Key")
                .isEqualTo(sameIp);
        assertThat(firstIp).as("不同 IP 的同一业务参数必须算出不同的 Key")
                .isNotEqualTo(otherIp);
    }

    /**
     * 验证节点级解析器把当前服务节点混入 Key。
     *
     * <p>节点级限流的用途是“保护单节点自身不被打挂”，因此同一节点内必须稳定，而它与全局级 Key 不同，
     * 证明节点标识确实参与了计算（多个节点之间不会互相限流）。</p>
     */
    @Test
    @DisplayName("节点级解析器把当前服务节点混入 Key")
    void serverNodeResolverShouldMixCurrentNodeIntoKey() {
        RateLimitedTarget target = JoinPointRecorder.proxyFor(new RateLimitedTargetImpl());
        ServerNodeRateLimiterKeyResolver resolver = new ServerNodeRateLimiterKeyResolver();

        JoinPointRecorder.reset();
        target.serverNodeScoped("1001");
        String nodeScoped = resolver.resolver(JoinPointRecorder.lastJoinPoint(),
                annotationOf("serverNodeScoped", String.class));

        JoinPointRecorder.reset();
        target.serverNodeScoped("1001");
        String sameNode = resolver.resolver(JoinPointRecorder.lastJoinPoint(),
                annotationOf("serverNodeScoped", String.class));

        JoinPointRecorder.reset();
        target.globallyScoped("1001");
        String globalKey = new DefaultRateLimiterKeyResolver().resolver(
                JoinPointRecorder.lastJoinPoint(), annotationOf("globallyScoped", String.class));

        assertThat(nodeScoped).as("同一节点内必须算出同一个 Key").isEqualTo(sameNode);
        assertThat(nodeScoped).as("节点标识参与计算后，Key 不应等于全局级 Key")
                .isNotEqualTo(globalKey);
        assertThat(nodeScoped).hasSize(32).matches("[0-9a-f]{32}");
    }

    /**
     * 验证表达式级解析器按注解指定的 SpEL 表达式取值。
     */
    @Test
    @DisplayName("表达式级解析器按注解指定的 SpEL 表达式取值")
    void expressionResolverShouldResolveKeyFromKeyArgExpression() {
        RateLimitedTarget target = JoinPointRecorder.proxyFor(new RateLimitedTargetImpl());
        ExpressionRateLimiterKeyResolver resolver = new ExpressionRateLimiterKeyResolver();
        RateLimiter rateLimiter = annotationOf("byOrderId", String.class);

        // 注解声明在接口方法上，解析器必须回落到实现类方法取参数名。
        JoinPointRecorder.reset();
        target.byOrderId("1001");
        String byParameter = resolver.resolver(JoinPointRecorder.lastInterfaceJoinPoint(), rateLimiter);

        JoinPointRecorder.reset();
        target.byOrderId("1002");
        String otherOrder = resolver.resolver(JoinPointRecorder.lastInterfaceJoinPoint(), rateLimiter);

        assertThat(byParameter).as("表达式 #orderId 必须取到方法参数的实际值")
                .isEqualTo("1001");
        assertThat(byParameter).as("表达式取到的参数不同，Key 必须不同")
                .isNotEqualTo(otherOrder);
    }

    /**
     * 验证无参方法也能用常量表达式算出固定 Key，覆盖没有参数名的场景。
     */
    @Test
    @DisplayName("无参方法用常量表达式算出固定 Key")
    void expressionResolverShouldSupportConstantExpressionWithoutArguments() {
        ClassDeclaredTarget target = JoinPointRecorder.proxyFor(new ClassDeclaredTarget());
        ExpressionRateLimiterKeyResolver resolver = new ExpressionRateLimiterKeyResolver();
        RateLimiter rateLimiter = classDeclaredAnnotation();

        JoinPointRecorder.reset();
        target.withoutArguments();
        String key = resolver.resolver(JoinPointRecorder.lastClassJoinPoint(), rateLimiter);

        assertThat(key).isEqualTo("fixed-rate-key");
    }

    /**
     * 验证目标对象上找不到接口声明的方法时，解析器立即失败而不是静默算出错误 Key。
     *
     * <p>该分支无法由真实 Spring AOP 代理触发（代理总能在目标上找到实现方法），因此用受控的连接点
     * 构造“签名来自接口、目标上却没有该方法”的状态，只验证失败行为与被包装的根因。</p>
     */
    @Test
    @DisplayName("目标上缺少接口方法时表达式级解析器抛出运行时异常并保留根因")
    void expressionResolverShouldFailFastWhenInterfaceMethodMissingOnTarget() throws Exception {
        Method interfaceMethod = RateLimitedTarget.class.getMethod("byOrderId", String.class);
        MethodSignature signature = mock(MethodSignature.class);
        when(signature.getMethod()).thenReturn(interfaceMethod);
        when(signature.getName()).thenReturn("byOrderId");
        when(signature.getParameterTypes()).thenReturn(new Class<?>[]{String.class});
        JoinPoint joinPoint = mock(JoinPoint.class);
        when(joinPoint.getSignature()).thenReturn(signature);
        when(joinPoint.getTarget()).thenReturn(new Object());
        when(joinPoint.getArgs()).thenReturn(new Object[]{"1001"});

        assertThatThrownBy(() -> new ExpressionRateLimiterKeyResolver()
                .resolver(joinPoint, annotationOf("byOrderId", String.class)))
                .isInstanceOf(RuntimeException.class)
                .hasCauseInstanceOf(NoSuchMethodException.class);
    }

    /**
     * 绑定带客户端 IP 与可选登录用户信息的请求上下文。
     *
     * @param clientIp 客户端 IP
     * @param userId   登录用户编号，为 null 表示匿名请求
     */
    private static void bindRequest(String clientIp, Long userId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr(clientIp);
        if (userId != null) {
            WebFrameworkUtils.setLoginUserId(request, userId);
            WebFrameworkUtils.setLoginUserType(request, LOGIN_USER_TYPE);
        }
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    /**
     * 读取目标接口方法上的限流注解，作为解析器的入参传入。
     *
     * <p>方法名写错属于用例自身的错误，因此直接包装成非受检异常抛出，不让每个用例都写 try/catch。</p>
     *
     * @param methodName     方法名
     * @param parameterTypes 方法参数类型
     * @return 方法上的限流注解
     */
    private static RateLimiter annotationOf(String methodName, Class<?>... parameterTypes) {
        try {
            return RateLimitedTarget.class.getMethod(methodName, parameterTypes)
                    .getAnnotation(RateLimiter.class);
        } catch (NoSuchMethodException exception) {
            throw new IllegalStateException("目标接口上不存在方法: " + methodName, exception);
        }
    }

    /**
     * 读取声明在实现类方法上的限流注解。
     *
     * @return 该方法上的限流注解
     */
    private static RateLimiter classDeclaredAnnotation() {
        try {
            return ClassDeclaredTarget.class.getMethod("withoutArguments")
                    .getAnnotation(RateLimiter.class);
        } catch (NoSuchMethodException exception) {
            throw new IllegalStateException("目标类上不存在方法: withoutArguments", exception);
        }
    }

    /**
     * 限流注解的调用目标，覆盖五种内置解析器各自的使用方式。
     */
    interface RateLimitedTarget {

        /**
         * 全局级限流，只按方法与参数区分。
         *
         * @param orderId 订单编号
         * @return 固定返回值，确认调用确实执行到了目标方法
         */
        @RateLimiter
        String globallyScoped(String orderId);

        /**
         * 全局级限流，并额外接收一个 Servlet 对象以验证其被排除在 Key 之外。
         *
         * @param orderId      订单编号
         * @param servletObject Servlet API 对象，例如 Cookie
         * @return 固定返回值，确认调用确实执行到了目标方法
         */
        @RateLimiter
        String globallyScopedWithServletObject(String orderId, Object servletObject);

        /**
         * 用户级限流。
         *
         * @param orderId 订单编号
         * @return 固定返回值，确认调用确实执行到了目标方法
         */
        @RateLimiter(keyResolver = UserRateLimiterKeyResolver.class)
        String userScoped(String orderId);

        /**
         * 客户端 IP 级限流。
         *
         * @param orderId 订单编号
         * @return 固定返回值，确认调用确实执行到了目标方法
         */
        @RateLimiter(keyResolver = ClientIpRateLimiterKeyResolver.class)
        String clientIpScoped(String orderId);

        /**
         * 服务节点级限流。
         *
         * @param orderId 订单编号
         * @return 固定返回值，确认调用确实执行到了目标方法
         */
        @RateLimiter(keyResolver = ServerNodeRateLimiterKeyResolver.class)
        String serverNodeScoped(String orderId);

        /**
         * 表达式级限流，Key 由 {@code #orderId} 参数决定。
         *
         * @param orderId 订单编号
         * @return 固定返回值，确认调用确实执行到了目标方法
         */
        @RateLimiter(keyResolver = ExpressionRateLimiterKeyResolver.class, keyArg = "#orderId")
        String byOrderId(String orderId);
    }

    /**
     * 限流目标接口的实现。
     */
    static class RateLimitedTargetImpl implements RateLimitedTarget {

        /**
         * 返回固定标记。
         *
         * @param orderId 订单编号
         * @return 固定标记
         */
        @Override
        public String globallyScoped(String orderId) {
            return "globally-scoped";
        }

        /**
         * 返回固定标记。
         *
         * @param orderId      订单编号
         * @param servletObject Servlet API 对象
         * @return 固定标记
         */
        @Override
        public String globallyScopedWithServletObject(String orderId, Object servletObject) {
            return "globally-scoped-with-servlet-object";
        }

        /**
         * 返回固定标记。
         *
         * @param orderId 订单编号
         * @return 固定标记
         */
        @Override
        public String userScoped(String orderId) {
            return "user-scoped";
        }

        /**
         * 返回固定标记。
         *
         * @param orderId 订单编号
         * @return 固定标记
         */
        @Override
        public String clientIpScoped(String orderId) {
            return "client-ip-scoped";
        }

        /**
         * 返回固定标记。
         *
         * @param orderId 订单编号
         * @return 固定标记
         */
        @Override
        public String serverNodeScoped(String orderId) {
            return "server-node-scoped";
        }

        /**
         * 返回固定标记。
         *
         * @param orderId 订单编号
         * @return 固定标记
         */
        @Override
        public String byOrderId(String orderId) {
            return "by-order-id";
        }
    }

    /**
     * 注解声明在实现类方法上的调用目标，用于覆盖解析器不回落接口签名的分支。
     *
     * <p>刻意不实现任何接口，代理会退化为类代理，连接点签名直接来自本类方法。</p>
     */
    static class ClassDeclaredTarget {

        /**
         * 无参方法，Key 由常量表达式决定。
         *
         * @return 固定标记
         */
        @RateLimiter(keyResolver = ExpressionRateLimiterKeyResolver.class, keyArg = "'fixed-rate-key'")
        public String withoutArguments() {
            return "without-arguments";
        }
    }
}
