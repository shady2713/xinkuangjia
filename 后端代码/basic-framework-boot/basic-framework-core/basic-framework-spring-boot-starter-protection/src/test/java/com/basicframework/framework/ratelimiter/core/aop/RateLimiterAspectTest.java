package com.basicframework.framework.ratelimiter.core.aop;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants;
import com.basicframework.framework.protection.support.ProtectionRedisTestSupport;
import com.basicframework.framework.ratelimiter.core.annotation.RateLimiter;
import com.basicframework.framework.ratelimiter.core.keyresolver.RateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.keyresolver.impl.ClientIpRateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.keyresolver.impl.DefaultRateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.keyresolver.impl.ExpressionRateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.keyresolver.impl.ServerNodeRateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.keyresolver.impl.UserRateLimiterKeyResolver;
import com.basicframework.framework.ratelimiter.core.redis.RateLimiterRedisDAO;
import org.aspectj.lang.JoinPoint;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.aop.aspectj.annotation.AspectJProxyFactory;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 用真实 Spring AOP 代理与真实 Redisson 验证限流切面的配额放行、超限拒绝与配置错误处理。
 *
 * <p>限流切面必须在目标方法执行之前完成判定，因此这里用真实代理证明切点确实命中注解方法，并观察
 * 超限请求是否真的没有进入业务逻辑；令牌计算依赖 Redisson 服务端，用真实客户端才能证明
 * “第 N 次放行、第 N+1 次拒绝”这条对外承诺。</p>
 *
 * @author shady2713
 */
class RateLimiterAspectTest extends ProtectionRedisTestSupport {

    /** 限流周期内的放行次数。 */
    private static final int COUNT = 2;

    /** 限流周期长度（秒），取足够长以免用例执行期间令牌自然恢复。 */
    private static final int PERIOD_SECONDS = 60;

    /** 目标方法成功时的标记。 */
    private static final String SUCCEED_MARKER = "limited";

    /** 自定义限流提示。 */
    private static final String CUSTOM_MESSAGE = "手慢了，请稍后再试";

    /** 限流切面使用的 Redis 访问对象。 */
    private RateLimiterRedisDAO rateLimiterRedisDAO;

    /** 目标实现，用于统计真正进入业务逻辑的次数。 */
    private RateLimitedBizImpl biz;

    /** 被切面代理的目标。 */
    private RateLimitedBiz target;

    /**
     * 用真实切面与真实 Redisson 组装被代理目标，让每个用例都在同一条生产链路上运行。
     */
    @BeforeEach
    void setUp() {
        rateLimiterRedisDAO = new RateLimiterRedisDAO(redissonClient);
        RateLimiterAspect aspect = new RateLimiterAspect(List.of(
                new DefaultRateLimiterKeyResolver(),
                new UserRateLimiterKeyResolver(),
                new ClientIpRateLimiterKeyResolver(),
                new ServerNodeRateLimiterKeyResolver(),
                new ExpressionRateLimiterKeyResolver()), rateLimiterRedisDAO);
        biz = new RateLimitedBizImpl();
        AspectJProxyFactory factory = new AspectJProxyFactory(biz);
        factory.addAspect(aspect);
        target = factory.getProxy();
    }

    /**
     * 验证配额内的请求正常放行。
     *
     * <p>限流最危险的失败模式是“把正常请求也拦掉”，因此必须先证明配额内完全放行。</p>
     */
    @Test
    @DisplayName("配额内的请求正常放行并进入目标方法")
    void shouldProceedWithinQuota() {
        String token = nextKey("within-quota");

        for (int index = 0; index < COUNT; index++) {
            assertThat(target.limited(token))
                    .as("第 %s 次请求在配额内应放行", index + 1)
                    .isEqualTo(SUCCEED_MARKER);
        }
        assertThat(biz.getInvocationCount()).isEqualTo(COUNT);
    }

    /**
     * 验证超出配额后抛出请求过快异常，且不进入目标方法。
     *
     * <p>超限请求必须真正被拦下，否则限流只是记录日志而不起作用。</p>
     */
    @Test
    @DisplayName("超出配额后抛出请求过快异常并使用默认提示")
    void shouldRejectBeyondQuotaWithDefaultMessage() {
        String token = nextKey("beyond-quota");
        target.limited(token);
        target.limited(token);

        assertThatThrownBy(() -> target.limited(token))
                .isInstanceOf(ServiceException.class)
                .satisfies(exception -> {
                    ServiceException serviceException = (ServiceException) exception;
                    assertThat(serviceException.getCode())
                            .isEqualTo(GlobalErrorCodeConstants.TOO_MANY_REQUESTS.getCode());
                    assertThat(serviceException.getMessage())
                            .as("注解未配置提示时应回落到统一的请求过快提示")
                            .isEqualTo(GlobalErrorCodeConstants.TOO_MANY_REQUESTS.getMsg());
                });
        assertThat(biz.getInvocationCount())
                .as("超限请求不应进入目标方法")
                .isEqualTo((long) COUNT);
    }

    /**
     * 验证注解配置了自定义提示时按配置返回，便于前端给出可操作的引导。
     */
    @Test
    @DisplayName("注解配置了提示时按配置返回限流提示")
    void shouldUseConfiguredMessageWhenProvided() {
        String token = nextKey("custom-message");
        target.limitedWithMessage(token);

        assertThatThrownBy(() -> target.limitedWithMessage(token))
                .isInstanceOf(ServiceException.class)
                .satisfies(exception -> assertThat(((ServiceException) exception).getMessage())
                        .isEqualTo(CUSTOM_MESSAGE));
    }

    /**
     * 验证不同 token 各自持有独立配额，不会互相挤占。
     *
     * <p>限流维度算错（例如所有业务共用一个 Key）会让一个接口的流量把另一个接口一起限掉。</p>
     */
    @Test
    @DisplayName("不同 token 各自持有独立配额")
    void shouldIsolateQuotaBetweenDifferentTokens() {
        String firstToken = nextKey("tenant-a");
        String secondToken = nextKey("tenant-b");

        target.limited(firstToken);
        target.limited(firstToken);

        assertThat(target.limited(secondToken))
                .as("另一个 token 的配额不应被前一个占满")
                .isEqualTo(SUCCEED_MARKER);
    }

    /**
     * 验证注解指定了未注册的 Key 解析器时立即失败，而不是放行。
     *
     * <p>解析器找不到就放行等于限流失效，因此必须以明确异常暴露配置错误。</p>
     */
    @Test
    @DisplayName("注解指定的 Key 解析器未注册时立即失败")
    void shouldFailFastWhenKeyResolverIsNotRegistered() {
        String token = nextKey("unknown-resolver");

        assertThatThrownBy(() -> target.withUnregisteredResolver(token))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("找不到对应的 RateLimiterKeyResolver");
    }

    /**
     * 限流注解的调用目标，覆盖配额放行、自定义提示与解析器缺失三种路径。
     */
    interface RateLimitedBiz {

        /**
         * 按注解配置限流的方法。
         *
         * @param token 限流维度令牌
         * @return 固定标记
         */
        @RateLimiter(keyResolver = ExpressionRateLimiterKeyResolver.class, keyArg = "#token",
                count = COUNT, time = PERIOD_SECONDS)
        String limited(String token);

        /**
         * 配额为 1 且带自定义提示的限流方法。
         *
         * @param token 限流维度令牌
         * @return 固定标记
         */
        @RateLimiter(keyResolver = ExpressionRateLimiterKeyResolver.class, keyArg = "#token",
                count = 1, time = PERIOD_SECONDS, message = CUSTOM_MESSAGE)
        String limitedWithMessage(String token);

        /**
         * 指定未注册解析器的方法，验证配置错误会立即暴露。
         *
         * @param token 限流维度令牌
         * @return 不会正常返回
         */
        @RateLimiter(keyResolver = UnregisteredRateLimiterKeyResolver.class, keyArg = "#token")
        String withUnregisteredResolver(String token);
    }

    /**
     * 限流目标接口的实现，用于统计真正进入业务逻辑的次数。
     */
    static class RateLimitedBizImpl implements RateLimitedBiz {

        /** 已进入目标方法的次数。 */
        private long invocationCount;

        /**
         * 统计进入次数后返回固定标记。
         *
         * @param token 限流维度令牌
         * @return 固定标记
         */
        @Override
        @RateLimiter(keyResolver = ExpressionRateLimiterKeyResolver.class, keyArg = "#token",
                count = COUNT, time = PERIOD_SECONDS)
        public String limited(String token) {
            invocationCount++;
            return SUCCEED_MARKER;
        }

        /**
         * 统计进入次数后返回固定标记。
         *
         * @param token 限流维度令牌
         * @return 固定标记
         */
        @Override
        @RateLimiter(keyResolver = ExpressionRateLimiterKeyResolver.class, keyArg = "#token",
                count = 1, time = PERIOD_SECONDS, message = CUSTOM_MESSAGE)
        public String limitedWithMessage(String token) {
            invocationCount++;
            return SUCCEED_MARKER;
        }

        /**
         * 不应被执行到，用于验证解析器缺失时切面提前失败。
         *
         * @param token 限流维度令牌
         * @return 不会正常返回
         */
        @Override
        @RateLimiter(keyResolver = UnregisteredRateLimiterKeyResolver.class, keyArg = "#token")
        public String withUnregisteredResolver(String token) {
            invocationCount++;
            throw new AssertionError("解析器缺失时不应执行到目标方法");
        }

        /**
         * 读取进入目标方法的次数。
         *
         * @return 进入次数
         */
        long getInvocationCount() {
            return invocationCount;
        }
    }

    /**
     * 故意不注册到切面的解析器，用于验证“找不到解析器”时的失败行为。
     */
    static class UnregisteredRateLimiterKeyResolver implements RateLimiterKeyResolver {

        /**
         * 不会被执行到的解析逻辑。
         *
         * @param joinPoint  AOP 切面
         * @param rateLimiter 限流注解
         * @return 不会正常返回
         */
        @Override
        public String resolver(JoinPoint joinPoint, RateLimiter rateLimiter) {
            throw new AssertionError("未注册的解析器不应被调用");
        }
    }
}
