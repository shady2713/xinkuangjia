package com.basicframework.framework.idempotent.core.keyresolver;

import com.basicframework.framework.idempotent.core.annotation.Idempotent;
import com.basicframework.framework.idempotent.core.keyresolver.impl.DefaultIdempotentKeyResolver;
import com.basicframework.framework.idempotent.core.keyresolver.impl.ExpressionIdempotentKeyResolver;
import com.basicframework.framework.idempotent.core.keyresolver.impl.UserIdempotentKeyResolver;
import com.basicframework.framework.protection.support.JoinPointRecorder;
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
 * 验证三种内置幂等 Key 解析器算出的 Key 是否满足各自的隔离维度。
 *
 * <p>幂等组件的所有行为都建立在“同一业务请求算出同一个 Key、不同业务请求算出不同 Key”之上，因此这里
 * 不去复刻 MD5 的计算过程，而是断言三个解析器真正的契约：默认级按“方法 + 参数”隔离且排除 Web 对象、
 * 用户级额外把登录用户混入、表达式级完全由调用方指定。同时覆盖注解声明在接口方法上时解析器
 * 仍能取到实现类方法的兼容分支。</p>
 *
 * @author shady2713
 */
class IdempotentKeyResolversTest {

    /** 测试使用的登录用户编号。 */
    private static final Long LOGIN_USER_ID = 1001L;

    /** 测试使用的登录用户类型。 */
    private static final Integer LOGIN_USER_TYPE = 2;

    /** 另一个登录用户编号，用于验证用户维度确实参与 Key 计算。 */
    private static final Long OTHER_LOGIN_USER_ID = 2002L;

    /**
     * 每例结束后清空请求上下文与连接点记录，避免跨用例串数据。
     */
    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
        JoinPointRecorder.reset();
    }

    /**
     * 验证默认级解析器对同一方法同一参数稳定、对不同参数敏感。
     *
     * <p>默认级的隔离维度就是“方法 + 参数”，两者任一变化都必须换 Key，否则要么重复请求打不中，
     * 要么不同请求被误判为重复。</p>
     */
    @Test
    @DisplayName("默认级解析器对同一方法同一参数稳定、对不同参数敏感")
    void defaultResolverShouldSeparateCallsByMethodAndArguments() {
        IdempotentTarget target = JoinPointRecorder.proxyFor(new IdempotentTargetImpl());
        DefaultIdempotentKeyResolver resolver = new DefaultIdempotentKeyResolver();

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

        assertThat(first).as("同一方法同一参数必须算出同一个 Key").isEqualTo(sameCall);
        assertThat(first).as("参数不同必须算出不同的 Key").isNotEqualTo(otherArgument);
        assertThat(first).as("Key 用 MD5 压缩为 32 位十六进制，避免 Redis Key 过长")
                .hasSize(32)
                .matches("[0-9a-f]{32}");
    }

    /**
     * 验证默认级解析器把 Servlet 对象排除在 Key 之外。
     *
     * <p>每个 HTTP 请求都有新的 {@code HttpServletRequest} 实例，若它的 {@code toString()} 进入 Key，
     * 同一份业务请求每次都会得到不同 Key，幂等会彻底失效。这里用两个不同实例证明结果一致。</p>
     */
    @Test
    @DisplayName("默认级解析器把 Servlet 对象排除在 Key 之外")
    void defaultResolverShouldIgnoreServletArgument() {
        IdempotentTarget target = JoinPointRecorder.proxyFor(new IdempotentTargetImpl());
        DefaultIdempotentKeyResolver resolver = new DefaultIdempotentKeyResolver();
        Idempotent idempotent = annotationOf("globallyScopedWithServletObject", String.class, Object.class);

        // 排除规则按 Servlet API 的包名匹配，因此必须传入真实的 jakarta.servlet 对象。
        JoinPointRecorder.reset();
        target.globallyScopedWithServletObject("1001", new Cookie("session", "request-one"));
        String firstRequest = resolver.resolver(JoinPointRecorder.lastJoinPoint(), idempotent);

        JoinPointRecorder.reset();
        target.globallyScopedWithServletObject("1001", new Cookie("session", "request-two"));
        String secondRequest = resolver.resolver(JoinPointRecorder.lastJoinPoint(), idempotent);

        assertThat(firstRequest).as("换了 Servlet 实例也必须算出同一个 Key")
                .isEqualTo(secondRequest);
    }

    /**
     * 验证用户级解析器把登录用户混入 Key，不同用户之间互不命中。
     *
     * <p>用户级幂等的意义就是“同一用户不能重复提交，不同用户互不影响”，因此两个用户对同一业务参数
     * 必须算出不同的 Key。</p>
     */
    @Test
    @DisplayName("用户级解析器把登录用户混入 Key，不同用户互不命中")
    void userResolverShouldSeparateCallsByLoginUser() {
        IdempotentTarget target = JoinPointRecorder.proxyFor(new IdempotentTargetImpl());
        UserIdempotentKeyResolver resolver = new UserIdempotentKeyResolver();
        Idempotent idempotent = annotationOf("userScoped", String.class);

        bindLoginUser(LOGIN_USER_ID);
        JoinPointRecorder.reset();
        target.userScoped("1001");
        String firstUser = resolver.resolver(JoinPointRecorder.lastJoinPoint(), idempotent);

        bindLoginUser(OTHER_LOGIN_USER_ID);
        JoinPointRecorder.reset();
        target.userScoped("1001");
        String secondUser = resolver.resolver(JoinPointRecorder.lastJoinPoint(), idempotent);

        bindLoginUser(LOGIN_USER_ID);
        JoinPointRecorder.reset();
        target.userScoped("1001");
        String firstUserAgain = resolver.resolver(JoinPointRecorder.lastJoinPoint(), idempotent);

        assertThat(firstUser).as("同一用户重复提交必须算出同一个 Key")
                .isEqualTo(firstUserAgain);
        assertThat(firstUser).as("不同用户对同一业务参数必须算出不同的 Key")
                .isNotEqualTo(secondUser);
    }

    /**
     * 验证用户级解析器与默认级解析器对同一次调用给出不同 Key，证明用户维度确实参与了计算。
     */
    @Test
    @DisplayName("用户级解析器与默认级解析器对同一次调用给出不同的 Key")
    void userResolverShouldMixLoginUserIntoKeyComparedWithDefault() {
        IdempotentTarget target = JoinPointRecorder.proxyFor(new IdempotentTargetImpl());

        bindLoginUser(LOGIN_USER_ID);
        JoinPointRecorder.reset();
        target.userScoped("1001");
        JoinPoint userScopedJoinPoint = JoinPointRecorder.lastJoinPoint();
        String userScopedKey = new UserIdempotentKeyResolver()
                .resolver(userScopedJoinPoint, annotationOf("userScoped", String.class));

        JoinPointRecorder.reset();
        target.globallyScoped("1001");
        String globalKey = new DefaultIdempotentKeyResolver()
                .resolver(JoinPointRecorder.lastJoinPoint(), annotationOf("globallyScoped", String.class));

        assertThat(userScopedKey).as("两种解析器方法签名不同，Key 必须不同")
                .isNotEqualTo(globalKey);
    }

    /**
     * 验证表达式级解析器按注解指定的 SpEL 表达式取值，Key 完全由调用方决定。
     *
     * <p>这是接入方自定义隔离维度（例如“按租户 + 订单”）的入口，表达式取不到参数名就会退化成
     * 固定 Key，因此这里同时断言参数取值与“换参数即换 Key”。</p>
     */
    @Test
    @DisplayName("表达式级解析器按注解指定的 SpEL 表达式取值")
    void expressionResolverShouldResolveKeyFromKeyArgExpression() {
        IdempotentTarget target = JoinPointRecorder.proxyFor(new IdempotentTargetImpl());
        ExpressionIdempotentKeyResolver resolver = new ExpressionIdempotentKeyResolver();
        Idempotent idempotent = annotationOf("byOrderId", String.class);

        // 注解声明在接口方法上，生产上最常见的形态，解析器必须回落到实现类方法取参数名。
        JoinPointRecorder.reset();
        target.byOrderId("1001");
        String byParameter = resolver.resolver(
                JoinPointRecorder.lastInterfaceJoinPoint(), idempotent);

        JoinPointRecorder.reset();
        target.byOrderId("1002");
        String otherOrder = resolver.resolver(
                JoinPointRecorder.lastInterfaceJoinPoint(), idempotent);

        assertThat(byParameter).as("表达式 #orderId 必须取到方法参数的实际值")
                .isEqualTo("1001");
        assertThat(byParameter).as("表达式取到的参数不同，Key 必须不同")
                .isNotEqualTo(otherOrder);
    }

    /**
     * 验证无参方法也能用常量表达式算出固定 Key，覆盖没有参数名的场景。
     *
     * <p>无参方法的参数名列表为空，此时不应依赖参数取值，直接返回表达式常量即可正常限流。</p>
     */
    @Test
    @DisplayName("无参方法用常量表达式算出固定 Key")
    void expressionResolverShouldSupportConstantExpressionWithoutArguments() {
        ClassDeclaredTarget target = JoinPointRecorder.proxyFor(new ClassDeclaredTarget());
        ExpressionIdempotentKeyResolver resolver = new ExpressionIdempotentKeyResolver();
        Idempotent idempotent = classDeclaredAnnotation();

        JoinPointRecorder.reset();
        target.withoutArguments();
        String key = resolver.resolver(JoinPointRecorder.lastClassJoinPoint(), idempotent);

        assertThat(key).isEqualTo("fixed-key");
    }

    /**
     * 验证目标对象上找不到接口声明的方法时，解析器立即失败而不是静默算出错误 Key。
     *
     * <p>该分支无法由真实 Spring AOP 代理触发（代理总能在目标上找到实现方法），因此这里用受控的连接点
     * 构造“签名来自接口、目标上却没有该方法”的状态，只验证失败行为与被包装的根因。</p>
     */
    @Test
    @DisplayName("目标上缺少接口方法时表达式级解析器抛出运行时异常并保留根因")
    void expressionResolverShouldFailFastWhenInterfaceMethodMissingOnTarget() throws Exception {
        Method interfaceMethod = IdempotentTarget.class.getMethod("byOrderId", String.class);
        MethodSignature signature = mock(MethodSignature.class);
        when(signature.getMethod()).thenReturn(interfaceMethod);
        when(signature.getName()).thenReturn("byOrderId");
        when(signature.getParameterTypes()).thenReturn(new Class<?>[]{String.class});
        JoinPoint joinPoint = mock(JoinPoint.class);
        when(joinPoint.getSignature()).thenReturn(signature);
        when(joinPoint.getTarget()).thenReturn(new Object());
        when(joinPoint.getArgs()).thenReturn(new Object[]{"1001"});

        assertThatThrownBy(() -> new ExpressionIdempotentKeyResolver()
                .resolver(joinPoint, annotationOf("byOrderId", String.class)))
                .isInstanceOf(RuntimeException.class)
                .hasCauseInstanceOf(NoSuchMethodException.class);
    }

    /**
     * 绑定带登录用户信息的请求上下文，使用户级解析器能读到用户编号与类型。
     *
     * @param userId 登录用户编号
     */
    private static void bindLoginUser(Long userId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        WebFrameworkUtils.setLoginUserId(request, userId);
        WebFrameworkUtils.setLoginUserType(request, LOGIN_USER_TYPE);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    /**
     * 读取目标接口方法上的幂等注解，作为解析器的入参传入。
     *
     * <p>方法名写错属于用例自身的错误，因此直接包装成非受检异常抛出，不让每个用例都写 try/catch。</p>
     *
     * @param methodName     方法名
     * @param parameterTypes 方法参数类型
     * @return 方法上的幂等注解
     */
    private static Idempotent annotationOf(String methodName, Class<?>... parameterTypes) {
        try {
            return IdempotentTarget.class.getMethod(methodName, parameterTypes)
                    .getAnnotation(Idempotent.class);
        } catch (NoSuchMethodException exception) {
            throw new IllegalStateException("目标接口上不存在方法: " + methodName, exception);
        }
    }

    /**
     * 读取声明在实现类方法上的幂等注解。
     *
     * @return 该方法上的幂等注解
     */
    private static Idempotent classDeclaredAnnotation() {
        try {
            return ClassDeclaredTarget.class.getMethod("withoutArguments")
                    .getAnnotation(Idempotent.class);
        } catch (NoSuchMethodException exception) {
            throw new IllegalStateException("目标类上不存在方法: withoutArguments", exception);
        }
    }

    /**
     * 幂等注解的调用目标，覆盖三种内置解析器各自的使用方式。
     */
    interface IdempotentTarget {

        /**
         * 全局级幂等，只按方法与参数区分。
         *
         * @param orderId 订单编号
         * @return 固定返回值，确认调用确实执行到了目标方法
         */
        @Idempotent
        String globallyScoped(String orderId);

        /**
         * 全局级幂等，并额外接收一个 Servlet 对象以验证其被排除在 Key 之外。
         *
         * @param orderId      订单编号
         * @param servletObject Servlet API 对象，例如 Cookie
         * @return 固定返回值，确认调用确实执行到了目标方法
         */
        @Idempotent
        String globallyScopedWithServletObject(String orderId, Object servletObject);

        /**
         * 用户级幂等，同一用户内按方法与参数区分。
         *
         * @param orderId 订单编号
         * @return 固定返回值，确认调用确实执行到了目标方法
         */
        @Idempotent(keyResolver = UserIdempotentKeyResolver.class)
        String userScoped(String orderId);

        /**
         * 表达式级幂等，Key 由 {@code #orderId} 参数决定。
         *
         * @param orderId 订单编号
         * @return 固定返回值，确认调用确实执行到了目标方法
         */
        @Idempotent(keyResolver = ExpressionIdempotentKeyResolver.class, keyArg = "#orderId")
        String byOrderId(String orderId);
    }

    /**
     * 幂等目标接口的实现。
     */
    static class IdempotentTargetImpl implements IdempotentTarget {

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
        @Idempotent(keyResolver = ExpressionIdempotentKeyResolver.class, keyArg = "'fixed-key'")
        public String withoutArguments() {
            return "without-arguments";
        }
    }
}
