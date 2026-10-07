package com.basicframework.framework.translate.config;

import com.basicframework.framework.translate.core.TranslateUtils;
import com.fhs.trans.service.impl.TransService;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.test.context.assertj.AssertableApplicationContext;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * 运行期锁定翻译自动配置在「容器里没有翻译服务」时的真实装配结果。
 *
 * <p>被测对象是生产 {@link BasicFrameworkTranslateAutoConfiguration}：装配的是真实自动配置类，读的是
 * 真实上下文的启动结果与真实 Bean 注册情况。固定上游版本在该 Bean 方法上带有
 * {@code @ConditionalOnBean(TransService.class)}，翻译服务缺席时静默跳过、不注册工具类；本地版本
 * 删除了该条件，翻译服务缺席时参数无法满足，上下文直接启动失败。现有测试每次都提供了翻译服务替身，
 * 因此这一行为变更**没有任何测试覆盖**；本类专门补上这段覆盖。</p>
 *
 * <p>判别性由同文件内的**契约违反变体** {@link UpstreamShapedTranslateConfiguration} 提供：它与生产
 * 逐行同形，只把上游那条条件加回去。变体在同一探针下必须启动成功且不注册工具类，从而证明生产断言
 * 读到的失败与注册结果确实来自被删掉的条件，而不是上下文装配本身有问题。</p>
 *
 * <p>本类只固定当前实现的运行期行为，不对「无条件装配是否是目标契约」下结论：该判断属于有权者
 * 处置范围。</p>
 *
 * @author 证据与契约方向执行代理
 */
class BasicFrameworkTranslateAutoConfigurationConditionalRuntimeTest {

    /** 生产自动配置：容器内没有翻译服务时必须启动失败，而不是静默跳过。 */
    @Test
    void missingTransServiceFailsContextStartup() {
        runner().run(context -> {
            assertThat(context).as("缺少翻译服务时当前实现会让上下文启动失败").hasFailed();
            assertThat(startupFailureText(context))
                    .as("失败原因必须指向缺失的翻译服务依赖")
                    .contains("TransService");
        });
    }

    /** 契约违反变体在上游形状下静默跳过，同一条断言作用在它上面必须失败。 */
    @Test
    void upstreamShapedVariantSilentlySkipsSoAssertionDiscriminates() {
        new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(UpstreamShapedTranslateConfiguration.class))
                .run(context -> {
                    assertThat(context).as("上游形状不因缺少翻译服务而失败").hasNotFailed();
                    assertThat(context).as("上游形状下不注册工具类").doesNotHaveBean(TranslateUtils.class);
                });
    }

    /** 提供翻译服务时生产自动配置必须正常启动，并把工具类接入到本次注入的服务上。 */
    @Test
    void providedTransServiceStartsAndWiresTranslateUtils() {
        TransService transService = mock(TransService.class);
        List<TranslateSample> data = List.of(new TranslateSample());

        runner().withBean(TransService.class, () -> transService).run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).hasSingleBean(TranslateUtils.class);

            assertThat(TranslateUtils.translate(data)).as("必须把数据交给本次注入的服务处理").isSameAs(data);
            verify(transService).transBatch(data);
        });
    }

    /** 装配只含生产自动配置的最小上下文。 */
    private ApplicationContextRunner runner() {
        return new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(BasicFrameworkTranslateAutoConfiguration.class));
    }

    /**
     * 读取真实启动失败链上的异常文本。
     *
     * @param context 失败的上下文
     * @return 异常链上的全部提示文本
     */
    private static String startupFailureText(AssertableApplicationContext context) {
        Throwable failure = context.getStartupFailure();
        StringBuilder text = new StringBuilder();
        for (Throwable current = failure; current != null; current = current.getCause()) {
            text.append(current.getClass().getName()).append(": ").append(current.getMessage()).append('\n');
        }
        return text.toString();
    }

    /** 满足翻译入口泛型约束的样例对象。 */
    static class TranslateSample implements com.fhs.core.trans.vo.VO {
    }

    /**
     * 契约违反变体：与生产逐行同形，只加回上游的条件装配注解。
     *
     * <p>它只用于负对照，不参与任何生产路径。</p>
     */
    @AutoConfiguration
    static class UpstreamShapedTranslateConfiguration {

        /** 翻译工具类注册方法，额外加上游的条件装配注解。 */
        @Bean
        @ConditionalOnBean(TransService.class)
        @SuppressWarnings({"InstantiationOfUtilityClass", "SpringJavaInjectionPointsAutowiringInspection"})
        public TranslateUtils translateUtils(TransService transService) {
            TranslateUtils.init(transService);
            return new TranslateUtils();
        }
    }

}