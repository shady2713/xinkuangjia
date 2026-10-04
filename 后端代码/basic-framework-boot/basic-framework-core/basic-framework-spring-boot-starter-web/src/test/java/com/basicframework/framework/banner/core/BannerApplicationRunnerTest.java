package com.basicframework.framework.banner.core;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.slf4j.LoggerFactory;
import org.springframework.boot.DefaultApplicationArguments;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证启动提示 Runner 的异步输出契约。
 *
 * <p>该 Runner 由自动配置在应用启动后调用，作用是延迟一秒再打印访问地址提示，
 * 让提示出现在其他启动日志之后。两个契约必须同时成立：{@code run} 不能阻塞调用线程
 * （否则会拖慢真实启动），并且提示最终必须被打印（否则部署时静默缺少启动信息）。
 * 因此本用例先断言调用返回时还没有任何输出，再等待异步任务真正写日志。</p>
 *
 * <p>日志通过真实 Logback Logger 上的 {@link ListAppender} 观察，断言级别、文案、
 * 恰好一条以及执行线程不是调用线程；执行线程不同是"异步"这一契约的直接证据。</p>
 *
 * @author shady2713
 */
class BannerApplicationRunnerTest {

    /** 提示文案的分隔线长度，与实现保持一致。 */
    private static final int SEPARATOR_LENGTH = 58;

    /** 期望的完整提示文案。 */
    private static final String EXPECTED_BANNER = "\n" + "-".repeat(SEPARATOR_LENGTH)
            + "\n\t项目启动成功！\n" + "-".repeat(SEPARATOR_LENGTH);

    /** 等待异步提示出现的上限，覆盖实现里 1 秒的固定延迟。 */
    private static final Duration BANNER_WAIT = Duration.ofSeconds(5);

    /** 被测 Runner 使用的真实 Logger。 */
    private Logger runnerLogger;
    /** 记录进入用例前的日志级别，供还原使用。 */
    private Level previousLevel;
    /** 挂在被测 Logger 上收集日志事件的追加器。 */
    private ListAppender<ILoggingEvent> appender;

    /** 挂载追加器并固定级别，使提示日志可被稳定观察。 */
    @BeforeEach
    void attachAppender() {
        runnerLogger = (Logger) LoggerFactory.getLogger(BannerApplicationRunner.class);
        previousLevel = runnerLogger.getLevel();
        runnerLogger.setLevel(Level.INFO);
        appender = new ListAppender<>();
        appender.start();
        runnerLogger.addAppender(appender);
    }

    /** 卸载追加器并还原日志级别，避免影响同 JVM 的其他测试。 */
    @AfterEach
    void detachAppender() {
        runnerLogger.detachAppender(appender);
        appender.stop();
        runnerLogger.setLevel(previousLevel);
    }

    /**
     * 提示必须在延迟后异步打印，且不阻塞调用线程。
     *
     * <p>实现先提交异步任务再立即返回，因此 {@code run} 返回时不可能已经有输出；
     * 随后在一秒延迟后打印唯一一条 INFO 提示。断言完整文案可防止提示内容被改写后
     * 运维依赖的启动信息静默消失。</p>
     */
    @Test
    @Timeout(20)
    void bannerIsLoggedAsynchronouslyWithoutBlockingCaller() throws Exception {
        BannerApplicationRunner runner = new BannerApplicationRunner();

        runner.run(new DefaultApplicationArguments(new String[0]));

        assertThat(appender.list)
                .as("run 返回时提示尚未打印，说明启动流程没有被一秒延迟阻塞")
                .isEmpty();

        ILoggingEvent event = awaitFirstBannerEvent();
        assertThat(event.getFormattedMessage()).isEqualTo(EXPECTED_BANNER);
        assertThat(event.getLevel()).isEqualTo(Level.INFO);
        assertThat(event.getThreadName())
                .as("提示必须由异步线程打印，不能占用启动线程")
                .isNotEqualTo(Thread.currentThread().getName());
        assertThat(appender.list).as("一次启动只打印一条提示").hasSize(1);
    }

    /**
     * 等待第一条提示日志出现。
     *
     * <p>等待有明确上限，超时即失败，避免在不会发生的转换上无限等待。</p>
     *
     * @return 第一条提示日志事件
     * @throws InterruptedException 等待期间线程被中断时抛出，由用例直接失败
     */
    private ILoggingEvent awaitFirstBannerEvent() throws InterruptedException {
        long deadline = System.nanoTime() + BANNER_WAIT.toNanos();
        while (System.nanoTime() < deadline) {
            if (!appender.list.isEmpty()) {
                return appender.list.get(0);
            }
            Thread.sleep(20);
        }
        throw new AssertionError("等待 " + BANNER_WAIT.toSeconds() + " 秒仍未打印启动提示");
    }
}
