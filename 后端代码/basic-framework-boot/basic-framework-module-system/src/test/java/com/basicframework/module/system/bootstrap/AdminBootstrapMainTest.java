package com.basicframework.module.system.bootstrap;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

/**
 * 验证一次性管理员入口的拒绝与错误分类出口：参数、配置与意外失败都不输出环境值。
 *
 * <p>该入口在受控离线进程中执行，输出会落到运维可见的日志，因此错误出口必须只打印固定
 * 分类：命令行参数一律拒绝（防止口令或连接信息经进程列表泄漏）、配置缺失按拒绝处理、任何
 * 非预期运行时错误只输出固定分类并退出 4，绝不把异常消息、连接地址或凭据写进输出。数据库
 * 成功与存储失败路径需要真实 MySQL，由 {@code AdminBootstrapMySqlIT} 覆盖；静态入口
 * {@code main} 需要真实进程退出，本用例不覆盖。</p>
 *
 * @author shady2713
 */
class AdminBootstrapMainTest {

    /** 无副作用的空白输出流，用于丢弃成功输出。 */
    private final ByteArrayOutputStream output = new ByteArrayOutputStream();
    /** 固定错误分类输出流，用于断言对外可见的失败文案。 */
    private final ByteArrayOutputStream error = new ByteArrayOutputStream();

    /**
     * 无终端环境下读取口令必须按配置拒绝，而不是回退到回显 stdin。
     *
     * <p><b>白盒直调：</b>{@code readConsolePassword} 是私有方法，公开入口 {@code main} 会
     * 调用 {@code System.exit}，无法在测试 JVM 内直接执行。这里直接校验该方法的真实契约：
     * 通过 {@code System.console()} 读取无回显口令，重定向 stdin 或没有终端时必须抛出
     * {@link BootstrapFailure} 的 {@code INVALID_CONFIGURATION} 分类，绝不读取普通 stdin。
     * 本用例只在确实没有终端的测试 JVM 中运行，避免卡在交互读取上。</p>
     */
    @Test
    void consolePasswordReadIsRejectedWithoutTerminal() throws Exception {
        org.junit.jupiter.api.Assumptions.assumeTrue(System.console() == null,
                "存在真实终端时无法在测试内验证无回显拒绝路径");
        Method read = AdminBootstrapMain.class.getDeclaredMethod("readConsolePassword", String.class);
        read.setAccessible(true);

        InvocationTargetException thrown = catchThrowableOfType(() -> read.invoke(null, "Administrator password: "),
                InvocationTargetException.class);

        assertThat(thrown).as("无终端时必须抛出拒绝分类").isNotNull();
        assertThat(thrown.getCause()).isInstanceOf(BootstrapFailure.class)
                .hasMessage(BootstrapFailure.Reason.INVALID_CONFIGURATION.name());
    }

    /** 命令行参数必须被拒绝，避免口令或连接信息出现在进程列表。 */
    @Test
    void commandLineArgumentsAreRejected() {
        int code = execute(new String[]{"password=DUMMY-CLI-SECRET"}, new HashMap<>());

        assertThat(code).isEqualTo(2);
        assertThat(errorLines()).containsExactly("BOOTSTRAP_REJECTED INVALID_CONFIGURATION");
    }

    /** 缺少必填配置时必须按拒绝退出 2，且输出不含环境中的任何取值。 */
    @Test
    void missingConfigurationIsRejectedWithoutLeakingValues() {
        Map<String, String> environment = new HashMap<>();
        environment.put("DB_USERNAME", "credential-user-should-not-leak");

        int code = execute(new String[0], environment);

        assertThat(code).isEqualTo(2);
        assertThat(errorLines()).containsExactly("BOOTSTRAP_REJECTED INVALID_CONFIGURATION");
        assertThat(errorText()).doesNotContain("credential-user-should-not-leak");
    }

    /** 非预期的运行时错误必须只输出固定分类并退出 4，不得泄漏异常消息。 */
    @Test
    void unexpectedRuntimeFailureIsSanitized() {
        Map<String, String> environment = new HashMap<>() {

            /** 模拟环境读取本身抛出非预期运行时错误，消息中带有不得外泄的内容。 */
            @Override
            public String get(Object key) {
                throw new UnsupportedOperationException("internal-detail-should-not-leak");
            }
        };

        int code = execute(new String[0], environment);

        assertThat(code).as("意外运行错误按固定分类退出 4").isEqualTo(4);
        assertThat(errorLines()).containsExactly("BOOTSTRAP_UNEXPECTED_FAILURE");
        assertThat(errorText()).doesNotContain("internal-detail-should-not-leak");
    }

    /** 拒绝分类不得回显环境值，即使配置项本身包含可疑内容。 */
    @Test
    void rejectionOutputNeverEchoesConfigurationValues() {
        Map<String, String> environment = new HashMap<>();
        environment.put("BOOTSTRAP_JDBC_URL", "jdbc:mysql://127.0.0.1:3306/leakdb");
        environment.put("BOOTSTRAP_CONFIRM_DATABASE", "anotherdb");

        int code = execute(new String[0], environment);

        assertThat(code).as("确认库名与 URL 不一致时拒绝初始化").isEqualTo(2);
        assertThat(errorLines()).containsExactly("BOOTSTRAP_REJECTED TARGET_MISMATCH");
        assertThat(errorText()).doesNotContain("leakdb", "anotherdb", "127.0.0.1");
    }

    /**
     * 以真实入口逻辑执行一次初始化尝试，交互输入边界始终拒绝。
     *
     * @param args 入口参数
     * @param environment 受控环境
     * @return 与 {@code main} 相同的退出码
     */
    private int execute(String[] args, Map<String, String> environment) {
        PrintStream stream = new PrintStream(error, true, StandardCharsets.UTF_8);
        return AdminBootstrapMain.execute(args, environment, prompt -> {
            throw new AssertionError("本用例不应读取终端口令");
        }, new PrintStream(output, true, StandardCharsets.UTF_8), stream);
    }

    /** 读取固定错误分类输出文本。 */
    private String errorText() {
        return error.toString(StandardCharsets.UTF_8);
    }

    /** 按行读取固定错误分类输出，锁定每次失败只输出一条固定分类。 */
    private List<String> errorLines() {
        return errorText().lines().toList();
    }
}
