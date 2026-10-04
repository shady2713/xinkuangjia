package com.basicframework.framework.mybatis.config;

import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.annotation.IdType;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 MyBatis 主键策略环境后置处理器按主数据源类型补齐 ID 策略与 Quartz 驱动委托的契约。
 *
 * <p>该处理器在容器启动最早阶段运行：主键策略留空时，Oracle/PostgreSQL 等"用户输入主键"的库必须
 * 落为 INPUT，自增库落为 AUTO；显式配置的策略一律不覆盖。同一阶段还会按库类型补齐 Quartz
 * JobStore 驱动委托，否则集群模式下 Quartz 会因缺少委托类启动失败。用例用真实
 * {@link StandardEnvironment} 与真实 JDBC URL 驱动，断言实际写入的配置值、属性源优先级与
 * 系统属性副作用。</p>
 *
 * @author shady2713
 */
class IdTypeEnvironmentPostProcessorTest {

    /** 主键策略配置键，与处理器内部约定一致。 */
    private static final String ID_TYPE_KEY = "mybatis-plus.global-config.db-config.id-type";
    /** Quartz 驱动委托配置键，与处理器内部约定一致。 */
    private static final String QUARTZ_JOB_STORE_DRIVER_KEY =
            "spring.quartz.properties.org.quartz.jobStore.driverDelegateClass";
    /** 处理器写入推断结果时使用的属性源名称。 */
    private static final String ID_TYPE_PROPERTY_SOURCE = "mybatisPlusIdType";

    /** 被测处理器。 */
    private final IdTypeEnvironmentPostProcessor postProcessor = new IdTypeEnvironmentPostProcessor();

    /** 清理处理器写进 JVM 系统属性的 Quartz 委托，避免影响其他测试与真实启动。 */
    @AfterEach
    void clearQuartzDriverSystemProperty() {
        System.clearProperty(QUARTZ_JOB_STORE_DRIVER_KEY);
    }

    /**
     * 未配置主数据源时无法判断库类型，不得写入任何主键策略或 Quartz 委托。
     */
    @Test
    void postProcessEnvironmentSkipsWhenDbTypeUnknown() {
        StandardEnvironment environment = new StandardEnvironment();

        postProcessor.postProcessEnvironment(environment, null);

        assertThat(environment.getProperty(ID_TYPE_KEY)).isNull();
        assertThat(environment.getPropertySources().contains(ID_TYPE_PROPERTY_SOURCE)).isFalse();
        assertThat(environment.getProperty(QUARTZ_JOB_STORE_DRIVER_KEY)).isNull();
    }

    /**
     * 显式配置的主键策略必须保留，处理器不得覆盖为按库推断的结果。
     */
    @Test
    void postProcessEnvironmentKeepsExplicitIdType() {
        StandardEnvironment environment = environment("jdbc:mysql://127.0.0.1:3306/probe",
                Map.of(ID_TYPE_KEY, IdType.ASSIGN_ID.name()));

        postProcessor.postProcessEnvironment(environment, null);

        assertThat(postProcessor.getIdType(environment)).isEqualTo(IdType.ASSIGN_ID);
        assertThat(environment.getPropertySources().contains(ID_TYPE_PROPERTY_SOURCE)).isFalse();
    }

    /**
     * 自增库必须落为 AUTO，新增属性源必须置于最前以覆盖历史配置。
     */
    @Test
    void postProcessEnvironmentAssignsAutoForAutoIncrementDatabase() {
        StandardEnvironment environment = environment("jdbc:mysql://127.0.0.1:3306/probe", Map.of());

        postProcessor.postProcessEnvironment(environment, null);

        assertThat(environment.getPropertySources().iterator().next().getName())
                .as("推断结果必须优先于既有配置").isEqualTo(ID_TYPE_PROPERTY_SOURCE);
        assertThat(postProcessor.getIdType(environment)).isEqualTo(IdType.AUTO);
        assertThat(environment.getProperty(QUARTZ_JOB_STORE_DRIVER_KEY))
                .as("MySQL 无法映射 Quartz 委托，不得写入空值或错误类名").isNull();
        assertThat(System.getProperty(QUARTZ_JOB_STORE_DRIVER_KEY)).isNull();
    }

    /**
     * 用户输入主键的库必须落为 INPUT，并按库类型写入对应的 Quartz 驱动委托。
     */
    @Test
    void postProcessEnvironmentAssignsInputAndQuartzDriverPerDatabase() {
        assertDatabase("jdbc:postgresql://127.0.0.1:5432/probe", IdType.INPUT,
                "org.quartz.impl.jdbcjobstore.PostgreSQLDelegate");
        assertDatabase("jdbc:oracle:thin:@127.0.0.1:1521:probe", IdType.INPUT,
                "org.quartz.impl.jdbcjobstore.oracle.OracleDelegate");
        assertDatabase("jdbc:sqlserver://127.0.0.1:1433;databaseName=probe", IdType.AUTO,
                "org.quartz.impl.jdbcjobstore.MSSQLDelegate");
        assertDatabase("jdbc:dm://127.0.0.1:5236/probe", IdType.AUTO,
                "org.quartz.impl.jdbcjobstore.StdJDBCDelegate");
        assertDatabase("jdbc:kingbase8://127.0.0.1:54321/probe", IdType.INPUT,
                "org.quartz.impl.jdbcjobstore.StdJDBCDelegate");
    }

    /**
     * 已配置 Quartz 驱动委托时不得覆盖，且不得写入系统属性。
     */
    @Test
    void setJobStoreDriverIfPresentKeepsConfiguredDriver() {
        StandardEnvironment environment = environment("jdbc:postgresql://127.0.0.1:5432/probe",
                Map.of(QUARTZ_JOB_STORE_DRIVER_KEY, "com.example.CustomDelegate"));

        postProcessor.setJobStoreDriverIfPresent(environment, DbType.POSTGRE_SQL);

        assertThat(environment.getProperty(QUARTZ_JOB_STORE_DRIVER_KEY)).isEqualTo("com.example.CustomDelegate");
        assertThat(System.getProperty(QUARTZ_JOB_STORE_DRIVER_KEY)).isNull();
    }

    /**
     * 主键策略解析区分空值、合法枚举值与非法文本，非法值按 NONE 处理且不抛错。
     */
    @Test
    void getIdTypeParsesBlankValidAndInvalidValues() {
        assertThat(postProcessor.getIdType(new StandardEnvironment())).isEqualTo(IdType.NONE);
        assertThat(postProcessor.getIdType(environment("jdbc:mysql://127.0.0.1:3306/probe",
                Map.of(ID_TYPE_KEY, "  ")))).isEqualTo(IdType.NONE);
        assertThat(postProcessor.getIdType(environment("jdbc:mysql://127.0.0.1:3306/probe",
                Map.of(ID_TYPE_KEY, IdType.INPUT.name())))).isEqualTo(IdType.INPUT);
        assertThat(postProcessor.getIdType(environment("jdbc:mysql://127.0.0.1:3306/probe",
                Map.of(ID_TYPE_KEY, "NOT_A_ID_TYPE")))).as("非法枚举文本回退为 NONE")
                .isEqualTo(IdType.NONE);
    }

    /**
     * 写入主键策略必须覆盖既有属性源中的旧值。
     */
    @Test
    void setIdTypeOverridesExistingValue() {
        StandardEnvironment environment = environment("jdbc:mysql://127.0.0.1:3306/probe",
                Map.of(ID_TYPE_KEY, IdType.ASSIGN_UUID.name()));

        postProcessor.setIdType(environment, IdType.AUTO);

        assertThat(environment.getProperty(ID_TYPE_KEY, IdType.class)).isEqualTo(IdType.AUTO);
    }

    /**
     * 主数据源类型解析要求 primary 与对应 url 同时存在。
     */
    @Test
    void getDbTypeRequiresPrimaryAndUrl() {
        assertThat(IdTypeEnvironmentPostProcessor.getDbType(new StandardEnvironment())).isNull();
        assertThat(IdTypeEnvironmentPostProcessor.getDbType(environmentWithoutUrl())).isNull();
        assertThat(IdTypeEnvironmentPostProcessor.getDbType(environment("jdbc:mysql://127.0.0.1:3306/probe", Map.of())))
                .isEqualTo(DbType.MYSQL);
    }

    /**
     * 用指定主数据源 URL 与附加配置构造独立环境。
     *
     * @param url 主数据源 JDBC URL
     * @param extraProperties 额外配置项
     * @return 已装配数据源配置的环境
     */
    private static StandardEnvironment environment(String url, Map<String, Object> extraProperties) {
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource("probeDataSource", Map.of(
                "spring.datasource.dynamic.primary", "master",
                "spring.datasource.dynamic.datasource.master.url", url)));
        if (!extraProperties.isEmpty()) {
            environment.getPropertySources().addFirst(new MapPropertySource("probeExtra", extraProperties));
        }
        return environment;
    }

    /**
     * 构造只声明主数据源名称、缺少 URL 的环境。
     *
     * @return 缺少 URL 的环境
     */
    private static StandardEnvironment environmentWithoutUrl() {
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource("probeDataSource",
                Map.of("spring.datasource.dynamic.primary", "master")));
        return environment;
    }

    /**
     * 对单个数据库 URL 断言主键策略与 Quartz 驱动委托，并在断言前清理系统属性残留。
     *
     * @param url 主数据源 JDBC URL
     * @param expectedIdType 期望的主键策略
     * @param expectedDriver 期望的 Quartz 驱动委托类名
     */
    private void assertDatabase(String url, IdType expectedIdType, String expectedDriver) {
        System.clearProperty(QUARTZ_JOB_STORE_DRIVER_KEY);
        StandardEnvironment environment = environment(url, Map.of());

        postProcessor.postProcessEnvironment(environment, null);

        assertThat(postProcessor.getIdType(environment)).as("主键策略(%s)", url).isEqualTo(expectedIdType);
        assertThat(System.getProperty(QUARTZ_JOB_STORE_DRIVER_KEY)).as("Quartz 委托(%s)", url)
                .isEqualTo(expectedDriver);
    }

}
