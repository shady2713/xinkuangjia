package com.basicframework.framework.idempotent.core.aop;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants;
import com.basicframework.framework.idempotent.core.annotation.Idempotent;
import com.basicframework.framework.idempotent.core.keyresolver.IdempotentKeyResolver;
import com.basicframework.framework.idempotent.core.keyresolver.impl.DefaultIdempotentKeyResolver;
import com.basicframework.framework.idempotent.core.keyresolver.impl.ExpressionIdempotentKeyResolver;
import com.basicframework.framework.idempotent.core.keyresolver.impl.UserIdempotentKeyResolver;
import com.basicframework.framework.idempotent.core.redis.IdempotentRedisDAO;
import com.basicframework.framework.protection.support.ProtectionRedisTestSupport;
import org.aspectj.lang.JoinPoint;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.aop.aspectj.annotation.AspectJProxyFactory;

import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 用真实 Spring AOP 代理与真实 Redis 验证幂等切面的放行、重复拦截与异常释放行为。
 *
 * <p>切面把“注解 → 解析 Key → 占位 → 放行 → 异常回滚”串成一条链，任何一环写错都不会在编译期暴露：
 * 注解没被切到会静默放行，Key 算错会让重复请求打不中，异常时不删 Key 会让用户的失败重试永远失败。
 * 因此这里用真实代理（证明切点确实匹配到注解方法）、真实 Redis（证明占位是原子的），并直接观察
 * 占位 Key 的存在与消失，而不是只看方法有没有被调用过。</p>
 *
 * @author shady2713
 */
class IdempotentAspectTest extends ProtectionRedisTestSupport {

    /** 幂等占位超时时间，取足够长以免用例执行期间占位自然过期。 */
    private static final int TIMEOUT_SECONDS = 60;

    /** 目标方法成功时的标记。 */
    private static final String SUCCEED_MARKER = "succeed";

    /** 目标方法失败时的异常消息。 */
    private static final String BUSINESS_FAILURE = "business-failure";

    /** 幂等注解的默认重复请求提示。 */
    private static final String DEFAULT_MESSAGE = "重复请求，请稍后重试";

    /** 幂等占位访问对象，全部用例走真实 Redis。 */
    private IdempotentRedisDAO idempotentRedisDAO;

    /** 目标实现，用于构造“首次失败、重试成功”的瞬时故障。 */
    private IdempotentBizImpl biz;

    /** 被切面代理的目标，切点能否命中注解方法由它直接体现。 */
    private IdempotentBiz target;

    /**
     * 用真实切面与真实 Redis 组装被代理目标，让每个用例都在同一条生产链路上运行。
     */
    @BeforeEach
    void setUp() {
        idempotentRedisDAO = new IdempotentRedisDAO(stringRedisTemplate);
        IdempotentAspect aspect = new IdempotentAspect(List.of(
                new DefaultIdempotentKeyResolver(),
                new UserIdempotentKeyResolver(),
                new ExpressionIdempotentKeyResolver()), idempotentRedisDAO);
        biz = new IdempotentBizImpl();
        AspectJProxyFactory factory = new AspectJProxyFactory(biz);
        factory.addAspect(aspect);
        target = factory.getProxy();
    }

    /**
     * 验证首次调用正常执行并留下幂等占位。
     *
     * <p>占位是“这次请求正在执行”的唯一凭据，没有它第二次请求就会被当成首次请求放行。</p>
     */
    @Test
    @DisplayName("首次调用正常执行并写入幂等占位")
    void shouldProceedAndOccupyKeyOnFirstCall() {
        String token = nextKey("first-call");

        assertThat(target.succeed(token)).isEqualTo(SUCCEED_MARKER);

        assertThat(stringRedisTemplate.hasKey("idempotent:" + token))
                .as("首次执行后必须留下占位，供后续重复请求判定")
                .isTrue();
    }

    /**
     * 验证重复调用被拒绝，且不会执行到目标方法。
     *
     * <p>这是幂等组件对外的核心承诺：同一 token 的第二次请求必须以“重复请求”错误码失败，
     * 而不是再执行一遍业务逻辑。</p>
     */
    @Test
    @DisplayName("重复调用被拒绝并返回重复请求错误码与默认提示")
    void shouldRejectDuplicateCallWithRepeatedRequestsError() {
        String token = nextKey("duplicate-call");
        assertThat(target.succeed(token)).isEqualTo(SUCCEED_MARKER);

        assertThatThrownBy(() -> target.succeed(token))
                .isInstanceOf(ServiceException.class)
                .satisfies(exception -> {
                    ServiceException serviceException = (ServiceException) exception;
                    assertThat(serviceException.getCode())
                            .isEqualTo(GlobalErrorCodeConstants.REPEATED_REQUESTS.getCode());
                    assertThat(serviceException.getMessage()).isEqualTo(DEFAULT_MESSAGE);
                });
        assertThat(biz.getInvocationCount())
                .as("重复请求不应再次进入目标方法")
                .isEqualTo(1);
    }

    /**
     * 验证不同 token 之间互不影响，不会因为共用前缀就把两笔业务判成同一笔。
     */
    @Test
    @DisplayName("不同 token 的请求互不影响")
    void shouldNotInterfereBetweenDifferentTokens() {
        String firstToken = nextKey("order-1001");
        String secondToken = nextKey("order-1002");

        assertThat(target.succeed(firstToken)).isEqualTo(SUCCEED_MARKER);
        assertThat(target.succeed(secondToken))
                .as("另一笔业务的首次请求必须正常放行")
                .isEqualTo(SUCCEED_MARKER);
        assertThat(biz.getInvocationCount()).isEqualTo(2);
    }

    /**
     * 验证业务异常时释放占位，用户的失败重试能够再次执行。
     *
     * <p>不释放占位的话，一次网络抖动导致的失败就会让用户在整个超时窗口内无法重试同一笔业务。</p>
     */
    @Test
    @DisplayName("业务异常时释放占位，重试可以再次执行")
    void shouldReleaseKeyOnBusinessFailureSoRetrySucceeds() {
        String token = nextKey("retry-after-failure");
        biz.failNextCalls(1);

        assertThatThrownBy(() -> target.failAndReleaseKey(token))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage(BUSINESS_FAILURE);

        assertThat(stringRedisTemplate.hasKey("idempotent:" + token))
                .as("默认配置下业务失败必须释放占位")
                .isFalse();
        assertThat(target.failAndReleaseKey(token))
                .as("释放占位后重试应能执行到目标方法")
                .isEqualTo(SUCCEED_MARKER);
    }

    /**
     * 验证配置为不释放占位时，占位在业务异常后仍然保留。
     *
     * <p>该开关用于“同一笔业务即使失败也不允许立刻重试”的场景；反过来若实现忽略了这个配置，
     * 就会在用户重试时把本应被拦下的请求放行。</p>
     */
    @Test
    @DisplayName("配置为异常时不释放占位时，占位在业务异常后仍然保留")
    void shouldKeepKeyOnBusinessFailureWhenConfigured() {
        String token = nextKey("keep-key-after-failure");

        assertThatThrownBy(() -> target.failKeepingKey(token))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage(BUSINESS_FAILURE);

        assertThat(stringRedisTemplate.hasKey("idempotent:" + token))
                .as("deleteKeyWhenException=false 时占位必须保留")
                .isTrue();
        assertThatThrownBy(() -> target.failKeepingKey(token))
                .as("占位未释放，重试应被判为重复请求而不是再次执行业务")
                .isInstanceOf(ServiceException.class);
    }

    /**
     * 验证业务方法抛出的异常原样透出，不会被切面替换成幂等相关异常。
     *
     * <p>业务异常被吞掉或被改写，上层就无法区分“业务失败可重试”与“重复请求不可重试”。</p>
     */
    @Test
    @DisplayName("业务异常原样透出，不被切面替换成重复请求错误")
    void shouldPropagateBusinessExceptionUnchanged() {
        String token = nextKey("propagate-failure");
        biz.failNextCalls(1);

        assertThatThrownBy(() -> target.failAndReleaseKey(token))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage(BUSINESS_FAILURE);
    }

    /**
     * 验证注解指定了未注册的 Key 解析器时立即失败，而不是静默放行。
     *
     * <p>解析器找不到就放行，等于幂等形同虚设；这里必须以明确异常暴露配置错误。</p>
     */
    @Test
    @DisplayName("注解指定的 Key 解析器未注册时立即失败")
    void shouldFailFastWhenKeyResolverIsNotRegistered() {
        String token = nextKey("unknown-resolver");

        assertThatThrownBy(() -> target.withUnregisteredResolver(token))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("找不到对应的 IdempotentKeyResolver");
        assertThat(stringRedisTemplate.hasKey("idempotent:" + token))
                .as("解析器缺失时不应留下占位")
                .isFalse();
    }

    /**
     * 验证占位超时时间按注解配置下发到 Redis。
     */
    @Test
    @DisplayName("占位超时时间按注解配置下发到 Redis")
    void shouldApplyConfiguredTimeoutToIdempotentKey() {
        String token = nextKey("timeout-check");

        target.succeed(token);

        assertThat(stringRedisTemplate.getExpire("idempotent:" + token, TimeUnit.SECONDS))
                .isBetween(1L, (long) TIMEOUT_SECONDS);
    }

    /**
     * 幂等注解的调用目标，覆盖放行、重复拦截、异常释放与解析器缺失四种路径。
     */
    interface IdempotentBiz {

        /**
         * 正常返回的方法，用于验证首次放行与重复拦截。
         *
         * @param token 幂等维度令牌
         * @return 固定标记
         */
        @Idempotent(keyResolver = ExpressionIdempotentKeyResolver.class, keyArg = "#token",
                timeout = TIMEOUT_SECONDS)
        String succeed(String token);

        /**
         * 可控失败的方法，用于验证默认配置下失败会释放占位。
         *
         * @param token 幂等维度令牌
         * @return 成功时的固定标记
         * @throws IllegalStateException 配置的失败次数用完之前抛出
         */
        @Idempotent(keyResolver = ExpressionIdempotentKeyResolver.class, keyArg = "#token",
                timeout = TIMEOUT_SECONDS)
        String failAndReleaseKey(String token);

        /**
         * 必定失败的方法，验证配置为不释放占位时占位仍然保留。
         *
         * @param token 幂等维度令牌
         * @return 不会正常返回
         * @throws IllegalStateException 固定抛出，表示业务处理失败
         */
        @Idempotent(keyResolver = ExpressionIdempotentKeyResolver.class, keyArg = "#token",
                timeout = TIMEOUT_SECONDS, deleteKeyWhenException = false)
        String failKeepingKey(String token);

        /**
         * 指定未注册解析器的方法，验证配置错误会立即暴露。
         *
         * @param token 幂等维度令牌
         * @return 不会正常返回
         */
        @Idempotent(keyResolver = UnregisteredIdempotentKeyResolver.class, keyArg = "#token",
                timeout = TIMEOUT_SECONDS)
        String withUnregisteredResolver(String token);
    }

    /**
     * 幂等目标接口的实现，可统计进入次数并模拟瞬时故障。
     */
    static class IdempotentBizImpl implements IdempotentBiz {

        /** 已进入目标方法的次数，用于证明重复请求没有再次进入业务逻辑。 */
        private int invocationCount;

        /** 剩余的失败次数，用于模拟“首次失败、重试成功”的瞬时故障。 */
        private int remainingFailures;

        /**
         * 统计进入次数后返回固定标记。
         *
         * @param token 幂等维度令牌
         * @return 固定标记
         */
        @Override
        @Idempotent(keyResolver = ExpressionIdempotentKeyResolver.class, keyArg = "#token",
                timeout = TIMEOUT_SECONDS)
        public String succeed(String token) {
            invocationCount++;
            return SUCCEED_MARKER;
        }

        /**
         * 在配置的失败次数内抛出业务异常，之后返回成功标记。
         *
         * @param token 幂等维度令牌
         * @return 成功时的固定标记
         * @throws IllegalStateException 剩余失败次数大于零时抛出
         */
        @Override
        @Idempotent(keyResolver = ExpressionIdempotentKeyResolver.class, keyArg = "#token",
                timeout = TIMEOUT_SECONDS)
        public String failAndReleaseKey(String token) {
            invocationCount++;
            if (remainingFailures > 0) {
                remainingFailures--;
                throw new IllegalStateException(BUSINESS_FAILURE);
            }
            return SUCCEED_MARKER;
        }

        /**
         * 固定抛出业务异常，验证不释放占位的配置。
         *
         * @param token 幂等维度令牌
         * @return 不会正常返回
         * @throws IllegalStateException 固定抛出，表示业务处理失败
         */
        @Override
        @Idempotent(keyResolver = ExpressionIdempotentKeyResolver.class, keyArg = "#token",
                timeout = TIMEOUT_SECONDS, deleteKeyWhenException = false)
        public String failKeepingKey(String token) {
            invocationCount++;
            throw new IllegalStateException(BUSINESS_FAILURE);
        }

        /**
         * 不应被执行到，用于验证解析器缺失时切面提前失败。
         *
         * @param token 幂等维度令牌
         * @return 不会正常返回
         */
        @Override
        @Idempotent(keyResolver = UnregisteredIdempotentKeyResolver.class, keyArg = "#token",
                timeout = TIMEOUT_SECONDS)
        public String withUnregisteredResolver(String token) {
            invocationCount++;
            throw new AssertionError("解析器缺失时不应执行到目标方法");
        }

        /**
         * 配置接下来若干次调用都失败，用于模拟瞬时故障后重试成功。
         *
         * @param count 失败次数
         */
        void failNextCalls(int count) {
            this.remainingFailures = count;
        }

        /**
         * 读取进入目标方法的次数。
         *
         * @return 进入次数
         */
        int getInvocationCount() {
            return invocationCount;
        }
    }

    /**
     * 故意不注册到切面的解析器，用于验证“找不到解析器”时的失败行为。
     */
    static class UnregisteredIdempotentKeyResolver implements IdempotentKeyResolver {

        /**
         * 不会被执行到的解析逻辑。
         *
         * @param joinPoint  AOP 切面
         * @param idempotent 幂等注解
         * @return 不会正常返回
         */
        @Override
        public String resolver(JoinPoint joinPoint, Idempotent idempotent) {
            throw new AssertionError("未注册的解析器不应被调用");
        }
    }
}
