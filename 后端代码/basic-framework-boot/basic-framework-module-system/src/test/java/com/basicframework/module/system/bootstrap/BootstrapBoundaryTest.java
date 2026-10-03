package com.basicframework.module.system.bootstrap;

import cn.hutool.crypto.digest.DigestUtil;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 验证初始化入口的显式目标、口令协议及无秘密错误输出，不建立数据库连接。 */
class BootstrapBoundaryTest {

    /** 参数化阻止多主机、隐式库、URL 凭据、驱动扩展和文件读取能力绕过。 */
    @ParameterizedTest
    @ValueSource(strings = {
            "jdbc:mysql://localhost/", "jdbc:mysql://localhost/mysql", "jdbc:mysql://localhost/SYS",
            "jdbc:mysql://localhost/app/extra", "jdbc:mysql://localhost/%61pp",
            "jdbc:mysql://user:secret@localhost/app", "jdbc:mysql://localhost,other/app",
            "jdbc:mysql:loadbalance://localhost/app", "jdbc:mysql://localhost:0/app",
            "jdbc:mysql://localhost:65536/app", "jdbc:mysql://localhost/app#extra",
            "jdbc:mysql://localhost/app?password=secret", "jdbc:mysql://localhost/app?user=other",
            "jdbc:mysql://localhost/app?allowLoadLocalInfile=true",
            "jdbc:mysql://localhost/app?allowUrlInLocalInfile=true",
            "jdbc:mysql://localhost/app?autoDeserialize=true",
            "jdbc:mysql://localhost/app?sessionVariables=sql_mode=ANSI",
            "jdbc:mysql://localhost/app?logger=custom.Logger",
            "jdbc:mysql://localhost/app?useSSL=false&useSSL=true",
            "jdbc:mysql://localhost/app?connectTimeout=0", "jdbc:mysql://localhost/app?socketTimeout=99999",
            "jdbc:mysql://localhost/app?useSSL=false%26password=secret"
    })
    void unsafeConnectionTargetsAreRejected(String url) {
        Map<String, String> environment = environment();
        environment.put("BOOTSTRAP_JDBC_URL", url);
        assertThatThrownBy(() -> BootstrapConfiguration.fromEnvironment(environment))
                .isInstanceOf(BootstrapFailure.class).hasMessage("INVALID_CONFIGURATION");
    }

    /** 确认值必须逐字匹配，连接属性显式关闭文件读取及批量执行。 */
    @Test
    void explicitDatabaseConfirmationAndDriverRestrictionsAreRequired() {
        Map<String, String> environment = environment();
        BootstrapConfiguration configuration = BootstrapConfiguration.fromEnvironment(environment);
        assertThat(configuration.connectionProperties()).containsEntry("allowLoadLocalInfile", "false")
                .containsEntry("allowUrlInLocalInfile", "false").containsEntry("autoDeserialize", "false")
                .containsEntry("allowMultiQueries", "false");
        environment.put("BOOTSTRAP_CONFIRM_DATABASE", "App");
        assertThatThrownBy(() -> BootstrapConfiguration.fromEnvironment(environment)).hasMessage("TARGET_MISMATCH");
        environment.remove("BOOTSTRAP_CONFIRM_DATABASE");
        assertThatThrownBy(() -> BootstrapConfiguration.fromEnvironment(environment)).hasMessage("INVALID_CONFIGURATION");
    }

    /** TLS 和时区等受限连接参数保留正常部署能力，用户名沿用现有 4–30 位字母数字协议。 */
    @Test
    void safeTlsConfigurationAndExistingUsernameContractAreSupported() {
        Map<String, String> environment = environment();
        environment.put("BOOTSTRAP_JDBC_URL", "jdbc:mysql://db.example:3306/app?sslMode=VERIFY_IDENTITY"
                + "&serverTimezone=Asia/Shanghai&connectTimeout=5000");
        assertThat(BootstrapConfiguration.fromEnvironment(environment).database()).isEqualTo("app");
        for (String username : new String[]{"abc", "account_with_underscore", "a".repeat(31)}) {
            environment.put("BOOTSTRAP_ADMIN_USERNAME", username);
            assertThatThrownBy(() -> BootstrapConfiguration.fromEnvironment(environment))
                    .hasMessage("INVALID_CONFIGURATION");
        }
    }

    /** 长度、字符类别、首尾空白和控制字符均在连接数据库前被拒绝。 */
    @ParameterizedTest
    @ValueSource(strings = {"Ab9short", "abcdefghijklmnop", "ABCDEFGH12345678", "lowercase   123456",
            " Abcd123456789", "Abcd123456789 ", "\u00a0Abcd123456789", "Abcd12345678\n9",
            "Abcd12345678\u200b9"})
    void weakOrAmbiguousPasswordsAreRejected(String password) {
        assertThatThrownBy(() -> BootstrapPassword.encode(password.toCharArray())).hasMessage("PASSWORD_POLICY");
    }

    /** Unicode 明文和内部空格按原样参与现有 MD5 协议，BCrypt 固定 cost 10。 */
    @Test
    void passwordEncodingMatchesBrowserProtocolWithoutTrimming() {
        String password = "中间 空格A9" + UUID.randomUUID();
        String encoded = BootstrapPassword.encode(password.toCharArray());
        BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
        assertThat(encoded).startsWith("$2a$10$");
        assertThat(encoder.matches(DigestUtil.md5Hex(password), encoded)).isTrue();
        assertThat(encoder.matches(password, encoded)).isFalse();
        assertThat(encoder.matches(DigestUtil.md5Hex(password.replace(" ", "")), encoded)).isFalse();
        assertThatThrownBy(() -> BootstrapPassword.encode(("Aa9" + "x".repeat(126)).toCharArray()))
                .hasMessage("PASSWORD_POLICY");
        assertThatThrownBy(() -> BootstrapPassword.encode(("Abcd12345678" + '\ud800').toCharArray()))
                .hasMessage("PASSWORD_POLICY");
    }

    /** CLI 参数绝不回显，交互不匹配时两次输入均清零，且不会触发数据库访问。 */
    @Test
    void commandArgumentsAndMismatchedConfirmationDoNotLeakSecrets() {
        String secret = UUID.randomUUID().toString();
        Map<String, String> environment = environment();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        PrintStream stream = new PrintStream(output, true, StandardCharsets.UTF_8);
        assertThat(AdminBootstrapMain.execute(new String[]{secret}, environment, prompt -> {
            throw new AssertionError("参数拒绝后不得读取口令");
        }, stream, stream)).isEqualTo(2);
        char[] first = secret.toCharArray();
        char[] second = UUID.randomUUID().toString().toCharArray();
        AtomicInteger reads = new AtomicInteger();
        assertThat(AdminBootstrapMain.execute(new String[0], environment,
                prompt -> reads.getAndIncrement() == 0 ? first : second, stream, stream)).isEqualTo(2);
        assertThat(reads.get()).isEqualTo(2);
        assertThat(first).containsOnly('\0');
        assertThat(second).containsOnly('\0');
        assertThat(output.toString(StandardCharsets.UTF_8)).contains("PASSWORD_CONFIRMATION")
                .doesNotContain(secret, environment.get("DB_PASSWORD"), environment.get("BOOTSTRAP_JDBC_URL"));
    }

    /** 用随机数据库凭据构造有效边界样本，测试从不连接这个虚构目标。 */
    private static Map<String, String> environment() {
        Map<String, String> environment = new HashMap<>();
        environment.put("BOOTSTRAP_JDBC_URL", "jdbc:mysql://localhost/app");
        environment.put("BOOTSTRAP_CONFIRM_DATABASE", "app");
        environment.put("BOOTSTRAP_ADMIN_USERNAME", "bootstrapadmin");
        environment.put("DB_USERNAME", "test" + UUID.randomUUID().toString().replace("-", ""));
        environment.put("DB_PASSWORD", UUID.randomUUID().toString());
        return environment;
    }
}
