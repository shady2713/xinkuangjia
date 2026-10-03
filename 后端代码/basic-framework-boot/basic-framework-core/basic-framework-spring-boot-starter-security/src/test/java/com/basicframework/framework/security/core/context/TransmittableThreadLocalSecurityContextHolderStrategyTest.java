package com.basicframework.framework.security.core.context;

import com.alibaba.ttl.threadpool.TtlExecutors;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.context.SecurityContextHolderStrategy;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

/**
 * 验证 {@link TransmittableThreadLocalSecurityContextHolderStrategy} 的上下文生命周期。
 *
 * <p>该策略存在的唯一理由是把登录态带进异步线程，同时避免线程池复用时把旧身份带给下一个任务；
 * 因此“子线程可见”与“父线程清理后子线程不可见”都是必须锁定的边界。</p>
 *
 * @author shady2713
 */
class TransmittableThreadLocalSecurityContextHolderStrategyTest {

    private SecurityContextHolderStrategy strategy;

    /** 每例使用独立策略实例，并保证当前线程从空上下文开始。 */
    @BeforeEach
    void setUp() {
        strategy = new TransmittableThreadLocalSecurityContextHolderStrategy();
        strategy.clearContext();
    }

    /** 清理本策略写入的上下文，避免影响同 JVM 的其他测试。 */
    @AfterEach
    void tearDown() {
        strategy.clearContext();
    }

    /** 创建空上下文必须得到可用的空实现，而不是 null。 */
    @Test
    void createEmptyContextReturnsUsableContext() {
        SecurityContext context = strategy.createEmptyContext();

        assertThat(context).isNotNull();
        assertThat(context.getAuthentication()).isNull();
    }

    /** 首次读取时必须惰性创建上下文，使调用方无需显式初始化。 */
    @Test
    void getContextCreatesContextOnFirstAccess() {
        SecurityContext first = strategy.getContext();
        SecurityContext second = strategy.getContext();

        assertThat(first).isNotNull();
        assertThat(first).as("同一线程应复用同一上下文").isSameAs(second);
    }

    /** 设置的上下文必须能被读到同一实例。 */
    @Test
    void setContextIsVisibleToGetContext() {
        SecurityContext context = strategy.createEmptyContext();
        context.setAuthentication(authenticationOf(1L));

        strategy.setContext(context);

        assertThat(strategy.getContext()).isSameAs(context);
        assertThat(strategy.getContext().getAuthentication().getPrincipal()).isEqualTo(context.getAuthentication().getPrincipal());
    }

    /** 空上下文不得被接受，否则后续读取会得到 null 并使鉴权判断失去依据。 */
    @Test
    void setContextRejectsNull() {
        assertThatIllegalArgumentException().isThrownBy(() -> strategy.setContext(null))
                .withMessageContaining("non-null");
    }

    /** 清理后必须读到全新空上下文，验证清理动作真实移除旧身份。 */
    @Test
    void clearContextRemovesPreviousIdentity() {
        SecurityContext context = strategy.createEmptyContext();
        context.setAuthentication(authenticationOf(2L));
        strategy.setContext(context);
        assertThat(strategy.getContext().getAuthentication()).isNotNull();

        strategy.clearContext();

        assertThat(strategy.getContext().getAuthentication())
                .as("线程池复用时残留身份会被下一个请求继承").isNull();
    }

    /** 替换上下文后旧身份不得残留。 */
    @Test
    void replacedContextDiscardsPreviousIdentity() {
        SecurityContext first = strategy.createEmptyContext();
        first.setAuthentication(authenticationOf(3L));
        strategy.setContext(first);

        SecurityContext second = strategy.createEmptyContext();
        second.setAuthentication(authenticationOf(4L));
        strategy.setContext(second);

        assertThat(strategy.getContext().getAuthentication().getPrincipal()).isNotSameAs(first.getAuthentication().getPrincipal());
    }

    /**
     * 登录态必须传递到异步线程。
     * 若传递失效，异步任务会以匿名身份执行，越权判定会错误地落到拒绝或默认放行。
     */
    @Test
    void contextIsTransmittedToAsyncTask() throws Exception {
        Authentication authentication = authenticationOf(5L);
        SecurityContext context = strategy.createEmptyContext();
        context.setAuthentication(authentication);
        strategy.setContext(context);
        ExecutorService executor = Executors.newSingleThreadExecutor();

        try {
            Future<Authentication> future = executor.submit(() ->
                    new TransmittableThreadLocalSecurityContextHolderStrategy()
                            .getContext().getAuthentication());
            assertThat(future.get()).as("异步线程必须看到提交时的登录态").isNotNull();
            assertThat(((LoginUser) future.get().getPrincipal()).getId()).isEqualTo(5L);
        } finally {
            executor.shutdownNow();
        }
    }

    /**
     * 使用 TTL 包装的线程池同样必须传递登录态，这是生产异步场景的实际用法。
     */
    @Test
    void contextIsTransmittedThroughTtlExecutor() throws Exception {
        SecurityContext context = strategy.createEmptyContext();
        context.setAuthentication(authenticationOf(6L));
        strategy.setContext(context);
        ExecutorService executor = TtlExecutors.getTtlExecutorService(Executors.newSingleThreadExecutor());

        try {
            Future<Authentication> future = executor.submit(() ->
                    new TransmittableThreadLocalSecurityContextHolderStrategy()
                            .getContext().getAuthentication());
            assertThat(((LoginUser) future.get().getPrincipal()).getId()).isEqualTo(6L);
        } finally {
            executor.shutdownNow();
        }
    }

    /**
     * 父线程清理后，新提交的任务不得再看到已清理的身份。
     * 该场景对应线程池复用：若仍可见，上一个请求的登录态会泄漏给下一个请求。
     */
    @Test
    void clearedContextIsNotTransmittedToNewTask() throws Exception {
        SecurityContext context = strategy.createEmptyContext();
        context.setAuthentication(authenticationOf(7L));
        strategy.setContext(context);
        ExecutorService executor = TtlExecutors.getTtlExecutorService(Executors.newSingleThreadExecutor());

        try {
            strategy.clearContext();
            Future<Authentication> future = executor.submit(() ->
                    new TransmittableThreadLocalSecurityContextHolderStrategy()
                            .getContext().getAuthentication());
            assertThat(future.get())
                    .as("清理后不得把旧身份带给后续任务").isNull();
        } finally {
            executor.shutdownNow();
        }
    }

    /**
     * 记录新建裸线程的真实继承行为。
     *
     * <p>{@code TransmittableThreadLocal} 本身是可继承线程本地，
     * 因此 {@code new Thread(...)} 派生的线程会连同登录态一起继承。
     * 这意味着仅靠“换了线程”不能隔离身份，异步任务必须显式管理上下文生命周期。</p>
     */
    @Test
    void plainNewThreadInheritsParentContext() throws Exception {
        SecurityContext context = strategy.createEmptyContext();
        context.setAuthentication(authenticationOf(8L));
        strategy.setContext(context);
        AtomicReference<Authentication> observed = new AtomicReference<>();
        Thread thread = new Thread(() -> observed.set(
                new TransmittableThreadLocalSecurityContextHolderStrategy()
                        .getContext().getAuthentication()));
        thread.start();
        thread.join();

        assertThat(observed.get())
                .as("可继承线程本地会让新建线程看到父线程身份")
                .isNotNull();
        assertThat(((LoginUser) observed.get().getPrincipal()).getId()).isEqualTo(8L);
    }

    /**
     * 父线程清理后，新建线程不得再看到已清理的身份。
     * 该场景对应“清理后仍创建子线程”，残留继承会把已注销身份继续扩散。
     */
    @Test
    void newThreadAfterClearDoesNotInheritContext() throws Exception {
        SecurityContext context = strategy.createEmptyContext();
        context.setAuthentication(authenticationOf(10L));
        strategy.setContext(context);
        strategy.clearContext();
        AtomicReference<Authentication> observed = new AtomicReference<>();
        Thread thread = new Thread(() -> observed.set(
                new TransmittableThreadLocalSecurityContextHolderStrategy()
                        .getContext().getAuthentication()));
        thread.start();
        thread.join();

        assertThat(observed.get())
                .as("清理后新建线程不得继承旧身份").isNull();
    }

    /** 写入真实登录用户后，本策略读出的认证信息必须携带该用户。 */
    @Test
    void contextCarriesRealLoginUser() {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(9L);
        loginUser.setUserType(UserTypeEnum.ADMIN.getValue());
        SecurityFrameworkUtils.setLoginUser(loginUser, new MockHttpServletRequest());

        LoginUser read = SecurityFrameworkUtils.getLoginUser();
        assertThat(read).isNotNull();
        assertThat(read.getId()).isEqualTo(9L);
        assertThat(read.getUserType()).isEqualTo(UserTypeEnum.ADMIN.getValue());
    }

    /** 构造仅含编号的管理员认证信息。 */
    private static Authentication authenticationOf(Long userId) {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(userId);
        loginUser.setUserType(UserTypeEnum.ADMIN.getValue());
        return new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(
                loginUser, null, java.util.List.of());
    }
}
