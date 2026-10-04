package com.basicframework.framework.translate.config;

import com.basicframework.framework.translate.core.TranslateUtils;
import com.fhs.trans.service.impl.TransService;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * 验证翻译自动配置把容器内的 Easy-Trans 服务真正接入 {@link TranslateUtils}。
 *
 * <p>该自动配置只注册一个工具类 Bean，真正的作用是初始化静态的翻译服务。只断言 Bean 存在
 * 无法排除“注册了工具类却没完成初始化”：手动翻译入口会因服务为 null 而失败，或在多上下文场景
 * 沿用上一次初始化的服务。因此这里在真实最小上下文中注入翻译服务替身，再经工具类入口调用，
 * 确认调用确实落到本次注入的服务上。</p>
 *
 * @author shady2713
 */
class BasicFrameworkTranslateAutoConfigurationTest {

    /** 应用自动配置后必须注册翻译工具类 Bean。 */
    @Test
    void registersTranslateUtilsBean() {
        contextRunner(mock(TransService.class)).run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).hasSingleBean(TranslateUtils.class);
        });
    }

    /**
     * 手动翻译入口必须把数据交给注入的翻译服务，并原样返回入参集合。
     *
     * <p>{@code TranslateUtils.translate} 是 {@code @TransMethodResult} 无法覆盖时的备用入口，
     * 返回新集合会让调用方的后续写回丢失翻译结果，因此同时锁定“委托”和“返回同一集合”。</p>
     */
    @Test
    void injectedTransServiceReceivesTranslateCalls() {
        TransService transService = mock(TransService.class);
        List<TranslateSample> data = List.of(new TranslateSample());

        contextRunner(transService).run(context -> {
            assertThat(context).hasNotFailed();

            List<TranslateSample> result = TranslateUtils.translate(data);

            verify(transService).transBatch(data);
            assertThat(result).as("必须返回调用方传入的同一集合").isSameAs(data);
        });
    }

    /** 空集合不得触达翻译服务，避免无意义的批量翻译调用。 */
    @Test
    void emptyDataDoesNotTouchTransService() {
        TransService transService = mock(TransService.class);

        contextRunner(transService).run(context -> {
            assertThat(context).hasNotFailed();

            assertThat(TranslateUtils.translate(List.of())).isEmpty();

            verify(transService, org.mockito.Mockito.never()).transBatch(org.mockito.ArgumentMatchers.anyList());
        });
    }

    /**
     * 构造只装配翻译自动配置的最小上下文，并注入翻译服务替身。
     *
     * @param transService 翻译服务替身
     * @return 最小上下文运行器
     */
    private ApplicationContextRunner contextRunner(TransService transService) {
        return new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(BasicFrameworkTranslateAutoConfiguration.class))
                .withBean(TransService.class, () -> transService);
    }

    /** 满足翻译入口泛型约束的样例对象。 */
    static class TranslateSample implements com.fhs.core.trans.vo.VO {
    }

}
