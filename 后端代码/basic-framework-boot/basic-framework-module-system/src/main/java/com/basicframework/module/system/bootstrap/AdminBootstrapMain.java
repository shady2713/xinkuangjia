package com.basicframework.module.system.bootstrap;

import java.io.Console;
import java.io.PrintStream;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.Map;

/**
 * 仅供受控离线进程执行的一次性管理员入口；不启动 Spring、Web 服务或定时任务。
 *
 * <p>通过打包应用的 PropertiesLauncher 指定本类。所有配置仅来自环境，
 * 管理员口令也可通过终端无回显双次输入；不接受命令行参数或普通回显 stdin。</p>
 *
 * @author shady2713
 */
public final class AdminBootstrapMain {

    /** 静态命令行入口不允许实例化。 */
    private AdminBootstrapMain() {
    }

    /**
     * 读取显式目标并创建管理员，失败只输出固定分类，不记录异常消息、堆栈或环境值。
     *
     * @param args 必须为空，禁止以 CLI 参数传入口令或连接信息
     * @implNote 成功退出 0；配置或业务拒绝退出 2；存储失败退出 3；意外运行错误退出 4。
     */
    public static void main(String[] args) {
        System.exit(execute(args, System.getenv(), AdminBootstrapMain::readConsolePassword, System.out, System.err));
    }

    /**
     * 将入口 IO 与执行结果隔离以验证无凭据泄漏，数据库写入仍调用真实初始化服务。
     *
     * @param args 必须为空的入口参数
     * @param environment 受控进程环境，不读取应用 .env 或配置文件
     * @param input 缺少口令环境值时使用的无回显输入边界
     * @param output 成功结果输出流
     * @param error 固定错误分类输出流
     * @return 对应 main 的退出码；流由调用者关闭，返回前清零可变口令数组
     */
    static int execute(String[] args, Map<String, String> environment, PasswordInput input,
                       PrintStream output, PrintStream error) {
        char[] password = null;
        try {
            if (args.length != 0) {
                throw new BootstrapFailure(BootstrapFailure.Reason.INVALID_CONFIGURATION);
            }
            BootstrapConfiguration configuration = BootstrapConfiguration.fromEnvironment(environment);
            if (environment.containsKey("BOOTSTRAP_ADMIN_PASSWORD")) {
                String value = environment.get("BOOTSTRAP_ADMIN_PASSWORD");
                password = value == null ? null : value.toCharArray();
            } else {
                password = input.read("Administrator password: ");
                char[] confirmation = input.read("Confirm administrator password: ");
                try {
                    if (password == null || confirmation == null || !Arrays.equals(password, confirmation)) {
                        throw new BootstrapFailure(BootstrapFailure.Reason.PASSWORD_CONFIRMATION);
                    }
                } finally {
                    if (confirmation != null) {
                        Arrays.fill(confirmation, '\0');
                    }
                }
            }
            long id = new BootstrapAdminService().create(configuration, password);
            output.println("BOOTSTRAP_CREATED userId=" + id);
            return 0;
        } catch (BootstrapFailure exception) {
            error.println("BOOTSTRAP_REJECTED " + exception.getMessage());
            return 2;
        } catch (SQLException exception) {
            // 驱动错误消息可能含 URL、用户名或 SQL 参数，仅保留结构化错误编码。
            String state = exception.getSQLState();
            error.println("BOOTSTRAP_STORAGE_FAILURE state="
                    + (state != null && state.matches("[A-Z0-9]{5}") ? state : "UNKNOWN")
                    + " code=" + exception.getErrorCode());
            return 3;
        } catch (RuntimeException exception) {
            error.println("BOOTSTRAP_UNEXPECTED_FAILURE");
            return 4;
        } finally {
            if (password != null) {
                Arrays.fill(password, '\0');
            }
        }
    }

    /** 使用真实 Console 的无回显读取；重定向 stdin 或无终端时明确拒绝。 */
    private static char[] readConsolePassword(String prompt) {
        Console console = System.console();
        if (console == null) {
            throw new BootstrapFailure(BootstrapFailure.Reason.INVALID_CONFIGURATION);
        }
        return console.readPassword("%s", prompt);
    }

    /** 无回显交互输入契约；返回的可变数组交由执行入口清零。 */
    @FunctionalInterface
    interface PasswordInput {
        /** 以固定提示读取一行秘密；EOF 可返回 null，不得记录输入。 */
        char[] read(String prompt);
    }
}
