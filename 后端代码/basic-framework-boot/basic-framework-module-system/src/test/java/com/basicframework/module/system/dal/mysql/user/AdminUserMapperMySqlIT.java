package com.basicframework.module.system.dal.mysql.user;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
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

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 用独立 MySQL 库与生产 Mapper 验证后台用户的唯一键查询、列表条件与平台隔离规则。
 *
 * <p>这些查询决定登录、找回与运营筛选：账号/邮箱/手机号查询是登录与绑定的唯一入口，条件写错会让
 * 用户登错身份或无法登录；按昵称与状态查询是运营工具的基础；按平台类型查询还有一条真实兼容规则——
 * 只有业务管理平台允许命中平台字段为空或空串的历史账号，其它平台必须严格匹配，否则会跨平台选中身份。
 * 因此这里用真实 SQL 观察结果，包括历史数据形态。</p>
 *
 * <p>显式执行此集成入口必须提供环回测试环境，缺失环境直接失败，不连接业务库。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AdminUserMapperMySqlIT {

    /** 本测试使用的生产表：后台用户表。 */
    private static final String USER_TABLE = "system_users";
    /** 业务管理平台类型，与生产枚举取值一致。 */
    private static final String BUSINESS_ADMIN = "business_admin";
    /** 另一个管理平台类型，用于验证平台隔离。 */
    private static final String SUPER_ADMIN = "super_admin";

    /** 本测试独占的随机库名，结束时整体删除。 */
    private final String schema = "bf_user_mapper_" + UUID.randomUUID().toString().replace("-", "");

    /** 测试装配的上下文，持有真实数据源与生产 Mapper。 */
    private AnnotationConfigApplicationContext context;
    /** 直连测试库的 JDBC 模板，用于在 Mapper 之外观察持久状态。 */
    private JdbcTemplate jdbc;
    /** 被测用户 Mapper。 */
    private AdminUserMapper adminUserMapper;
    /** 管理连接使用的库级 URL，用于建库与删库。 */
    private String adminUrl;
    /** 隔离测试账号。 */
    private String databaseUser;
    /** 隔离测试口令。 */
    private String databasePassword;
    /** 是否已真实建库，决定结束时是否需要回收。 */
    private boolean schemaCreated;

    /** 建立随机数据库并只导入生产用户表；不导入种子数据。 */
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
        var matcher = Pattern.compile("CREATE TABLE `" + USER_TABLE + "`[\\s\\S]*?;").matcher(ddl);
        assertThat(matcher.find()).as("生产表 %s 必须存在", USER_TABLE).isTrue();
        jdbc.execute(matcher.group());

        context = new AnnotationConfigApplicationContext();
        context.registerBean(DataSource.class, () -> dataSource);
        context.registerBean(SqlSessionFactory.class, () -> sqlSessionFactory(dataSource));
        registerMapper(AdminUserMapper.class);
        context.refresh();
        adminUserMapper = context.getBean(AdminUserMapper.class);
    }

    /** 每例清空用户表，避免跨用例的唯一键冲突污染查询结果。 */
    @BeforeEach
    void resetFixtures() {
        jdbc.update("DELETE FROM " + USER_TABLE);
    }

    /** 账号、邮箱与手机号查询必须命中唯一记录，未命中返回 null。 */
    @Test
    void uniqueKeyLookupsReturnSingleMatch() {
        adminUserMapper.insert(user(1L, "DUMMY-admin", "管理员", BUSINESS_ADMIN, 1L,
                CommonStatusEnum.ENABLE.getStatus(), "admin@example.test", "13800000001"));
        adminUserMapper.insert(user(2L, "DUMMY-member", "会员", BUSINESS_ADMIN, 2L,
                CommonStatusEnum.ENABLE.getStatus(), "member@example.test", "13800000002"));

        assertThat(adminUserMapper.selectByUsername("DUMMY-admin").getNickname()).isEqualTo("管理员");
        assertThat(adminUserMapper.selectByEmail("member@example.test").getUsername()).isEqualTo("DUMMY-member");
        assertThat(adminUserMapper.selectByMobile("13800000002").getUsername()).isEqualTo("DUMMY-member");
        assertThat(adminUserMapper.selectByUsername("DUMMY-absent")).as("未命中的账号必须返回 null").isNull();
        assertThat(adminUserMapper.selectByEmail("absent@example.test")).isNull();
        assertThat(adminUserMapper.selectByMobile("13900000000")).isNull();
    }

    /** 昵称查询必须按模糊匹配返回全部命中记录。 */
    @Test
    void selectListByNicknameMatchesPartially() {
        adminUserMapper.insert(user(1L, "DUMMY-a", "运营张三", BUSINESS_ADMIN, 1L,
                CommonStatusEnum.ENABLE.getStatus(), "a@example.test", "13800000011"));
        adminUserMapper.insert(user(2L, "DUMMY-b", "运营李四", BUSINESS_ADMIN, 1L,
                CommonStatusEnum.ENABLE.getStatus(), "b@example.test", "13800000012"));
        adminUserMapper.insert(user(3L, "DUMMY-c", "财务王五", BUSINESS_ADMIN, 2L,
                CommonStatusEnum.ENABLE.getStatus(), "c@example.test", "13800000013"));

        assertThat(adminUserMapper.selectListByNickname("运营"))
                .extracting(AdminUserDO::getUsername).containsExactlyInAnyOrder("DUMMY-a", "DUMMY-b");
        assertThat(adminUserMapper.selectListByNickname("不存在")).isEmpty();
    }

    /** 状态查询与部门集合查询必须按精确条件过滤。 */
    @Test
    void statusAndDeptQueriesFilterExactly() {
        adminUserMapper.insert(user(1L, "DUMMY-a", "甲", BUSINESS_ADMIN, 10L,
                CommonStatusEnum.ENABLE.getStatus(), "a@example.test", "13800000021"));
        adminUserMapper.insert(user(2L, "DUMMY-b", "乙", BUSINESS_ADMIN, 20L,
                CommonStatusEnum.DISABLE.getStatus(), "b@example.test", "13800000022"));

        assertThat(adminUserMapper.selectListByStatus(CommonStatusEnum.ENABLE.getStatus()))
                .extracting(AdminUserDO::getUsername).containsExactly("DUMMY-a");
        assertThat(adminUserMapper.selectListByStatus(CommonStatusEnum.DISABLE.getStatus()))
                .extracting(AdminUserDO::getUsername).containsExactly("DUMMY-b");
        assertThat(adminUserMapper.selectListByStatus(99)).as("未登记状态不得命中任何用户").isEmpty();
        assertThat(adminUserMapper.selectListByDeptIds(List.of(10L, 20L)))
                .extracting(AdminUserDO::getUsername).containsExactlyInAnyOrder("DUMMY-a", "DUMMY-b");
        assertThat(adminUserMapper.selectListByDeptIds(List.of(30L))).isEmpty();
    }

    /**
     * 业务管理平台必须兼容读取平台字段为空或空串的历史账号，其它平台必须严格匹配。
     *
     * <p>老账号的平台字段可能为空；若严格匹配，这些账号会无法登录或无法被运营工具选中；
     * 若把兼容范围扩大到其它平台，两个平台的账号会互相可见，属于跨平台身份泄漏。</p>
     */
    @Test
    void businessAdminToleratesLegacyBlankUserTypeOnly() {
        adminUserMapper.insert(user(1L, "DUMMY-legacy-null", "历史空值", null, 1L,
                CommonStatusEnum.ENABLE.getStatus(), "legacy1@example.test", "13800000031"));
        adminUserMapper.insert(user(2L, "DUMMY-legacy-blank", "历史空串", "", 1L,
                CommonStatusEnum.ENABLE.getStatus(), "legacy2@example.test", "13800000032"));
        adminUserMapper.insert(user(3L, "DUMMY-super", "新平台", SUPER_ADMIN, 1L,
                CommonStatusEnum.ENABLE.getStatus(), "super@example.test", "13800000033"));
        adminUserMapper.insert(user(4L, "DUMMY-business", "业务平台", BUSINESS_ADMIN, 1L,
                CommonStatusEnum.ENABLE.getStatus(), "business@example.test", "13800000034"));

        assertThat(adminUserMapper.selectListByStatusAndUserType(CommonStatusEnum.ENABLE.getStatus(), BUSINESS_ADMIN))
                .extracting(AdminUserDO::getUsername)
                .as("业务平台必须包含显式、空值与空串三种形态")
                .containsExactlyInAnyOrder("DUMMY-business", "DUMMY-legacy-null", "DUMMY-legacy-blank");
        assertThat(adminUserMapper.selectListByStatusAndUserType(CommonStatusEnum.ENABLE.getStatus(), SUPER_ADMIN))
                .extracting(AdminUserDO::getUsername)
                .as("其它平台必须严格匹配，不得读到历史空值账号")
                .containsExactly("DUMMY-super");
        assertThat(adminUserMapper.selectListByStatusAndUserType(CommonStatusEnum.DISABLE.getStatus(), BUSINESS_ADMIN))
                .as("状态条件必须生效").isEmpty();
    }

    /**
     * 停用账号不得出现在启用筛选结果中，避免运营把停用账号当成可登录账号。
     *
     * <p>这里同时验证条件组合在真实 SQL 下不会退化成"忽略状态"。</p>
     */
    @Test
    void disabledUsersAreNotReturnedForEnabledFilter() {
        adminUserMapper.insert(user(1L, "DUMMY-enabled", "启用", BUSINESS_ADMIN, 1L,
                CommonStatusEnum.ENABLE.getStatus(), "enabled@example.test", "13800000041"));
        adminUserMapper.insert(user(2L, "DUMMY-disabled", "停用", BUSINESS_ADMIN, 1L,
                CommonStatusEnum.DISABLE.getStatus(), "disabled@example.test", "13800000042"));

        List<AdminUserDO> enabled = adminUserMapper.selectListByStatusAndUserType(
                CommonStatusEnum.ENABLE.getStatus(), BUSINESS_ADMIN);

        assertThat(enabled).extracting(AdminUserDO::getUsername).containsExactly("DUMMY-enabled");
    }

    /** 关闭上下文并删除随机数据库；异常时也继续回收。 */
    @AfterAll
    void closeEnvironment() throws Exception {
        try {
            if (context != null) {
                context.close();
            }
        } finally {
            if (schemaCreated) {
                try (Connection connection = DriverManager.getConnection(adminUrl, databaseUser, databasePassword);
                     Statement statement = connection.createStatement()) {
                    statement.execute("DROP DATABASE `" + schema + "`");
                }
            }
        }
    }

    /**
     * 登记生产 Mapper 到测试上下文。
     *
     * @param mapperType Mapper 接口类型
     * @param <T> Mapper 类型
     */
    private <T> void registerMapper(Class<T> mapperType) {
        context.registerBean(mapperType, () -> {
            try {
                MapperFactoryBean<T> factory = new MapperFactoryBean<>(mapperType);
                factory.setSqlSessionFactory(context.getBean(SqlSessionFactory.class));
                factory.afterPropertiesSet();
                return factory.getObject();
            } catch (Exception failure) {
                throw new IllegalStateException("测试 Mapper 创建失败：" + mapperType.getSimpleName(), failure);
            }
        });
    }

    /**
     * 构造后台用户记录。
     *
     * @param id 编号
     * @param username 账号
     * @param nickname 昵称
     * @param userType 平台类型，允许为 null 表示历史空值
     * @param deptId 部门编号
     * @param status 状态
     * @param email 邮箱
     * @param mobile 手机号
     * @return 后台用户记录
     */
    private static AdminUserDO user(Long id, String username, String nickname, String userType, Long deptId,
                                    Integer status, String email, String mobile) {
        AdminUserDO user = new AdminUserDO();
        user.setId(id);
        user.setUsername(username);
        user.setNickname(nickname);
        user.setUserType(userType);
        user.setDeptId(deptId);
        user.setStatus(status);
        user.setEmail(email);
        user.setMobile(mobile);
        user.setPassword("CHANGE_ME_SYNTHETIC_PASSWORD");
        return user;
    }

    /** 缺失隔离环境时直接失败，避免退化成跳过真实数据库证据。 */
    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("缺少隔离测试环境变量 " + name);
        }
        return value;
    }

    /** 定位版本控制中的生产 DDL，不依赖测试进程从哪个模块启动。 */
    private static Path repositoryRoot() {
        Path directory = Path.of("").toAbsolutePath();
        while (directory != null && !Files.isRegularFile(directory.resolve("数据库文件/basic_framework.sql"))) {
            directory = directory.getParent();
        }
        if (directory == null) {
            throw new IllegalStateException("未找到框架空库基线");
        }
        return directory;
    }

    /** 使用真实 MyBatis 配置与审计填充器，防止内存替身掩盖映射错误。 */
    private static SqlSessionFactory sqlSessionFactory(DataSource dataSource) {
        try {
            MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
            factory.setDataSource(dataSource);
            MybatisConfiguration configuration = new MybatisConfiguration();
            configuration.setMapUnderscoreToCamelCase(true);
            MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
            interceptor.addInnerInterceptor(new PaginationInnerInterceptor());
            configuration.addInterceptor(interceptor);
            factory.setConfiguration(configuration);
            GlobalConfig config = new GlobalConfig();
            config.setDbConfig(new GlobalConfig.DbConfig().setIdType(IdType.AUTO));
            config.setMetaObjectHandler(new DefaultDBFieldHandler());
            factory.setGlobalConfig(config);
            return factory.getObject();
        } catch (Exception failure) {
            throw new IllegalStateException("用户 Mapper 测试初始化失败", failure);
        }
    }

}
