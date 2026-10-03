package com.basicframework.module.infra.service.config;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.basicframework.framework.common.exception.ErrorCode;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.module.infra.controller.admin.config.vo.ConfigPageReqVO;
import com.basicframework.module.infra.controller.admin.config.vo.ConfigSaveReqVO;
import com.basicframework.module.infra.dal.dataobject.config.ConfigDO;
import com.basicframework.module.infra.dal.mysql.config.ConfigMapper;
import com.basicframework.module.infra.enums.config.ConfigTypeEnum;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.mybatis.spring.mapper.MapperFactoryBean;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

import static com.basicframework.module.infra.enums.ErrorCodeConstants.CONFIG_CAN_NOT_DELETE_SYSTEM_TYPE;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.CONFIG_GET_VALUE_ERROR_IF_VISIBLE;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.CONFIG_KEY_DUPLICATE;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.CONFIG_NOT_EXISTS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.ThrowableAssert.ThrowingCallable;

/**
 * 用独立 MySQL 库、生产 Mapper 和生产建表语句验证参数配置的唯一性、内置保护与可见性边界。
 *
 * <p>参数配置承载两类真实风险：参数键重复会让后写入的配置静默覆盖先写入的配置；
 * 不可见配置是敏感配置，一旦被接口读出就等于泄漏。因此可见性判断必须在 Service 内执行，
 * 本测试直接验证 Service 契约，而不是只验证 HTTP 入口的参数校验。</p>
 *
 * <p>显式执行此集成入口必须提供环回测试环境，缺失环境直接失败，不连接业务库。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ConfigServiceImplMySqlIT {

    /** 本测试使用的生产建表语句。 */
    private static final String CONFIG_TABLE = "infra_config";
    /** 自定义配置固定为该类型，调用方无法通过请求把它伪造成内置配置。 */
    private static final int CUSTOM_TYPE = ConfigTypeEnum.CUSTOM.getType();
    /** 内置配置类型，用于验证删除保护。 */
    private static final int SYSTEM_TYPE = ConfigTypeEnum.SYSTEM.getType();

    private final String schema = "bf_config_" + UUID.randomUUID().toString().replace("-", "");
    private AnnotationConfigApplicationContext context;
    private JdbcTemplate jdbc;
    private ConfigMapper configMapper;
    private ConfigService configService;
    private String adminUrl;
    private String databaseUser;
    private String databasePassword;
    private boolean schemaCreated;

    /** 建立随机数据库并只导入生产参数配置表；不导入种子数据。 */
    @BeforeAll
    void startEnvironment() throws Exception {
        adminUrl = requiredEnvironment("AUTH_TEST_MYSQL_URL");
        if (!adminUrl.matches("jdbc:mysql://(?:127\\.0\\.0\\.1|localhost):[0-9]+/(?:\\?.*)?")) {
            throw new IllegalArgumentException("测试 MySQL 必须位于环回地址且 URL 不得包含数据库名");
        }
        databaseUser = requiredEnvironment("AUTH_TEST_MYSQL_USERNAME");
        databasePassword = requiredEnvironment("AUTH_TEST_MYSQL_PASSWORD");
        try (Connection connection = DriverManager.getConnection(adminUrl, databaseUser, databasePassword);
             Statement statement = connection.createStatement()) {
            statement.execute("CREATE DATABASE `" + schema + "` CHARACTER SET utf8mb4");
            schemaCreated = true;
        }
        String[] parts = adminUrl.split("\\?", 2);
        DataSource dataSource = new DriverManagerDataSource(
                parts[0] + schema + (parts.length == 2 ? "?" + parts[1] : ""), databaseUser, databasePassword);
        jdbc = new JdbcTemplate(dataSource);
        String ddl = Files.readString(repositoryRoot().resolve("数据库文件/basic_framework.sql"));
        var matcher = Pattern.compile("CREATE TABLE `" + CONFIG_TABLE + "`[\\s\\S]*?;").matcher(ddl);
        assertThat(matcher.find()).as("生产表 %s 必须存在", CONFIG_TABLE).isTrue();
        jdbc.execute(matcher.group());

        context = new AnnotationConfigApplicationContext();
        context.registerBean(DataSource.class, () -> dataSource);
        context.registerBean(SqlSessionFactory.class, () -> sqlSessionFactory(dataSource));
        context.registerBean(ConfigMapper.class, () -> {
            try {
                MapperFactoryBean<ConfigMapper> factory = new MapperFactoryBean<>(ConfigMapper.class);
                factory.setSqlSessionFactory(context.getBean(SqlSessionFactory.class));
                factory.afterPropertiesSet();
                return factory.getObject();
            } catch (Exception failure) {
                throw new IllegalStateException("参数配置测试 Mapper 创建失败", failure);
            }
        });
        context.registerBean(ConfigService.class, () -> {
            ConfigServiceImpl service = new ConfigServiceImpl();
            ReflectionTestUtils.setField(service, "configMapper", context.getBean(ConfigMapper.class));
            return service;
        });
        context.refresh();
        configMapper = context.getBean(ConfigMapper.class);
        configService = context.getBean(ConfigService.class);
    }

    /** 每例清空配置表，避免跨用例的键唯一性互相干扰。 */
    @BeforeEach
    void resetFixtures() {
        jdbc.update("DELETE FROM " + CONFIG_TABLE);
    }

    /**
     * 创建的配置类型必须由服务端写死为自定义。
     *
     * <p>若类型来自请求，调用方可以把自己新建的配置声明成内置从而获得删除豁免，
     * 也可以伪装成自定义去改写别人的内置配置。</p>
     */
    @Test
    void createdConfigIsAlwaysCustomType() {
        Long id = configService.createConfig(saveRequest("系统", "login", "配置键", "值", true));

        ConfigDO stored = configService.getConfig(id);
        assertThat(stored.getType()).isEqualTo(CUSTOM_TYPE);
        assertThat(stored.getConfigKey()).isEqualTo("login");
        assertThat(stored.getCategory()).isEqualTo("系统");
        assertThat(stored.getVisible()).isTrue();
    }

    /** 参数键重复时必须在写入前失败，且不得覆盖已存在配置的值。 */
    @Test
    void duplicateConfigKeyIsRejectedBeforeInsert() {
        configService.createConfig(saveRequest("分组", "same-key", "原名称", "原值", true));

        assertBusinessError(() -> configService.createConfig(
                saveRequest("其他分组", "same-key", "新名称", "新值", true)), CONFIG_KEY_DUPLICATE);

        assertThat(countConfigs()).isEqualTo(1);
        assertThat(configService.getConfigByKey("same-key").getValue()).isEqualTo("原值");
    }

    /** 更新为自身已有的键必须允许，否则每次保存都会被唯一性校验挡住。 */
    @Test
    void updateKeepsOwnKeyAndRejectsOtherConfigKey() {
        Long own = configService.createConfig(saveRequest("分组", "own-key", "名称", "值", true));
        Long other = configService.createConfig(saveRequest("分组", "other-key", "名称", "值", true));

        ConfigSaveReqVO keepOwn = saveRequest("分组", "own-key", "改名后", "新值", false);
        keepOwn.setId(own);
        configService.updateConfig(keepOwn);
        assertThat(configService.getConfig(own).getName()).isEqualTo("改名后");
        assertThat(configService.getConfig(own).getValue()).isEqualTo("新值");
        assertThat(configService.getConfig(own).getVisible()).isFalse();

        ConfigSaveReqVO steal = saveRequest("分组", "other-key", "名称", "值", true);
        steal.setId(own);
        assertBusinessError(() -> configService.updateConfig(steal), CONFIG_KEY_DUPLICATE);
        assertThat(configService.getConfig(other).getValue()).isEqualTo("值");
    }

    /** 更新不存在的配置必须失败，不能静默插入一条新记录。 */
    @Test
    void updateMissingConfigIsRejected() {
        ConfigSaveReqVO update = saveRequest("分组", "absent-key", "名称", "值", true);
        update.setId(999_999L);

        assertBusinessError(() -> configService.updateConfig(update), CONFIG_NOT_EXISTS);

        assertThat(countConfigs()).isZero();
    }

    /** 内置配置不允许删除；自定义配置可以删除。 */
    @Test
    void systemConfigCannotBeDeletedButCustomCan() {
        ConfigDO system = seedConfig("system-key", SYSTEM_TYPE);
        ConfigDO custom = seedConfig("custom-key", CUSTOM_TYPE);

        assertBusinessError(() -> configService.deleteConfig(system.getId()), CONFIG_CAN_NOT_DELETE_SYSTEM_TYPE);
        assertThat(configService.getConfig(system.getId())).isNotNull();

        configService.deleteConfig(custom.getId());

        assertThat(configService.getConfig(custom.getId())).isNull();
        assertThat(configService.getConfigByKey("custom-key")).isNull();
    }

    /** 删除不存在的配置必须失败，而不是把不存在的行当成已删除。 */
    @Test
    void deleteMissingConfigIsRejected() {
        assertBusinessError(() -> configService.deleteConfig(999_999L), CONFIG_NOT_EXISTS);
    }

    /**
     * 批量删除遇到内置配置时整体拒绝。
     *
     * <p>逐条先删后校验会让“删除内置配置”这个失败发生在其他配置已被删除之后，
     * 留下无法预期的一致性状态；因此这里要求先整体校验再执行删除。</p>
     */
    @Test
    void batchDeleteRejectsWholeRequestWhenAnyConfigIsSystemType() {
        ConfigDO custom = seedConfig("batch-custom", CUSTOM_TYPE);
        ConfigDO system = seedConfig("batch-system", SYSTEM_TYPE);

        assertBusinessError(() -> configService.deleteConfigList(List.of(custom.getId(), system.getId())),
                CONFIG_CAN_NOT_DELETE_SYSTEM_TYPE);

        assertThat(configService.getConfig(custom.getId()))
                .as("被拒绝的批量删除不得留下已删除一半的结果").isNotNull();
        assertThat(configService.getConfig(system.getId())).isNotNull();
    }

    /** 全部为自定义配置时批量删除成功。 */
    @Test
    void batchDeleteRemovesAllCustomConfigs() {
        ConfigDO first = seedConfig("multi-one", CUSTOM_TYPE);
        ConfigDO second = seedConfig("multi-two", CUSTOM_TYPE);

        configService.deleteConfigList(List.of(first.getId(), second.getId()));

        assertThat(countConfigs()).isZero();
    }

    /**
     * 不可见配置不得通过按键取值接口读出。
     *
     * <p>可见性是敏感参数的业务安全边界；即使键名已知，返回值也必须是业务错误而不是配置值。</p>
     */
    @Test
    void invisibleConfigValueIsNeverReturned() {
        ConfigDO hidden = seedConfig("hidden-key", SYSTEM_TYPE, false, "内部口令");
        ConfigDO shown = seedConfig("shown-key", CUSTOM_TYPE, true, "公开值");

        assertBusinessError(() -> configService.getVisibleConfigValueByKey("hidden-key"),
                CONFIG_GET_VALUE_ERROR_IF_VISIBLE);
        assertThat(configService.getVisibleConfigValueByKey("shown-key")).isEqualTo("公开值");
        assertThat(configService.getVisibleConfigValueByKey("no-such-key")).isNull();
        assertThat(configService.getConfig(hidden.getId())).isNotNull();
        assertThat(configService.getConfig(shown.getId())).isNotNull();
    }

    /** 存在性校验对空编号返回 null，缺失编号抛出业务错误，两者语义不同不能混用。 */
    @Test
    void existenceValidationDistinguishesNullFromMissing() {
        assertThat(configService.getConfig(999_999L)).isNull();
        assertThat(configService.getConfigByKey("no-such-key")).isNull();
    }

    /** 分页按名称、键名和类型过滤，并按编号倒序返回。 */
    @Test
    void configPageFiltersByNameKeyAndType() {
        seedConfig("alpha", CUSTOM_TYPE, true, "一");
        seedConfig("beta", SYSTEM_TYPE, true, "二");
        seedConfig("gamma", CUSTOM_TYPE, true, "三");

        ConfigPageReqVO typeQuery = new ConfigPageReqVO();
        typeQuery.setType(SYSTEM_TYPE);
        PageResult<ConfigDO> systemOnly = configService.getConfigPage(typeQuery);
        assertThat(systemOnly.getTotal()).isEqualTo(1);
        assertThat(systemOnly.getList().get(0).getConfigKey()).isEqualTo("beta");

        ConfigPageReqVO nameQuery = new ConfigPageReqVO();
        nameQuery.setName("配置");
        assertThat(configService.getConfigPage(nameQuery).getTotal()).isEqualTo(0);

        ConfigPageReqVO keyQuery = new ConfigPageReqVO();
        keyQuery.setKey("a");
        PageResult<ConfigDO> fuzzy = configService.getConfigPage(keyQuery);
        assertThat(fuzzy.getTotal()).isEqualTo(3);
        assertThat(fuzzy.getList()).extracting(ConfigDO::getId)
                .isSortedAccordingTo(Comparator.reverseOrder());

        ConfigPageReqVO paged = new ConfigPageReqVO();
        paged.setPageNo(1);
        paged.setPageSize(2);
        PageResult<ConfigDO> firstPage = configService.getConfigPage(paged);
        assertThat(firstPage.getList()).hasSize(2);
        assertThat(firstPage.getTotal()).isEqualTo(3);
    }

    /** 关闭上下文并删除随机数据库；异常时也继续回收。 */
    @AfterAll
    void closeEnvironment() throws Exception {
        try {
            if (context != null) context.close();
        } finally {
            if (schemaCreated) {
                try (Connection connection = DriverManager.getConnection(adminUrl, databaseUser, databasePassword);
                     Statement statement = connection.createStatement()) {
                    statement.execute("DROP DATABASE `" + schema + "`");
                }
            }
        }
    }

    /** 构造合法保存请求；编号留空表示创建。 */
    private ConfigSaveReqVO saveRequest(String category, String key, String name, String value, boolean visible) {
        ConfigSaveReqVO request = new ConfigSaveReqVO();
        request.setCategory(category);
        request.setKey(key);
        request.setName(name);
        request.setValue(value);
        request.setVisible(visible);
        return request;
    }

    /** 直接写入指定类型的配置，用于只验证保护与查询契约的用例。 */
    private ConfigDO seedConfig(String key, int type) {
        return seedConfig(key, type, true, "值-" + key);
    }

    /** 直接写入指定类型、可见性和值的配置。 */
    private ConfigDO seedConfig(String key, int type, boolean visible, String value) {
        ConfigDO config = new ConfigDO();
        config.setCategory("分组");
        config.setName("名称-" + key);
        config.setConfigKey(key);
        config.setValue(value);
        config.setType(type);
        config.setVisible(visible);
        configMapper.insert(config);
        return config;
    }

    /** 断言是指定错误码的业务异常，避免测试只依赖异常类型。 */
    private void assertBusinessError(ThrowingCallable callable, ErrorCode errorCode) {
        assertThatThrownBy(callable).isInstanceOfSatisfying(ServiceException.class,
                failure -> assertThat(failure.getCode()).isEqualTo(errorCode.getCode()));
    }

    /** 统计未逻辑删除的配置行数。 */
    private int countConfigs() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + CONFIG_TABLE + " WHERE deleted = b'0'", Integer.class);
    }

    /** 缺失隔离环境时直接失败，避免退化成跳过真实数据库证据。 */
    private String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException("缺少隔离测试环境变量 " + name);
        return value;
    }

    /** 定位版本控制中的生产 DDL，不依赖测试进程从哪个模块启动。 */
    private Path repositoryRoot() {
        Path directory = Path.of("").toAbsolutePath();
        while (directory != null && !Files.isRegularFile(directory.resolve("数据库文件/basic_framework.sql"))) {
            directory = directory.getParent();
        }
        if (directory == null) throw new IllegalStateException("未找到框架空库基线");
        return directory;
    }

    /** 使用真实 MyBatis 配置、分页插件和审计填充器，防止内存替身掩盖映射错误。 */
    private SqlSessionFactory sqlSessionFactory(DataSource dataSource) {
        try {
            MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
            factory.setDataSource(dataSource);
            MybatisConfiguration configuration = new MybatisConfiguration();
            configuration.setMapUnderscoreToCamelCase(true);
            factory.setConfiguration(configuration);
            MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
            // 不显式指定库类型：分页插件按测试数据源的实际连接自动识别
            interceptor.addInnerInterceptor(new PaginationInnerInterceptor());
            factory.setPlugins(interceptor);
            GlobalConfig config = new GlobalConfig();
            config.setDbConfig(new GlobalConfig.DbConfig().setIdType(IdType.AUTO));
            config.setMetaObjectHandler(new DefaultDBFieldHandler());
            factory.setGlobalConfig(config);
            return factory.getObject();
        } catch (Exception failure) {
            throw new IllegalStateException("参数配置测试 Mapper 初始化失败", failure);
        }
    }
}
