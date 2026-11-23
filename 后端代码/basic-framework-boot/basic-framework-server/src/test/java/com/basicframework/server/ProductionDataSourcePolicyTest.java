package com.basicframework.server;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Binds the datasource exactly as production startup does and inspects the lazy pool
 * without ever opening a JDBC connection.
 */
class ProductionDataSourcePolicyTest {

    private static final String DATABASE = "jdbc:mysql://127.0.0.1:3306/framework_test";

    private static final String COMPLIANT_URL = DATABASE
            + "?sslMode=VERIFY_IDENTITY&allowPublicKeyRetrieval=false";

    @Test
    void prodAcceptsVerifiedIdentityWithoutPublicKeyRetrievalAndLeavesPoolUnstarted() {
        runner("prod")
                .withPropertyValues("spring.datasource.url=" + COMPLIANT_URL)
                .run(context -> {
                    assertThat(context).hasNotFailed().hasSingleBean(ProductionDataSourcePolicy.class);
                    HikariDataSource dataSource = context.getBean(HikariDataSource.class);
                    assertThat(dataSource.getJdbcUrl()).isEqualTo(COMPLIANT_URL);
                    assertThat(dataSource.getHikariPoolMXBean()).isNull();
                    assertThat(dataSource.isRunning()).isFalse();
                });
    }

    @Test
    void localProfileKeepsExistingBehavior() {
        runner("local")
                .withPropertyValues("spring.datasource.url=" + DATABASE
                        + "?sslMode=PREFERRED&allowPublicKeyRetrieval=true")
                .run(context -> {
                    assertThat(context).hasNotFailed().doesNotHaveBean(ProductionDataSourcePolicy.class);
                    assertThat(context.getBean(HikariDataSource.class).getHikariPoolMXBean()).isNull();
                });
    }

    @Test
    void prodRejectsVerifyCa() {
        assertRejected("spring.datasource.url=" + DATABASE
                + "?sslMode=VERIFY_CA&allowPublicKeyRetrieval=false");
    }

    @Test
    void prodRejectsPublicKeyRetrieval() {
        assertRejected("spring.datasource.url=" + DATABASE
                + "?sslMode=VERIFY_IDENTITY&allowPublicKeyRetrieval=true");
    }

    @Test
    void prodRejectsFinalHikariJdbcUrlOverride() {
        assertRejected(
                "spring.datasource.url=" + COMPLIANT_URL,
                "spring.datasource.hikari.jdbc-url=" + DATABASE
                        + "?sslMode=VERIFY_CA&allowPublicKeyRetrieval=false");
    }

    @Test
    void prodRejectsFinalHikariSslModeDataSourcePropertyOverride() {
        assertRejected(
                "spring.datasource.url=" + COMPLIANT_URL,
                "spring.datasource.hikari.data-source-properties.sslMode=VERIFY_CA");
    }

    @Test
    void prodRejectsFinalHikariPublicKeyRetrievalDataSourcePropertyOverride() {
        assertRejected(
                "spring.datasource.url=" + COMPLIANT_URL,
                "spring.datasource.hikari.data-source-properties.allowPublicKeyRetrieval=true");
    }

    private static void assertRejected(String... properties) {
        runner("prod").withPropertyValues(properties).run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure())
                    .rootCause()
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage(ProductionDataSourcePolicy.ERROR_MESSAGE);
        });
    }

    private static ApplicationContextRunner runner(String profile) {
        return new ApplicationContextRunner()
                .withInitializer(context -> context.getEnvironment().setActiveProfiles(profile))
                .withConfiguration(AutoConfigurations.of(DataSourceAutoConfiguration.class))
                .withUserConfiguration(PolicyConfiguration.class)
                .withPropertyValues(
                        "spring.datasource.driver-class-name=com.mysql.cj.jdbc.Driver",
                        "spring.datasource.username=framework_test");
    }

    /**
     * Imported so the {@code @Profile("prod")} condition is evaluated during refresh,
     * after the initializer has activated the profile.
     */
    @Configuration(proxyBeanMethods = false)
    @Import(ProductionDataSourcePolicy.class)
    static class PolicyConfiguration {
    }
}
