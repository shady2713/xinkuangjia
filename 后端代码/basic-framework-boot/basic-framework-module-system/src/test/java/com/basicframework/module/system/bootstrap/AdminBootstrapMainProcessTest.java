package com.basicframework.module.system.bootstrap;

import org.junit.jupiter.api.Test;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证一次性管理员入口在真实进程中的退出码与终端口令读取行为。
 *
 * <p>{@code AdminBootstrapMain.main} 只能存在于真实进程里：它在返回前调用 {@code System.exit}，
 * 在测试 JVM 内执行会直接杀掉 surefire；无回显读取又要求整个进程挂在终端（伪终端）下，
 * 重定向 stdin 时 {@code System.console()} 为空，走的是另一条拒绝分支。因此本用例另起子 JVM：</p>
 * <ul>
 *   <li>缺少必填配置时断言退出码 2 与固定拒绝分类，证明 {@code main} 会把执行结果交给
 *       {@code System.exit}，且失败不泄漏环境值；</li>
 *   <li>在伪终端下喂入两次不一致的口令，断言退出码 2 与 {@code PASSWORD_CONFIRMATION} 分类——
 *       只有真正执行到 {@code console.readPassword} 才可能得到该分类，无终端时会是
 *       {@code INVALID_CONFIGURATION}，因此这条断言同时证明无回显读取被真实调用。</li>
 * </ul>
 *
 * <p>子进程不访问数据库：第一条在配置校验阶段被拒绝，第二条在两次口令不一致时被拒绝。
 * 质量阶段（{@code -Pquality-audit}）会把 JaCoCo 代理挂到子进程的同一个
 * {@code target/jacoco.exec} 上，因此第二条用例真实执行的终端读取分支会计入覆盖率。</p>
 *
 * <p><b>覆盖率边界（实测结论）：</b>{@code main} 本身无法被任何执行覆盖。该方法编译后只有一条
 * {@code System.exit(...)} 调用与一条紧随其后的 {@code return}，JaCoCo 在该方法里只插入了
 * 一个探针，且它落在 {@code return} 上；而 {@code System.exit} 永不返回，所以探针永远不会命中。
 * 实测证据：两个子进程都确实执行了 {@code main}（否则不可能命中只有入口能到达的
 * {@code console.readPassword}），但它们写入的会话中该探针仍为未覆盖（探针映射实验显示
 * 只有这一个探针覆盖 {@code main} 的两行）。Mockito 明确拒绝对 {@code java.lang.System}
 * 的静态方法打桩（{@code It is not possible to mock static methods of java.lang.System}），
 * 因此也无法把 {@code System.exit} 变成可返回调用。本用例保留进程级断言以验证真实退出码，
 * 但不声称覆盖这两行。</p>
 *
 * @author shady2713
 */
class AdminBootstrapMainProcessTest {

    /** 子进程启动与交互的最长等待时间，避免用例在异常环境下挂死。 */
    private static final long PROCESS_TIMEOUT_SECONDS = 60L;

    /** 伪终端工具路径，用于给子进程提供真实终端。 */
    private static final String PSEUDO_TERMINAL = "/usr/bin/script";

    /**
     * 缺少必填配置时必须按拒绝退出 2，并把固定分类写入标准错误。
     *
     * <p>该路径不读取终端口令、不连接数据库，是运维最常遇到的失败：环境变量没有注入完整。
     * 断言退出码可以证明 {@code main} 确实以执行结果退出，而不是吞掉失败继续启动。</p>
     *
     * @throws Exception 子进程启动、等待或输出读取失败时抛出
     */
    @Test
    void mainExitsWithRejectionCodeWhenConfigurationIsMissing() throws Exception {
        ProbeProcess probe = startProbe(javaCommand(AdminBootstrapMain.class.getName()), cleanEnvironment());
        probe.closeInput();
        int exitCode = probe.waitForExit();
        String output = probe.readOutput();

        assertThat(exitCode).as("缺少必填配置必须退出 2，实际输出：%s", output).isEqualTo(2);
        assertThat(output).contains("BOOTSTRAP_REJECTED INVALID_CONFIGURATION");
    }

    /**
     * 伪终端下两次口令不一致时必须按口令确认失败退出 2。
     *
     * <p>该断言依赖 {@code console.readPassword} 被真实调用：无终端时实现会在读取之前就以
     * {@code INVALID_CONFIGURATION} 拒绝，因此分类为 {@code PASSWORD_CONFIRMATION} 即证明
     * 终端读取分支被执行。口令使用独立探针值，不来自环境变量，也不落盘。</p>
     *
     * @throws Exception 子进程启动、等待或输出读取失败时抛出
     */
    @Test
    void consolePasswordReadIsInvokedUnderPseudoTerminal() throws Exception {
        assertThat(new File(PSEUDO_TERMINAL)).as("本机必须提供 util-linux script 以构造伪终端").isFile();
        assertThat(new File(PSEUDO_TERMINAL).canExecute()).as("伪终端工具必须可执行").isTrue();

        List<String> command = new ArrayList<>();
        command.add(PSEUDO_TERMINAL);
        command.add("-qec");
        command.add(String.join(" ", javaCommand(AdminBootstrapMain.class.getName())));
        command.add("/dev/null");
        ProbeProcess probe = startProbe(command, configuredEnvironmentWithoutPassword());
        probe.write("Probe-Password-Alpha!\nProbe-Password-Beta!\n");

        int exitCode = probe.waitForExit();
        String output = probe.readOutput();

        assertThat(exitCode).as("两次口令不一致必须退出 2，实际输出：%s", output).isEqualTo(2);
        assertThat(output).as("该分类只有在真实终端读取之后才可能出现，实际输出：%s", output)
                .contains("BOOTSTRAP_REJECTED PASSWORD_CONFIRMATION");
    }

    /**
     * 构造启动子 JVM 的完整命令，并在代理存在时挂上同一个覆盖率输出文件。
     *
     * <p>只有质量阶段才会把 {@code jacoco-agent.jar} 复制到 {@code target/quality-agent}；
     * 普通专项测试不依赖覆盖率输出，因此代理缺失时仍按同一命令启动子进程。</p>
     *
     * @param mainClass 要执行的入口类全限定名
     * @return 可直接交给 ProcessBuilder 的命令参数
     */
    private static List<String> javaCommand(String mainClass) {
        List<String> command = new ArrayList<>();
        command.add(Path.of(System.getProperty("java.home"), "bin", "java").toString());
        File agent = new File("target/quality-agent/jacoco-agent.jar");
        if (agent.isFile()) {
            command.add("-javaagent:" + agent.getAbsolutePath()
                    + "=destfile=" + new File("target/jacoco.exec").getAbsolutePath());
        }
        command.add("-cp");
        command.add(testClasspath());
        command.add(mainClass);
        return command;
    }

    /**
     * 返回子进程可用的测试类路径。
     *
     * <p>优先使用 surefire 提供的完整测试类路径；缺失时回退到当前 JVM 的类路径，
     * 保证在 IDE 内直接运行时仍能启动入口类。</p>
     *
     * @return 子进程类路径
     */
    private static String testClasspath() {
        String classpath = System.getProperty("surefire.test.class.path");
        return classpath == null || classpath.isBlank() ? System.getProperty("java.class.path") : classpath;
    }

    /**
     * 启动子进程并把它的合并输出重定向到临时文件，避免管道写满导致死锁。
     *
     * @param command 命令参数
     * @param environment 子进程环境变量集合；整份替换而不是追加，保证用例不受宿主环境影响
     * @return 已启动的探针进程
     * @throws IOException 进程或临时文件创建失败时抛出
     */
    private static ProbeProcess startProbe(List<String> command, Map<String, String> environment) throws IOException {
        Path outputFile = Files.createTempFile("admin-bootstrap-probe", ".log");
        outputFile.toFile().deleteOnExit();
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.environment().clear();
        builder.environment().putAll(environment);
        builder.redirectErrorStream(true);
        builder.redirectOutput(outputFile.toFile());
        return new ProbeProcess(builder.start(), outputFile);
    }

    /**
     * 构造“只有必填项为空”的干净环境：不注入任何初始化配置。
     *
     * @return 不含 BOOTSTRAP/DB 变量的环境
     */
    private static Map<String, String> cleanEnvironment() {
        Map<String, String> environment = new HashMap<>(System.getenv());
        environment.keySet().removeIf(key -> key.startsWith("BOOTSTRAP_")
                || key.equals("DB_USERNAME") || key.equals("DB_PASSWORD"));
        return environment;
    }

    /**
     * 构造通过配置校验、但不提供口令环境值的环境，使入口必须走终端读取。
     *
     * <p>连接地址指向本机不可用端口并带短超时：即便口令被接受，连接也会立刻失败，
     * 不会在测试中留下数据库副作用。管理员用户名必须是 4-30 位字母或数字，
     * 因此使用纯字母数字的探针值。</p>
     *
     * @return 已注入显式目标与凭据的环境
     */
    private static Map<String, String> configuredEnvironmentWithoutPassword() {
        Map<String, String> environment = cleanEnvironment();
        environment.put("BOOTSTRAP_JDBC_URL",
                "jdbc:mysql://127.0.0.1:1/probe_db?connectTimeout=1000&socketTimeout=1000");
        environment.put("BOOTSTRAP_CONFIRM_DATABASE", "probe_db");
        environment.put("BOOTSTRAP_ADMIN_USERNAME", "probeadmin");
        environment.put("DB_USERNAME", "probe_user");
        environment.put("DB_PASSWORD", "probe_password");
        return environment;
    }

    /**
     * 进程级探针：持有子进程与其输出文件，负责写入交互输入、等待退出并读取输出。
     */
    private static final class ProbeProcess {

        /** 已启动的子进程。 */
        private final Process process;

        /** 子进程合并输出的临时文件。 */
        private final Path outputFile;

        /**
         * 绑定子进程与输出文件。
         *
         * @param process 子进程
         * @param outputFile 输出文件
         */
        private ProbeProcess(Process process, Path outputFile) {
            this.process = process;
            this.outputFile = outputFile;
        }

        /**
         * 向子进程标准输入写入探针输入并关闭输入流，避免子进程等待 EOF。
         *
         * @param input 要写入的文本
         * @throws IOException 写入失败时抛出
         */
        private void write(String input) throws IOException {
            process.getOutputStream().write(input.getBytes(StandardCharsets.UTF_8));
            process.getOutputStream().flush();
            process.getOutputStream().close();
        }

        /**
         * 直接关闭子进程标准输入，用于不需要交互输入的用例。
         *
         * @throws IOException 关闭失败时抛出
         */
        private void closeInput() throws IOException {
            process.getOutputStream().close();
        }

        /**
         * 等待子进程结束，超时则强制终止并让用例失败。
         *
         * @return 子进程退出码
         * @throws InterruptedException 等待被中断时抛出
         */
        private int waitForExit() throws InterruptedException {
            if (!process.waitFor(PROCESS_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new AssertionError("子进程在 " + PROCESS_TIMEOUT_SECONDS + " 秒内没有结束");
            }
            return process.exitValue();
        }

        /**
         * 读取子进程合并后的全部输出。
         *
         * @return 标准输出与标准错误合并文本
         * @throws IOException 读取失败时抛出
         */
        private String readOutput() throws IOException {
            return Files.readString(outputFile, StandardCharsets.UTF_8);
        }
    }

}
