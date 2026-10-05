package com.basicframework.framework.security.config;

import jakarta.annotation.security.PermitAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.http.HttpMethod;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.springframework.web.util.pattern.PathPattern;

import java.lang.reflect.Method;

import com.google.common.collect.Multimap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;

/**
 * 验证免登录白名单推导在“映射不提供任何路径模式”时的防御行为。
 *
 * <p>{@code getPermitAllUrlsFromAnnotations} 先用 {@code getPatternsCondition()} 与
 * {@code getPathPatternsCondition()} 收集路径；两条路径条件都不提供模式时收集结果为空集，
 * 此时必须在读取请求方法条件之前跳过该映射。若继续往下走，一条没有路径的免登录规则会按请求方法
 * 被写进白名单，把免登录范围扩大到根路径，因此这条跳过是安全边界，不是冗余判断。</p>
 *
 * <p>该边界在 Spring 6.2 里无法由真实映射触发：{@code RequestMappingHandlerMapping#getMappingForMethod}
 * 会把真正无路径的映射补写成 {@code ["", "/"]}；即使绕开这次补写，构建器对空路径也会落在一个空串模式上
 * （{@code PathPattern} 形态取 {@code {""}}，Ant 形态取 {@code {""}}），收集结果永远非空。所以本用例
 * 把驱动点放在**映射注册这一装配边界**：向真实 {@link RequestMappingHandlerMapping} 的注册表登记一个
 * “两条路径条件都返回 null”的映射边界替身，它承载真实 {@link HandlerMethod} 与真实映射对象，只有两条
 * 路径条件被替换成 null。断言落在“收集器确实消费了它、却没有读取请求方法条件”上，因此该行是被真实执行
 * 与真实断言的，不是无断言执行凑覆盖。</p>
 *
 * @author shady2713
 */
class BasicFrameworkWebSecurityConfigurerAdapterPathlessMappingTest {

    /** 真实控制器注册的免登录 URL，作为正对照。 */
    private static final String REAL_PERMIT_ALL_URL = "/test/pathless-probe/permit-all";

    /** 边界替身的映射名，用于确认它没有以任何形式进入白名单。 */
    private static final String PATHLESS_MAPPING_NAME = "d9-pathless";

    /** 被测适配器，仅用于调用私有白名单推导方法。 */
    private final BasicFrameworkWebSecurityConfigurerAdapter adapter = new BasicFrameworkWebSecurityConfigurerAdapter();

    /** 测试创建的上下文，负责在用例结束后关闭。 */
    private GenericApplicationContext context;

    /** 两条路径条件都返回 null 的免登录映射边界替身。 */
    private RequestMappingInfo nullPathConditionsMapping;

    /** 关闭测试上下文，避免容器资源残留。 */
    @AfterEach
    void closeContext() {
        if (context != null) {
            context.close();
            context = null;
        }
    }

    /**
     * 锁定“构建器产不出零模式映射”这一前提，说明驱动空集分支的用例为什么必须用映射边界替身。
     *
     * <p>两种装配形态都测：默认 {@code PathPatternParser} 形态下空路径落成 {@code {""}}，
     * 关掉 PathPattern 并给出 {@code PathMatcher} 的 Ant 形态下同样落成 {@code {""}}。两种形态都被
     * Spring 判定为空映射并会被补写，因此真实映射的收集结果至少含空串，永远不会走进“集合为空即跳过”。
     * 若将来 Spring 改变这一行为，本用例会失败，提示应改用真实映射驱动该分支。</p>
     */
    @Test
    void springBuilderNeverProducesMappingWithoutAnyPathPattern() {
        RequestMappingInfo.BuilderConfiguration legacyConfig = new RequestMappingInfo.BuilderConfiguration();
        legacyConfig.setPatternParser(null);
        legacyConfig.setPathMatcher(new AntPathMatcher());

        RequestMappingInfo pathPatternMapping = RequestMappingInfo.paths().methods(RequestMethod.GET).build();
        RequestMappingInfo legacyMapping = RequestMappingInfo.paths()
                .methods(RequestMethod.GET).options(legacyConfig).build();

        assertThat(pathPatternMapping.getPatternsCondition()).as("PathPattern 形态不产生 legacy 路径条件").isNull();
        assertThat(pathPatternMapping.getPathPatternsCondition().getPatterns()).as("PathPattern 形态的空路径是一个空串模式")
                .extracting(PathPattern::getPatternString).containsExactly("");
        assertThat(pathPatternMapping.isEmptyMapping()).as("PathPattern 形态会被 Spring 判定为空映射并补写根路径").isTrue();

        assertThat(legacyMapping.getPathPatternsCondition()).as("Ant 形态不产生 PathPattern 条件").isNull();
        assertThat(legacyMapping.getPatternsCondition().getPatterns()).as("Ant 形态的空路径同样是一个空串模式")
                .containsExactly("");
        assertThat(legacyMapping.isEmptyMapping()).as("Ant 形态会被 Spring 判定为空映射并补写根路径").isTrue();
    }

    /**
     * 两条路径条件都不提供模式的免登录映射必须被跳过，且请求方法条件不得被读取。
     *
     * <p>断言分四层：替身的前置状态成立；收集器确实消费了替身（否则“从未读取请求方法条件”会像只校验
     * 自己的空断言一样恒真）；替身的 {@code getMethodsCondition()} 从未被读取；白名单恰好等于真实控制器
     * 的正对照。若跳过 L196 的 {@code continue}，收集器会读取请求方法条件，{@code never()} 那条断言立即失败。</p>
     *
     * <p>前置状态断言自身会调用替身，Mockito 会把它们记为交互，所以这里在状态断言之后、调用收集器之前
     * 显式清空交互记录：此后 {@code verify} 观察到的只可能是生产代码的调用。这正是原用例“因错误的原因
     * 通过”的成因——旧断言把替身注册在无人消费的 bean 上，两条 {@code verify} 实际是被自己的前置断言
     * 满足的。</p>
     */
    @Test
    void pathlessPermitAllMappingIsSkippedBeforeRequestMethodCondition() {
        prepareContext();

        // 前置条件：替身两条路径条件都为 null，收集器的 urls 集合必然为空
        assertThat(nullPathConditionsMapping.getPatternsCondition()).as("前置条件：替身映射不得携带 legacy 路径条件").isNull();
        assertThat(nullPathConditionsMapping.getPathPatternsCondition()).as("前置条件：替身映射不得携带 PathPattern 条件").isNull();

        clearInvocations(nullPathConditionsMapping);
        Multimap<HttpMethod, String> collected = collectPermitAllUrls();

        verify(nullPathConditionsMapping).getPatternsCondition();
        verify(nullPathConditionsMapping).getPathPatternsCondition();
        verify(nullPathConditionsMapping, never()).getMethodsCondition();

        assertThat(collected.get(HttpMethod.GET)).as("正对照：真实控制器的免登录接口必须仍然被收集")
                .containsExactly(REAL_PERMIT_ALL_URL);
        assertThat(collected.values()).as("无路径替身不得产出任何 URL")
                .doesNotContain("", "/", PATHLESS_MAPPING_NAME);
        assertThat(collected.size()).as("白名单只应来自真实控制器注册，替身映射必须被整体跳过").isEqualTo(1);
    }

    /**
     * 构建上下文：登记可注入替身的真实映射器与真实控制器，再登记无路径免登录替身。
     *
     * <p>映射器是真实 {@link RequestMappingHandlerMapping} 子类，只把注册表入口暴露给测试；控制器作为普通
     * bean 注册，由 Spring 自己扫描出正对照映射。</p>
     */
    private void prepareContext() {
        context = new GenericApplicationContext();
        context.registerBean("requestMappingHandlerMapping", InjectableRequestMappingHandlerMapping.class,
                InjectableRequestMappingHandlerMapping::new);
        context.registerBean(PathlessProbeController.class);
        context.refresh();

        nullPathConditionsMapping = spy(RequestMappingInfo.paths()
                .methods(RequestMethod.GET).mappingName(PATHLESS_MAPPING_NAME).build());
        doReturn(null).when(nullPathConditionsMapping).getPatternsCondition();
        doReturn(null).when(nullPathConditionsMapping).getPathPatternsCondition();

        InjectableRequestMappingHandlerMapping handlerMapping =
                context.getBean("requestMappingHandlerMapping", InjectableRequestMappingHandlerMapping.class);
        handlerMapping.registerPathlessPermitAllMapping(nullPathConditionsMapping,
                new PermitAllProbeFixture(), permitAllProbeMethod());
        ReflectionTestUtils.setField(adapter, "applicationContext", context);
    }

    /**
     * 调用被测适配器的私有白名单推导入口。
     *
     * @return 免登录 URL 集合，按请求方法分组
     */
    @SuppressWarnings("unchecked")
    private Multimap<HttpMethod, String> collectPermitAllUrls() {
        return ReflectionTestUtils.invokeMethod(adapter, "getPermitAllUrlsFromAnnotations");
    }

    /**
     * 查找无路径免登录夹具方法，供注册表登记真实 {@link HandlerMethod}。
     *
     * @return 带 {@code @PermitAll} 的夹具方法
     * @throws IllegalStateException 夹具方法缺失时抛出，说明测试夹具本身被改坏
     */
    private static Method permitAllProbeMethod() {
        try {
            return PermitAllProbeFixture.class.getDeclaredMethod("permitAllEndpoint");
        } catch (NoSuchMethodException exception) {
            throw new IllegalStateException("控制器夹具方法缺失", exception);
        }
    }

    /**
     * 可注入额外映射的真实请求映射器。
     *
     * <p>只暴露 Spring 自己扫描控制器时使用的 {@code registerHandlerMethod} 入口，不覆盖
     * {@code getHandlerMethods()}，因此被登记的映射与真实扫描出的映射同处一个注册表，收集器看到的就是
     * 生产环境同款结构；与 Spring 扫描的唯一差别是调用方不经过 {@code getMappingForMethod}，从而避开
     * 它对空路径的补写。</p>
     */
    private static final class InjectableRequestMappingHandlerMapping extends RequestMappingHandlerMapping {

        /**
         * 把不提供路径模式的免登录映射登记进真实注册表。
         *
         * @param mapping 待登记的映射，其两条路径条件都不提供模式
         * @param fixture 处理器实例，其被登记的方法必须带 {@code @PermitAll}
         * @param method 被登记的处理器方法
         * @throws IllegalStateException 映射与既有登记冲突时由注册表抛出，表示夹具装配冲突
         */
        private void registerPathlessPermitAllMapping(RequestMappingInfo mapping, Object fixture, Method method) {
            registerHandlerMethod(fixture, method, mapping);
        }
    }

    /**
     * 无路径免登录接口的处理器夹具。
     *
     * <p>刻意不作为 bean 注册：它的映射由测试显式登记，避免 Spring 扫描时按补写规则生成根路径映射，
     * 从而让“不提供任何路径模式”的映射形态只由替身代表。</p>
     *
     * @author shady2713
     */
    private static final class PermitAllProbeFixture {

        /**
         * 无路径的免登录探针接口。
         *
         * @return 固定响应
         */
        @PermitAll
        @GetMapping
        public String permitAllEndpoint() {
            return "ok";
        }
    }

    /**
     * 带真实路径与 {@code @PermitAll} 的控制器夹具，作为收集器的正对照。
     *
     * @author shady2713
     */
    @RestController
    @RequestMapping("/test/pathless-probe")
    public static class PathlessProbeController {

        /**
         * 免登录探针接口。
         *
         * @return 固定响应
         */
        @PermitAll
        @RequestMapping(value = "/permit-all", method = RequestMethod.GET)
        public String permitAllEndpoint() {
            return "ok";
        }
    }

}
