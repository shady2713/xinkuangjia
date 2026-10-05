package com.basicframework.module.system.bootstrap;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

/**
 * 验证一次性管理员入口的拒绝与错误分类出口：参数、配置与意外失败都不输出环境值。
 *
 * <p>该入口在受控离线进程中执行，输出会落到运维可见的日志，因此错误出口必须只打印固定
 * 分类：命令行参数一律拒绝（防止口令或连接信息经进程列表泄漏）、配置缺失按拒绝处理、任何
 * 非预期运行时错误只输出固定分类并退出 4，绝不把异常消息、连接地址或凭据写进输出。</p>
 *
 * <p>静态入口 {@code main} 通过内部终止动作引用结束进程，因此本用例可以在隔离作用域内
 * 替换该动作、观察真实 {@code main} 传出的退出码；「默认真实退出进程」仍由子进程回归
 * {@code AdminBootstrapMainProcessTest} 覆盖。真实建号成功路径需要 MySQL，
 * 由 {@code AdminBootstrapMySqlIT} 覆盖。</p>
 *
 * @author shady2713
 */
class AdminBootstrapMainTest {

    /**
     * 环境口令的探针取值：带 {@code DUMMY-} 前缀的合成占位串，用于确认执行入口真的把它交给存储
     * 阶段且不回显。它不是可用凭据，仓库的密钥扫描按该前缀约定识别合成值；取值仍覆盖大小写字母、
     * 数字与特殊字符并要求 12 位以上，从而真实通过口令策略走到连接存储的阶段。
     */
    private static final String ENVIRONMENT_PASSWORD = "DUMMY-Env-Probe-Password-A1";

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
     * 第一次无回显读取遇到 EOF 时必须按口令确认失败拒绝。
     *
     * <p>终端输入流结束（例如运维直接 Ctrl-D）时读取返回 null。此时既不能把 null 当成空口令
     * 继续连接数据库，也不能抛空指针：实现必须先命中「口令为空」这一侧并按固定分类拒绝。
     * 用例同时断言第二次读取得到的数组仍被清零，确认失败出口没有留下明文。</p>
     */
    @Test
    void endOfInputOnFirstPasswordReadIsRejectedAndConfirmationIsCleared() {
        AtomicInteger reads = new AtomicInteger();
        char[] confirmation = "Probe-Confirmation-A1".toCharArray();

        int code = execute(bootstrapEnvironment(), prompt ->
                reads.getAndIncrement() == 0 ? null : confirmation);

        assertThat(reads.get()).as("两次读取都必须发生，第二次不会因第一次为空而跳过")
                .isEqualTo(2);
        assertThat(code).as("空口令必须按确认失败拒绝").isEqualTo(2);
        assertThat(errorLines()).containsExactly("BOOTSTRAP_REJECTED PASSWORD_CONFIRMATION");
        assertThat(confirmation).as("失败出口必须清零第二次读取的明文").containsOnly('\0');
    }

    /**
     * 第二次无回显读取遇到 EOF 时必须按口令确认失败拒绝，并跳过对空数组的清理。
     *
     * <p>第一次读到口令、确认读取遇到 EOF 时返回 null：实现必须命中「确认为空」这一侧拒绝，
     * 且清理分支不得对 null 调用 {@code Arrays.fill}。用例断言第一次读取的数组仍被外层
     * 清理块清零，锁定「无论哪一侧失败都不留明文」的契约。</p>
     */
    @Test
    void endOfInputOnConfirmationReadIsRejectedAndPasswordIsCleared() {
        AtomicInteger reads = new AtomicInteger();
        char[] first = "Probe-Password-A1".toCharArray();

        int code = execute(bootstrapEnvironment(), prompt ->
                reads.getAndIncrement() == 0 ? first : null);

        assertThat(reads.get()).isEqualTo(2);
        assertThat(code).as("确认读取为空必须按确认失败拒绝").isEqualTo(2);
        assertThat(errorLines()).containsExactly("BOOTSTRAP_REJECTED PASSWORD_CONFIRMATION");
        assertThat(first).as("失败出口必须清零第一次读取的明文").containsOnly('\0');
    }

    /**
     * 以真实入口逻辑执行一次初始化尝试，并注入受控的无回显输入边界。
     *
     * @param environment 受控环境
     * @param input 无回显输入边界
     * @return 与 {@code main} 相同的退出码
     */
    private int execute(Map<String, String> environment, AdminBootstrapMain.PasswordInput input) {
        PrintStream stream = new PrintStream(error, true, StandardCharsets.UTF_8);
        return AdminBootstrapMain.execute(new String[0], environment, input,
                new PrintStream(output, true, StandardCharsets.UTF_8), stream);
    }

    /**
     * 真实 {@code main} 必须把执行结果交给终止动作。
     *
     * <p><b>探针接缝：</b>{@code main} 过去直接调用 {@code System.exit}，而 {@code System.exit}
     * 永不返回，JaCoCo 落在该方法末尾 {@code return} 上的探针因此永远不可能命中，行 30/31 与
     * 方法覆盖同时缺失。现在入口通过内部终止动作引用结束进程：默认值仍是
     * {@code System::exit}（真实子进程回归见 {@code AdminBootstrapMainProcessTest}），
     * 本用例在隔离作用域内临时把它换成记录动作并在 {@code finally} 中恢复，从而观察到真实
     * {@code main} 传出的退出码与它写出的固定分类。</p>
     *
     * <p>用例不注入环境变量：命令行参数拒绝是唯一不依赖宿主环境、也不访问数据库的确定性出口，
     * 因此断言「传出的码等于 execute 对同样输入返回的码」而不写死常量猜测。参数值沿用本文件既有的
     * {@code DUMMY-} 合成占位串约定，只用于验证拒绝路径不回显，不是可用凭据。</p>
     */
    @Test
    void mainForwardsExitCodeToTerminationAction() {
        AtomicInteger forwarded = new AtomicInteger(Integer.MIN_VALUE);
        PrintStream originalOut = System.out;
        PrintStream originalErr = System.err;
        ByteArrayOutputStream capturedOut = new ByteArrayOutputStream();
        ByteArrayOutputStream capturedErr = new ByteArrayOutputStream();
        String[] args = {"password=DUMMY-CLI-SECRET"};
        AdminBootstrapMain.terminationAction = forwarded::set;
        try {
            System.setOut(new PrintStream(capturedOut, true, StandardCharsets.UTF_8));
            System.setErr(new PrintStream(capturedErr, true, StandardCharsets.UTF_8));

            AdminBootstrapMain.main(args);
        } finally {
            AdminBootstrapMain.terminationAction = System::exit;
            System.setOut(originalOut);
            System.setErr(originalErr);
        }

        int expected = AdminBootstrapMain.execute(args, System.getenv(), prompt -> {
            throw new AssertionError("参数拒绝后不得读取口令");
        }, new PrintStream(new ByteArrayOutputStream(), true, StandardCharsets.UTF_8),
                new PrintStream(new ByteArrayOutputStream(), true, StandardCharsets.UTF_8));

        assertThat(expected).as("命令行参数拒绝必须退出 2").isEqualTo(2);
        assertThat(forwarded.get()).as("main 必须把 execute 的真实结果交给终止动作").isEqualTo(expected);
        assertThat(capturedErr.toString(StandardCharsets.UTF_8))
                .as("main 必须让 execute 的固定分类落到标准错误").contains("BOOTSTRAP_REJECTED INVALID_CONFIGURATION")
                .doesNotContain("DUMMY-CLI-SECRET");
        assertThat(capturedOut.toString(StandardCharsets.UTF_8)).as("拒绝路径不得写标准输出").isEmpty();
    }

    /**
     * 环境显式给出空口令值时必须按口令策略拒绝，且不回退到终端读取。
     *
     * <p>{@code BOOTSTRAP_ADMIN_PASSWORD} 存在但取值为 null 是「显式声明不提供口令」的输入：
     * 此时实现把口令保持为 null，执行入口在连接数据库之前就以固定分类拒绝。断言分类而不是
     * 只断言非零退出码，是因为运维必须能区分「口令不符合策略」与「配置缺失」。</p>
     */
    @Test
    void nullEnvironmentPasswordIsRejectedWithoutReadingTerminal() {
        Map<String, String> environment = bootstrapEnvironment();
        environment.put("BOOTSTRAP_ADMIN_PASSWORD", null);

        int code = execute(new String[0], environment);

        assertThat(code).as("空口令值必须按口令策略拒绝").isEqualTo(2);
        assertThat(errorLines()).containsExactly("BOOTSTRAP_REJECTED PASSWORD_POLICY");
    }

    /**
     * 非 null 环境口令必须被真正用于存储阶段，失败只输出结构化编码。
     *
     * <p>连接地址指向本机已确认关闭的端口，口令合法因此执行入口会越过口令策略校验、
     * 真的调用 JDBC 驱动建立连接；驱动返回的 SQLException 必须被收敛为
     * {@code BOOTSTRAP_STORAGE_FAILURE state=<固定编码> code=<数字>}，绝不输出驱动消息、
     * 连接串、口令或环境中的其它取值。</p>
     */
    @Test
    void environmentPasswordIsUsedAndStorageFailureIsSanitized() {
        Map<String, String> environment = bootstrapEnvironment();
        environment.put("BOOTSTRAP_JDBC_URL", "jdbc:mysql://127.0.0.1:1/probe_db?connectTimeout=1000&socketTimeout=1000");
        environment.put("BOOTSTRAP_ADMIN_PASSWORD", ENVIRONMENT_PASSWORD);

        int code = execute(new String[0], environment);

        assertThat(code).as("连接失败必须按存储失败退出 3，而不是被当成口令策略拒绝")
                .isEqualTo(3);
        assertThat(errorLines()).hasSize(1);
        assertThat(errorLines().get(0))
                .as("只保留固定前缀与结构化编码").matches("BOOTSTRAP_STORAGE_FAILURE state=(UNKNOWN|[A-Z0-9]{5}) code=\\d+");
        assertThat(errorText())
                .as("存储失败输出绝不能携带驱动消息或环境取值")
                .doesNotContain(ENVIRONMENT_PASSWORD, "probe_user", "probe_password", "127.0.0.1", "probe_db");
    }

    /**
     * SQLState 必须按固定格式收敛：null 与非法格式归为 UNKNOWN，合法格式原样保留。
     *
     * <p><b>补测动机：</b>分类表达式只保留符合五位大写字母或数字的状态码，其余一律替换为
     * UNKNOWN，避免驱动的自由文本进入运维输出。真实 MySQL 驱动在连接失败时总会给出标准
     * 状态码（例如 08S01），无法在同一次真实调用里构造 null 与非法格式，因此该判断被提取为
     * 接受显式 SQLState 输入的内部边界（契约见 {@code safeSqlState}），用真实字符串与真实
     * SQLException 逐形态驱动；端到端出口由上一个用例的真实驱动失败覆盖。</p>
     */
    @Test
    void sqlStateIsSanitizedForNullMalformedAndValidValues() {
        assertThat(AdminBootstrapMain.safeSqlState(null))
                .as("驱动未提供状态码时必须固定为 UNKNOWN").isEqualTo("UNKNOWN");
        assertThat(AdminBootstrapMain.safeSqlState("bad-state!"))
                .as("非法格式必须固定为 UNKNOWN").isEqualTo("UNKNOWN");
        assertThat(AdminBootstrapMain.safeSqlState("42S02"))
                .as("合法状态码必须原样保留，便于定位").isEqualTo("42S02");
        assertThat(AdminBootstrapMain.safeSqlState("08s01"))
                .as("小写形态同样属于非法格式").isEqualTo("UNKNOWN");
        assertThat(AdminBootstrapMain.safeSqlState("08_01"))
                .as("含下划线的形态同样属于非法格式").isEqualTo("UNKNOWN");
        assertThat(AdminBootstrapMain.safeSqlState("08S01 conn refused"))
                .as("携带多余文本的状态码必须被替换，防止驱动消息外泄").isEqualTo("UNKNOWN");

        SQLException failure = new SQLException("DUMMY-DRIVER-MESSAGE jdbc:mysql://127.0.0.1/leakdb", "bad-state!", 1064);
        assertThat(AdminBootstrapMain.safeSqlState(failure.getSQLState()))
                .as("真实 SQLException 的非法状态码同样必须收敛").isEqualTo("UNKNOWN");
    }

    /**
     * 构造通过配置校验的受控环境；连接地址默认指向不会真正连接的测试库。
     *
     * @return 只包含初始化必填项的环境映射
     */
    private static Map<String, String> bootstrapEnvironment() {
        Map<String, String> environment = new HashMap<>();
        environment.put("BOOTSTRAP_JDBC_URL", "jdbc:mysql://127.0.0.1:1/probe_db");
        environment.put("BOOTSTRAP_CONFIRM_DATABASE", "probe_db");
        environment.put("BOOTSTRAP_ADMIN_USERNAME", "probeadmin");
        environment.put("DB_USERNAME", "probe_user");
        environment.put("DB_PASSWORD", "probe_password");
        return environment;
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
