package com.basicframework.framework.apilog.core.interceptor;

import cn.hutool.core.io.FileUtil;
import cn.hutool.extra.spring.SpringUtil;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.basicframework.framework.common.util.spring.SpringUtils;
import com.basicframework.framework.web.config.WebProperties;
import com.basicframework.framework.web.core.util.WebFrameworkUtils;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationContext;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.util.StopWatch;
import org.springframework.web.method.HandlerMethod;

import javax.tools.JavaCompiler;
import javax.tools.ToolProvider;
import java.io.IOException;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * 验证 API 访问日志拦截器在开发与生产 profile 下的准备、耗时统计与源码定位兜底行为。
 *
 * <p>该拦截器只服务于非生产环境的请求排查：它在请求进入时记录处理器与请求概要并启动计时器，
 * 在请求完成后打印耗时。计时器只由 preHandle 安装，因此生产 profile 下的收尾逻辑必须容忍
 * 计时器缺失；处理器源码定位属于尽力而为，定位失败不得把异常抛回请求链路。用例固定这些
 * 可观察行为，避免"开发期日志设施"反向破坏生产请求。</p>
 *
 * @author shady2713
 */
class ApiAccessLogInterceptorTest {

    /** 计时器属性名，与拦截器内部常量一致；用于断言准备阶段是否真的启动计时。 */
    private static final String ATTRIBUTE_STOP_WATCH = "ApiAccessLogInterceptor.StopWatch";

    /** 被测拦截器。 */
    private final ApiAccessLogInterceptor interceptor = new ApiAccessLogInterceptor();

    /** 当前用例安装的容器，结束后关闭。 */
    private GenericApplicationContext context;
    /** 用例开始前的静态容器，结束后原样恢复。 */
    private ApplicationContext previousContext;

    /** 记录原容器并安装开发 profile 容器，使拦截器进入日志分支。 */
    @BeforeEach
    void setUp() {
        previousContext = SpringUtil.getApplicationContext();
        installProfile("dev");
    }

    /** 关闭自有容器并还原静态容器，避免 profile 泄漏到其他测试。 */
    @AfterEach
    void tearDown() {
        context.close();
        new SpringUtils().setApplicationContext(previousContext);
    }

    /**
     * 开发 profile 下准备阶段必须记录处理器方法并启动计时器，请求体按 JSON 约定读取。
     */
    @Test
    void preHandleRecordsHandlerAndStartsStopWatch() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/admin-api/system/user/create");
        request.addParameter("pageNo", "1");
        request.setContentType("application/json");
        request.setContent("{\"name\":\"张三\"}".getBytes(StandardCharsets.UTF_8));
        HandlerMethod handlerMethod = handlerMethod(WebFrameworkUtils.class, "getTerminal", false);

        boolean result = interceptor.preHandle(request, new MockHttpServletResponse(), handlerMethod);

        assertThat(result).isTrue();
        assertThat(request.getAttribute(ApiAccessLogInterceptor.ATTRIBUTE_HANDLER_METHOD)).isSameAs(handlerMethod);
        assertThat(request.getAttribute(ATTRIBUTE_STOP_WATCH)).isInstanceOf(StopWatch.class);
        StopWatch stopWatch = (StopWatch) request.getAttribute(ATTRIBUTE_STOP_WATCH);
        assertThat(stopWatch.isRunning()).as("准备阶段必须已启动计时").isTrue();
    }

    /**
     * 处理器不是 Controller 方法时不写入处理器属性，但仍继续请求并完成源码定位兜底。
     */
    @Test
    void preHandleToleratesNonHandlerMethod() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/static/index.html");

        boolean result = interceptor.preHandle(request, new MockHttpServletResponse(), new Object());

        assertThat(result).isTrue();
        assertThat(request.getAttribute(ApiAccessLogInterceptor.ATTRIBUTE_HANDLER_METHOD)).isNull();
    }

    /**
     * 处理器源码不在 classpath 对应源码目录时，定位失败必须被兜底，不得影响请求链路。
     */
    @Test
    void preHandleToleratesUnresolvableHandlerSource() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/probe");
        HandlerMethod testOnlyHandler = handlerMethod(TestOnlyProbe.class, "handle", true);

        assertThatCode(() -> interceptor.preHandle(request, new MockHttpServletResponse(), testOnlyHandler))
                .doesNotThrowAnyException();
    }

    /**
     * 处理器源码可定位时必须输出包含真实源码行号的调试日志。
     *
     * <p>探针类在运行期编译到 {@code <临时目录>/target/classes}，源码放在
     * {@code <临时目录>/src/main/java}，与拦截器"由编译输出目录反推源码目录"的约定一致；
     * 临时目录路径全部为 ASCII，避免中文工作区路径被 URL 编码后无法还原成真实文件。</p>
     */
    @Test
    void printHandlerMethodPositionLogsRealSourceLine() throws Exception {
        ResolvedProbe probe = compileProbe();
        try {
            MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/probe");
            HandlerMethod handlerMethod = new HandlerMethod(probe.newInstance(), probe.type.getMethod("handle"));

            String logs = preHandleCapturingDebug(request, handlerMethod);

            assertThat(logs).contains("Controller 方法路径")
                    .contains(probe.type.getName() + "(" + probe.type.getSimpleName() + ".java:"
                            + probe.methodLine + ")");
        } finally {
            probe.close();
        }
    }

    /**
     * 请求完成后必须停止计时器，并保留可读取的总耗时。
     */
    @Test
    void afterCompletionStopsStopWatch() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/system/user/list");
        MockHttpServletResponse response = new MockHttpServletResponse();
        interceptor.preHandle(request, response, handlerMethod(WebFrameworkUtils.class, "getTerminal", false));
        StopWatch stopWatch = (StopWatch) request.getAttribute(ATTRIBUTE_STOP_WATCH);

        interceptor.afterCompletion(request, response, new Object(), null);

        assertThat(stopWatch.isRunning()).as("收尾阶段必须停止计时").isFalse();
        assertThat(stopWatch.getTotalTimeMillis()).isGreaterThanOrEqualTo(0L);
    }

    /**
     * 生产 profile 下不得启动计时器，收尾阶段缺少计时器也必须安全返回。
     */
    @Test
    void prodProfileSkipsStopWatchAndToleratesMissingOne() throws Exception {
        context.close();
        installProfile("prod");
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/system/user/list");
        MockHttpServletResponse response = new MockHttpServletResponse();
        HandlerMethod handlerMethod = handlerMethod(WebFrameworkUtils.class, "getTerminal", false);

        assertThat(interceptor.preHandle(request, response, handlerMethod)).isTrue();
        assertThat(request.getAttribute(ApiAccessLogInterceptor.ATTRIBUTE_HANDLER_METHOD)).isSameAs(handlerMethod);
        assertThat(request.getAttribute(ATTRIBUTE_STOP_WATCH)).as("生产环境不准备计时器").isNull();
        assertThatCode(() -> interceptor.afterCompletion(request, response, handlerMethod, null))
                .doesNotThrowAnyException();
    }

    /**
     * 源码可读但不含该方法声明时跳过定位日志，且不影响请求准备流程。
     *
     * <p>方法被改名或源码与已编译产物不一致是真实的开发期状态，此时定位功能必须静默降级。</p>
     */
    @Test
    void printHandlerMethodPositionSkipsLogWhenMethodAbsentFromSource() throws Exception {
        ResolvedProbe probe = compileProbe();
        try {
            Files.write(probe.sourceFile, List.of(
                    "package com.basicframework.probe;",
                    "",
                    "public class SourceProbe {",
                    "}"), StandardCharsets.UTF_8);
            MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/probe");
            HandlerMethod handlerMethod = new HandlerMethod(probe.newInstance(), probe.type.getMethod("handle"));

            String logs = preHandleCapturingDebug(request, handlerMethod);

            assertThat(logs).contains("开始请求").doesNotContain("Controller 方法路径");
        } finally {
            probe.close();
        }
    }

    /**
     * 安装指定活动 profile 的独立容器，并把静态容器指向它。
     *
     * @param profile 活动 profile 名称
     */
    private void installProfile(String profile) {
        context = new GenericApplicationContext();
        context.getEnvironment().setActiveProfiles(profile);
        context.refresh();
        new SpringUtils().setApplicationContext(context);
    }

    /**
     * 临时把拦截器日志级别降为 DEBUG 并收集日志文本，执行结束后恢复原级别与追加器。
     *
     * @param request HTTP 请求
     * @param handlerMethod 处理器方法
     * @return 本次准备阶段产生的全部日志文本，按行拼接
     */
    private String preHandleCapturingDebug(MockHttpServletRequest request, HandlerMethod handlerMethod) {
        Logger logger = (Logger) LoggerFactory.getLogger(ApiAccessLogInterceptor.class);
        Level previousLevel = logger.getLevel();
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        logger.setLevel(Level.DEBUG);
        try {
            interceptor.preHandle(request, new MockHttpServletResponse(), handlerMethod);
        } finally {
            logger.detachAppender(appender);
            logger.setLevel(previousLevel);
        }
        return appender.list.stream().map(ILoggingEvent::getFormattedMessage)
                .collect(Collectors.joining(System.lineSeparator()));
    }

    /**
     * 在临时目录内编译出带源码的探针类，供源码定位契约使用。
     *
     * @return 探针类、源码行号与需清理的资源
     * @throws IOException 临时目录或源码写入失败时抛出
     */
    private static ResolvedProbe compileProbe() throws IOException {
        Path root = Files.createTempDirectory("api-access-log-probe");
        Path sourceDir = root.resolve("src/main/java/com/basicframework/probe");
        Path classDir = root.resolve("target/classes");
        Files.createDirectories(sourceDir);
        Files.createDirectories(classDir);
        List<String> lines = List.of(
                "package com.basicframework.probe;",
                "",
                "/** 运行期编译探针，仅用于验证源码定位。 */",
                "public class SourceProbe {",
                "",
                "    /** 探针方法。 */",
                "    public String handle() {",
                "        return \"probe\";",
                "    }",
                "}");
        Path sourceFile = sourceDir.resolve("SourceProbe.java");
        Files.write(sourceFile, lines, StandardCharsets.UTF_8);
        int methodLine = IntStream.range(0, lines.size())
                .filter(index -> lines.get(index).contains(" handle("))
                .map(index -> index + 1)
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("探针源码缺少 handle 方法声明"));

        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        assertThat(compiler).as("源码定位用例需要 JDK 自带编译器").isNotNull();
        int exitCode = compiler.run(null, null, null, "-d", classDir.toString(), sourceFile.toString());
        assertThat(exitCode).as("探针类必须编译成功").isZero();

        URLClassLoader loader = new URLClassLoader(new URL[]{classDir.toUri().toURL()},
                ApiAccessLogInterceptorTest.class.getClassLoader());
        try {
            Class<?> type = Class.forName("com.basicframework.probe.SourceProbe", true, loader);
            return new ResolvedProbe(type, methodLine, sourceFile, loader, root);
        } catch (ClassNotFoundException ex) {
            loader.close();
            FileUtil.del(root.toFile());
            throw new IllegalStateException("探针类无法装载", ex);
        }
    }

    /**
     * 构造处理器方法，可直接复用无参静态方法或测试夹具的实例方法。
     *
     * @param type 声明类型
     * @param methodName 方法名，必须为无参方法
     * @param testFixture 是否使用测试夹具实例；为 false 时使用被测主源码类型的实例
     * @return 处理器方法
     * @throws NoSuchMethodException 方法不存在时抛出
     */
    private static HandlerMethod handlerMethod(Class<?> type, String methodName, boolean testFixture)
            throws NoSuchMethodException {
        Object bean = testFixture ? new TestOnlyProbe() : new WebFrameworkUtils(new WebProperties());
        return new HandlerMethod(bean, type.getMethod(methodName));
    }

    /**
     * 运行期编译出的探针类及其可定位的源码信息，持有需显式清理的类加载器与临时目录。
     */
    private static class ResolvedProbe {

        /** 探针类。 */
        private final Class<?> type;
        /** 源码中方法声明所在行号，从 1 开始。 */
        private final int methodLine;
        /** 探针源码文件，可在用例内改写以模拟源码与产物不一致。 */
        private final Path sourceFile;
        /** 装载探针类的加载器。 */
        private final URLClassLoader loader;
        /** 编译产物与源码的临时根目录。 */
        private final Path root;

        /**
         * 记录探针类及其清理资源。
         *
         * @param type 探针类
         * @param methodLine 方法声明行号
         * @param sourceFile 探针源码文件
         * @param loader 类加载器
         * @param root 临时根目录
         */
        ResolvedProbe(Class<?> type, int methodLine, Path sourceFile, URLClassLoader loader, Path root) {
            this.type = type;
            this.methodLine = methodLine;
            this.sourceFile = sourceFile;
            this.loader = loader;
            this.root = root;
        }

        /**
         * 创建探针实例。
         *
         * @return 探针实例
         * @throws ReflectiveOperationException 实例化失败时抛出
         */
        Object newInstance() throws ReflectiveOperationException {
            return type.getDeclaredConstructor().newInstance();
        }

        /**
         * 关闭类加载器并删除临时目录，失败和成功路径都必须释放。
         *
         * @throws IOException 关闭类加载器失败时抛出
         */
        void close() throws IOException {
            loader.close();
            FileUtil.del(root.toFile());
        }

    }

    /**
     * 仅存在于测试源码目录的探针类型，用于制造源码定位失败的真实条件。
     *
     * @author shady2713
     */
    private static class TestOnlyProbe {

        /**
         * 探针方法，仅提供可定位的方法签名。
         *
         * @return 固定文本
         */
        public String handle() {
            return "probe";
        }

    }

}
