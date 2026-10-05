package com.basicframework.module.system.bootstrap;

import com.basicframework.framework.common.util.validation.ValidationUtils;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.HashSet;
import java.util.Map;
import java.util.Properties;
import java.util.Set;

/**
 * 从受控环境构造单库初始化配置；不读取应用配置文件，也不提供含秘密的字符串表示。
 *
 * @author shady2713
 */
final class BootstrapConfiguration {

    private static final Set<String> SYSTEM_DATABASES = Set.of(
            "mysql", "sys", "information_schema", "performance_schema");
    private final String jdbcUrl;
    private final String database;
    private final String databaseUser;
    private final String databasePassword;
    private final String adminUsername;

    /** 校验库名确认、用户名及连接边界后保留调用期间需要的配置。 */
    private BootstrapConfiguration(String jdbcUrl, String database, String databaseUser,
                                   String databasePassword, String adminUsername) {
        this.jdbcUrl = jdbcUrl;
        this.database = database;
        this.databaseUser = databaseUser;
        this.databasePassword = databasePassword;
        this.adminUsername = adminUsername;
    }

    /**
     * 读取显式目标与连接凭据；不接受 URL 内凭据、额外数据库、驱动扩展或初始化 SQL。
     *
     * @param environment 受控进程环境；必填项缺失、为空或格式错误均拒绝
     * @return 已校验且禁止隐式默认数据库的配置
     * @throws BootstrapFailure 配置非法或人工确认库名与 URL 不一致
     */
    static BootstrapConfiguration fromEnvironment(Map<String, String> environment) {
        String url = required(environment, "BOOTSTRAP_JDBC_URL");
        String database = parseDatabase(url);
        if (!database.equals(required(environment, "BOOTSTRAP_CONFIRM_DATABASE"))) {
            throw new BootstrapFailure(BootstrapFailure.Reason.TARGET_MISMATCH);
        }
        String username = required(environment, "BOOTSTRAP_ADMIN_USERNAME");
        if (!ValidationUtils.isUsername(username)) {
            throw new BootstrapFailure(BootstrapFailure.Reason.INVALID_CONFIGURATION);
        }
        return new BootstrapConfiguration(url, database, required(environment, "DB_USERNAME"),
                required(environment, "DB_PASSWORD"), username);
    }

    /** 单主机 MySQL URL 的原始路径必须恰好是一个普通库名，避免解码和切库歧义。 */
    private static String parseDatabase(String url) {
        try {
            if (!url.startsWith("jdbc:mysql://")) {
                throw new URISyntaxException("", "unsupported protocol");
            }
            URI uri = new URI(url.substring(5));
            String path = uri.getRawPath();
            if (uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawFragment() != null
                    || uri.getPort() == 0 || uri.getPort() > 65_535 || path == null
                    || !path.matches("/[A-Za-z0-9_]{1,64}")) {
                throw new URISyntaxException("", "invalid single database target");
            }
            String database = path.substring(1);
            if (SYSTEM_DATABASES.contains(database.toLowerCase(java.util.Locale.ROOT))) {
                throw new URISyntaxException("", "system database");
            }
            validateQuery(uri.getRawQuery());
            return database;
        } catch (URISyntaxException exception) {
            throw new BootstrapFailure(BootstrapFailure.Reason.INVALID_CONFIGURATION);
        }
    }

    /**
     * 仅允许连接超时、时区和 TLS 参数；未知项一律拒绝，防止文件读取、自动反序列化和日志扩展。
     */
    private static void validateQuery(String query) {
        if (query == null) {
            return;
        }
        Set<String> seen = new HashSet<>();
        for (String part : query.split("&", -1)) {
            String[] pair = part.split("=", -1);
            boolean valid = pair.length == 2 && seen.add(pair[0]);
            if (valid) {
                valid = switch (pair[0]) {
                    case "useSSL", "requireSSL", "verifyServerCertificate", "allowPublicKeyRetrieval" ->
                            Set.of("true", "false").contains(pair[1]);
                    case "sslMode" -> Set.of("DISABLED", "PREFERRED", "REQUIRED", "VERIFY_CA", "VERIFY_IDENTITY")
                            .contains(pair[1]);
                    case "serverTimezone" -> pair[1].matches("[A-Za-z0-9_/:+-]{1,64}");
                    case "connectTimeout", "socketTimeout" -> pair[1].matches("[1-9][0-9]{0,4}")
                            && Integer.parseInt(pair[1]) <= 60_000;
                    default -> false;
                };
            }
            if (!valid) {
                throw new BootstrapFailure(BootstrapFailure.Reason.INVALID_CONFIGURATION);
            }
        }
    }

    /** 必填环境值不得空缺；不 trim 凭据，也不把变量值带入异常。 */
    private static String required(Map<String, String> environment, String name) {
        String value = environment.get(name);
        if (value == null || value.isBlank()) {
            throw new BootstrapFailure(BootstrapFailure.Reason.INVALID_CONFIGURATION);
        }
        return value;
    }

    /** 为每次 JDBC 连接构造独立属性，显式关闭不需要的高风险驱动能力与日志。 */
    Properties connectionProperties() {
        Properties properties = new Properties();
        properties.setProperty("user", databaseUser);
        properties.setProperty("password", databasePassword);
        properties.setProperty("allowLoadLocalInfile", "false");
        properties.setProperty("allowUrlInLocalInfile", "false");
        properties.setProperty("autoDeserialize", "false");
        properties.setProperty("allowMultiQueries", "false");
        properties.setProperty("paranoid", "true");
        properties.setProperty("logger", "com.mysql.cj.log.NullLogger");
        properties.setProperty("connectTimeout", "10000");
        properties.setProperty("socketTimeout", "30000");
        return properties;
    }

    /** 返回已排除凭据和驱动扩展的连接地址，仅供 JDBC 调用，不得输出。 */
    String jdbcUrl() {
        return jdbcUrl;
    }

    /** 返回 URL、人工确认与实际连接必须一致的数据库名。 */
    String database() {
        return database;
    }

    /** 返回符合现有用户名协议的初始化账号名。 */
    String adminUsername() {
        return adminUsername;
    }
}
