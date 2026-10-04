package com.basicframework.module.system.dal.mysql;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.module.system.controller.admin.oauth2.vo.client.OAuth2ClientPageReqVO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2ClientDO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2RefreshTokenDO;
import com.basicframework.module.system.dal.mysql.dept.DeptMapper;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2ClientMapper;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2RefreshTokenMapper;
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
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 用独立 MySQL 库与生产 Mapper 验证部门、OAuth2 客户端与刷新令牌的默认查询条件。
 *
 * <p>这些 Mapper 方法把条件写在 Java 侧 Wrapper 里，条件写错不会编译失败：部门计数漏掉逻辑删除
 * 会让"还有子部门"的删除保护失效，按负责人查询漏掉平台类型会让两个管理平台的部门互相可见，
 * 客户端分页漏掉可选条件会返回不该出现的应用，刷新令牌删除条件写错则会撤销错误的会话。
 * 因此必须用真实 SQL 观察结果，不能用 Mock 代替。</p>
 *
 * <p>显式执行此集成入口必须提供环回测试环境，缺失环境直接失败，不连接业务库。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class SystemMapperConditionsMySqlIT {

    /** 本测试使用的生产表：部门表。 */
    private static final String DEPT_TABLE = "system_dept";
    /** 本测试使用的生产表：OAuth2 客户端表。 */
    private static final String CLIENT_TABLE = "system_oauth2_client";
    /** 本测试使用的生产表：OAuth2 刷新令牌表。 */
    private static final String REFRESH_TOKEN_TABLE = "system_oauth2_refresh_token";

    /** 可信管理平台类型，与生产枚举取值一致。 */
    private static final String BUSINESS_ADMIN = "business_admin";
    /** 另一个管理平台类型，用于验证平台隔离。 */
    private static final String SUPER_ADMIN = "super_admin";

    /** 本测试独占的随机库名，结束时整体删除。 */
    private final String schema = "bf_sys_mapper_" + UUID.randomUUID().toString().replace("-", "");

    /** 测试装配的上下文，持有真实数据源与三个生产 Mapper。 */
    private AnnotationConfigApplicationContext context;
    /** 直连测试库的 JDBC 模板，用于在 Mapper 之外观察持久状态。 */
    private JdbcTemplate jdbc;
    /** 被测部门 Mapper。 */
    private DeptMapper deptMapper;
    /** 被测 OAuth2 客户端 Mapper。 */
    private OAuth2ClientMapper clientMapper;
    /** 被测刷新令牌 Mapper。 */
    private OAuth2RefreshTokenMapper refreshTokenMapper;
    /** 管理连接使用的库级 URL，用于建库与删库。 */
    private String adminUrl;
    /** 隔离测试账号。 */
    private String databaseUser;
    /** 隔离测试口令。 */
    private String databasePassword;
    /** 是否已真实建库，决定结束时是否需要回收。 */
    private boolean schemaCreated;

    /** 建立随机数据库并只导入三张生产表；不导入种子数据。 */
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
        for (String table : List.of(DEPT_TABLE, CLIENT_TABLE, REFRESH_TOKEN_TABLE)) {
            var matcher = Pattern.compile("CREATE TABLE `" + table + "`[\\s\\S]*?;").matcher(ddl);
            assertThat(matcher.find()).as("生产表 %s 必须存在", table).isTrue();
            jdbc.execute(matcher.group());
        }

        context = new AnnotationConfigApplicationContext();
        context.registerBean(DataSource.class, () -> dataSource);
        context.registerBean(SqlSessionFactory.class, () -> sqlSessionFactory(dataSource));
        registerMapper(DeptMapper.class);
        registerMapper(OAuth2ClientMapper.class);
        registerMapper(OAuth2RefreshTokenMapper.class);
        context.refresh();
        deptMapper = context.getBean(DeptMapper.class);
        clientMapper = context.getBean(OAuth2ClientMapper.class);
        refreshTokenMapper = context.getBean(OAuth2RefreshTokenMapper.class);
    }

    /** 每例清空三张表，避免跨用例的唯一键冲突污染查询结果。 */
    @BeforeEach
    void resetFixtures() {
        jdbc.update("DELETE FROM " + DEPT_TABLE);
        jdbc.update("DELETE FROM " + CLIENT_TABLE);
        jdbc.update("DELETE FROM " + REFRESH_TOKEN_TABLE);
    }

    /**
     * 按父部门统计必须同时排除逻辑删除的子部门。
     *
     * <p>该计数用于"是否还有子部门"的删除保护：把已删除的子部门算进去会让部门永远删不掉，
     * 反之漏统计会让部门被删后留下孤儿子部门。</p>
     */
    @Test
    void deptCountByParentIdExcludesLogicallyDeletedRows() {
        DeptDO parent = dept("研发部", 0L, BUSINESS_ADMIN, null);
        DeptDO firstChild = dept("前端组", parent.getId(), BUSINESS_ADMIN, null);
        dept("后端组", parent.getId(), BUSINESS_ADMIN, null);
        DeptDO otherParent = dept("财务部", 0L, BUSINESS_ADMIN, null);

        assertThat(deptMapper.selectCountByParentId(parent.getId())).isEqualTo(2L);

        deptMapper.deleteById(firstChild.getId());

        assertThat(deptMapper.selectCountByParentId(parent.getId())).as("已删除的子部门不得计入").isEqualTo(1L);
        assertThat(deptMapper.selectCountByParentId(otherParent.getId())).isZero();
        assertThat(deptMapper.selectCountByParentId(999L)).isZero();
    }

    /**
     * 按负责人查询部门必须同时限定平台类型。
     *
     * <p>两个管理平台共用部门表，只按负责人过滤会让另一个平台的部门出现在当前平台的
     * "我负责的部门"中，属于跨平台数据泄漏。</p>
     */
    @Test
    void deptListByLeaderUserIdIsScopedToRoleType() {
        dept("业务平台研发部", 0L, BUSINESS_ADMIN, 7L);
        dept("新平台研发部", 0L, SUPER_ADMIN, 7L);
        dept("业务平台财务部", 0L, BUSINESS_ADMIN, 8L);

        List<DeptDO> result = deptMapper.selectListByLeaderUserId(7L, BUSINESS_ADMIN);

        assertThat(result).extracting(DeptDO::getName).containsExactly("业务平台研发部");
        assertThat(deptMapper.selectListByLeaderUserId(8L, SUPER_ADMIN)).as("其它平台的负责人不得命中").isEmpty();
        assertThat(deptMapper.selectListByLeaderUserId(null, BUSINESS_ADMIN))
                .as("负责人为空时必须按 null 精确匹配，而不是返回全部").isEmpty();
    }

    /** 按刷新令牌删除只影响该令牌，其它会话必须保持可用。 */
    @Test
    void deleteByRefreshTokenRemovesOnlyTargetSession() {
        refreshTokenMapper.insert(refreshToken("DUMMY-REFRESH-TOKEN-ALPHA", 1L));
        refreshTokenMapper.insert(refreshToken("DUMMY-REFRESH-TOKEN-BETA", 2L));

        int deleted = refreshTokenMapper.deleteByRefreshToken("DUMMY-REFRESH-TOKEN-ALPHA");

        assertThat(deleted).isEqualTo(1);
        assertThat(refreshTokenMapper.selectByRefreshToken("DUMMY-REFRESH-TOKEN-ALPHA")).as("被撤销的会话不得再可查").isNull();
        assertThat(refreshTokenMapper.selectByRefreshToken("DUMMY-REFRESH-TOKEN-BETA")).as("其它会话必须保持可用").isNotNull();
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + REFRESH_TOKEN_TABLE + " WHERE refresh_token = 'DUMMY-REFRESH-TOKEN-ALPHA'", Integer.class))
                .as("逻辑删除必须保留数据行").isEqualTo(1);
    }

    /** 删除未知刷新令牌必须返回 0，调用方据此识别重复撤销。 */
    @Test
    void deleteByRefreshTokenReturnsZeroForUnknownToken() {
        refreshTokenMapper.insert(refreshToken("token-gamma", 3L));

        assertThat(refreshTokenMapper.deleteByRefreshToken("token-absent")).isZero();
        assertThat(refreshTokenMapper.selectByRefreshToken("token-gamma")).isNotNull();
    }

    /**
     * 客户端分页必须按名称模糊、状态精确过滤，并按编号倒序返回。
     *
     * <p>名称与状态是运营筛选应用的入口；条件失效会让停用的应用出现在"启用"筛选结果中，
     * 顺序变化则让最近创建的应用沉到列表末尾。</p>
     */
    @Test
    void clientPageAppliesOptionalFiltersAndOrder() {
        clientMapper.insert(client("client-alpha", "Alpha 应用", CommonStatusEnum.ENABLE.getStatus()));
        clientMapper.insert(client("client-beta", "Beta 应用", CommonStatusEnum.DISABLE.getStatus()));
        OAuth2ClientDO newest = client("client-gamma", "Gamma 应用", CommonStatusEnum.ENABLE.getStatus());
        clientMapper.insert(newest);

        OAuth2ClientPageReqVO enableReq = new OAuth2ClientPageReqVO();
        enableReq.setStatus(CommonStatusEnum.ENABLE.getStatus());
        PageResult<OAuth2ClientDO> enablePage = clientMapper.selectPage(enableReq);
        assertThat(enablePage.getTotal()).isEqualTo(2L);
        assertThat(enablePage.getList()).extracting(OAuth2ClientDO::getClientId)
                .containsExactly("client-gamma", "client-alpha");

        OAuth2ClientPageReqVO nameReq = new OAuth2ClientPageReqVO();
        nameReq.setName("Beta");
        PageResult<OAuth2ClientDO> namePage = clientMapper.selectPage(nameReq);
        assertThat(namePage.getTotal()).isEqualTo(1L);
        assertThat(namePage.getList().get(0).getClientId()).isEqualTo("client-beta");

        OAuth2ClientPageReqVO noFilterReq = new OAuth2ClientPageReqVO();
        PageResult<OAuth2ClientDO> allPage = clientMapper.selectPage(noFilterReq);
        assertThat(allPage.getTotal()).as("未提供可选条件时不得追加过滤").isEqualTo(3L);
        assertThat(allPage.getList()).as("按编号倒序返回，最近创建的在前")
                .extracting(OAuth2ClientDO::getClientId)
                .containsExactly("client-gamma", "client-beta", "client-alpha");
        assertThat(allPage.getList().get(0).getId()).isEqualTo(newest.getId());
    }

    /** 客户端分页必须遵守页码与每页条数，避免一次返回全部应用。 */
    @Test
    void clientPageHonoursPagination() {
        clientMapper.insert(client("client-1", "应用一", CommonStatusEnum.ENABLE.getStatus()));
        clientMapper.insert(client("client-2", "应用二", CommonStatusEnum.ENABLE.getStatus()));
        clientMapper.insert(client("client-3", "应用三", CommonStatusEnum.ENABLE.getStatus()));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + CLIENT_TABLE, Integer.class))
                .as("夹具必须先真实落库，否则分页断言失去意义").isEqualTo(3);

        OAuth2ClientPageReqVO reqVO = new OAuth2ClientPageReqVO();
        reqVO.setPageNo(2);
        reqVO.setPageSize(1);

        PageResult<OAuth2ClientDO> page = clientMapper.selectPage(reqVO);

        assertThat(page.getTotal()).as("总数必须是全部匹配记录数，而不是当前页大小").isEqualTo(3L);
        assertThat(page.getList()).extracting(OAuth2ClientDO::getClientId).containsExactly("client-2");
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
     * 构造指定父部门、平台与负责人的部门记录。
     *
     * @param name 部门名称
     * @param parentId 父部门编号
     * @param roleType 平台类型
     * @param leaderUserId 负责人编号，允许为 null
     * @return 部门记录
     */
    private DeptDO dept(String name, Long parentId, String roleType, Long leaderUserId) {
        DeptDO dept = new DeptDO();
        dept.setName(name);
        dept.setParentId(parentId);
        dept.setRoleType(roleType);
        dept.setSort(0);
        dept.setLeaderUserId(leaderUserId);
        dept.setStatus(CommonStatusEnum.ENABLE.getStatus());
        deptMapper.insert(dept);
        return dept;
    }

    /**
     * 构造刷新令牌记录。
     *
     * @param refreshToken 刷新令牌
     * @param userId 用户编号
     * @return 刷新令牌记录
     */
    private OAuth2RefreshTokenDO refreshToken(String refreshToken, Long userId) {
        OAuth2RefreshTokenDO token = new OAuth2RefreshTokenDO();
        token.setRefreshToken(refreshToken);
        token.setUserId(userId);
        token.setUserType(2);
        token.setClientId("default");
        token.setScopes(List.of("user.read"));
        token.setExpiresTime(LocalDateTime.now().plusDays(30));
        return token;
    }

    /**
     * 构造 OAuth2 客户端记录。
     *
     * @param clientId 客户端编号
     * @param name 应用名
     * @param status 状态
     * @return 客户端记录
     */
    private OAuth2ClientDO client(String clientId, String name, Integer status) {
        OAuth2ClientDO client = new OAuth2ClientDO();
        client.setClientId(clientId);
        client.setSecret("synthetic-secret");
        client.setName(name);
        client.setLogo("https://cdn.example.test/logo.png");
        client.setStatus(status);
        client.setAccessTokenValiditySeconds(1800);
        client.setRefreshTokenValiditySeconds(2592000);
        client.setRedirectUris(List.of("https://client.example.test/callback"));
        client.setAuthorizedGrantTypes(List.of("authorization_code"));
        client.setScopes(List.of("user.read"));
        return client;
    }

    /** 缺失隔离环境时直接失败，避免退化成跳过真实数据库证据。 */
    private String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("缺少隔离测试环境变量 " + name);
        }
        return value;
    }

    /** 定位版本控制中的生产 DDL，不依赖测试进程从哪个模块启动。 */
    private Path repositoryRoot() {
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
    private SqlSessionFactory sqlSessionFactory(DataSource dataSource) {
        try {
            MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
            factory.setDataSource(dataSource);
            MybatisConfiguration configuration = new MybatisConfiguration();
            configuration.setMapUnderscoreToCamelCase(true);
            // 与生产一致地注册分页插件：缺少它时 selectPage 不会执行 count，总数恒为 0，
            // 会让“按条件过滤 + 分页”的断言全部失去意义。
            MybatisPlusInterceptor mybatisPlusInterceptor = new MybatisPlusInterceptor();
            mybatisPlusInterceptor.addInnerInterceptor(new PaginationInnerInterceptor());
            configuration.addInterceptor(mybatisPlusInterceptor);
            factory.setConfiguration(configuration);
            GlobalConfig config = new GlobalConfig();
            config.setDbConfig(new GlobalConfig.DbConfig().setIdType(IdType.AUTO));
            config.setMetaObjectHandler(new DefaultDBFieldHandler());
            factory.setGlobalConfig(config);
            return factory.getObject();
        } catch (Exception failure) {
            throw new IllegalStateException("系统 Mapper 测试初始化失败", failure);
        }
    }

}
