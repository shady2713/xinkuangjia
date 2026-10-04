package com.basicframework.module.system.dal.mysql.oauth2;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.module.system.controller.admin.oauth2.vo.token.OAuth2AccessTokenPageReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
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
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 用独立 MySQL 库与生产 Mapper 验证访问令牌分页查询的可选条件、有效期过滤与排序。
 *
 * <p>这些条件全部写在 Java 侧的 Wrapper 里，写错不会编译失败：漏掉有效期过滤会让已过期的
 * 令牌继续出现在"当前在线会话"列表中，漏掉用户或客户端条件会把其它身份的会话暴露给当前筛选，
 * 把模糊匹配写成精确匹配则让按客户端搜索失效。因此必须用真实 SQL 观察结果，不能用 Mock 代替。</p>
 *
 * <p>显式执行此集成入口必须提供环回测试环境，缺失环境直接失败，不连接业务库。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class OAuth2AccessTokenMapperMySqlIT {

    /** 本测试使用的生产表：OAuth2 访问令牌表。 */
    private static final String TOKEN_TABLE = "system_oauth2_access_token";

    /** 管理员用户类型值，与生产枚举一致。 */
    private static final Integer ADMIN = UserTypeEnum.ADMIN.getValue();
    /** 会员用户类型值，与生产枚举一致。 */
    private static final Integer MEMBER = UserTypeEnum.MEMBER.getValue();

    /** 本测试独占的随机库名，结束时整体删除。 */
    private final String schema = "bf_sys_token_" + UUID.randomUUID().toString().replace("-", "");

    /** 测试装配的上下文，持有真实数据源与生产 Mapper。 */
    private AnnotationConfigApplicationContext context;
    /** 直连测试库的 JDBC 模板，用于在 Mapper 之外观察持久状态。 */
    private JdbcTemplate jdbc;
    /** 被测访问令牌 Mapper。 */
    private OAuth2AccessTokenMapper tokenMapper;
    /** 管理连接使用的库级 URL，用于建库与删库。 */
    private String adminUrl;
    /** 隔离测试账号。 */
    private String databaseUser;
    /** 隔离测试口令。 */
    private String databasePassword;
    /** 是否已真实建库，决定结束时是否需要回收。 */
    private boolean schemaCreated;

    /** 建立随机数据库并只导入访问令牌表；不导入种子数据。 */
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
        var matcher = Pattern.compile("CREATE TABLE `" + TOKEN_TABLE + "`[\\s\\S]*?;").matcher(ddl);
        assertThat(matcher.find()).as("生产表 %s 必须存在", TOKEN_TABLE).isTrue();
        jdbc.execute(matcher.group());

        context = new AnnotationConfigApplicationContext();
        context.registerBean(DataSource.class, () -> dataSource);
        context.registerBean(SqlSessionFactory.class, () -> sqlSessionFactory(dataSource));
        context.registerBean(OAuth2AccessTokenMapper.class, () -> {
            try {
                MapperFactoryBean<OAuth2AccessTokenMapper> factory =
                        new MapperFactoryBean<>(OAuth2AccessTokenMapper.class);
                factory.setSqlSessionFactory(context.getBean(SqlSessionFactory.class));
                factory.afterPropertiesSet();
                return factory.getObject();
            } catch (Exception failure) {
                throw new IllegalStateException("测试 Mapper 创建失败：OAuth2AccessTokenMapper", failure);
            }
        });
        context.refresh();
        tokenMapper = context.getBean(OAuth2AccessTokenMapper.class);
    }

    /** 每例清空令牌表，避免跨用例的唯一键冲突与残留记录污染查询结果。 */
    @BeforeEach
    void resetFixtures() {
        jdbc.update("DELETE FROM " + TOKEN_TABLE);
    }

    /**
     * 未提供任何筛选条件时，只返回未过期令牌，并按编号倒序排列。
     *
     * <p>过期令牌仍留在表中等待清理任务回收，因此"在线会话"列表必须自己按有效期过滤；
     * 倒序保证最近签发的会话排在最前，方便运营优先看到当前登录。</p>
     */
    @Test
    void selectPageExcludesExpiredTokensAndOrdersByIdDesc() {
        OAuth2AccessTokenDO oldest = insert("token-alpha", 100L, ADMIN, "client-default", 30);
        OAuth2AccessTokenDO middle = insert("token-beta", 200L, MEMBER, "client-beta", 30);
        OAuth2AccessTokenDO newest = insert("token-gamma", 300L, ADMIN, "client-default", 30);
        insert("token-expired", 400L, ADMIN, "client-default", -1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + TOKEN_TABLE, Integer.class))
                .as("夹具必须先真实落库，过期记录同样可见").isEqualTo(4);

        PageResult<OAuth2AccessTokenDO> page = tokenMapper.selectPage(new OAuth2AccessTokenPageReqVO());

        assertThat(page.getTotal()).as("总数只统计未过期令牌").isEqualTo(3L);
        assertThat(page.getList()).extracting(OAuth2AccessTokenDO::getId)
                .as("按编号倒序返回，最近签发的在前")
                .containsExactly(newest.getId(), middle.getId(), oldest.getId());
        assertThat(page.getList()).extracting(OAuth2AccessTokenDO::getAccessToken)
                .doesNotContain("token-expired");
    }

    /**
     * 传入用户编号时只返回该用户的会话，未传时不追加条件。
     *
     * <p>用户编号用于"某用户当前登录了哪些设备"，条件失效会显示其它用户的会话。</p>
     */
    @Test
    void selectPageFiltersByUserIdWhenPresent() {
        OAuth2AccessTokenDO target = insert("token-user-100", 100L, ADMIN, "client-default", 30);
        insert("token-user-200", 200L, ADMIN, "client-default", 30);

        OAuth2AccessTokenPageReqVO filtered = new OAuth2AccessTokenPageReqVO();
        filtered.setUserId(100L);
        PageResult<OAuth2AccessTokenDO> result = tokenMapper.selectPage(filtered);

        assertThat(result.getTotal()).isEqualTo(1L);
        assertThat(result.getList()).extracting(OAuth2AccessTokenDO::getId).containsExactly(target.getId());
        assertThat(result.getList().get(0).getUserId()).isEqualTo(100L);

        insert("token-user-100-second", 100L, MEMBER, "client-default", 30);
        assertThat(tokenMapper.selectPage(new OAuth2AccessTokenPageReqVO()).getTotal())
                .as("未传用户编号时不得追加过滤").isEqualTo(3L);
    }

    /**
     * 传入用户类型时只返回该类型的会话，两个平台的会话互不混淆。
     *
     * <p>管理端与会员端共用令牌表，类型条件失效会让会员令牌出现在管理端在线列表中。</p>
     */
    @Test
    void selectPageFiltersByUserTypeWhenPresent() {
        OAuth2AccessTokenDO adminToken = insert("token-admin", 100L, ADMIN, "client-default", 30);
        insert("token-member", 100L, MEMBER, "client-default", 30);

        OAuth2AccessTokenPageReqVO filtered = new OAuth2AccessTokenPageReqVO();
        filtered.setUserType(ADMIN);
        PageResult<OAuth2AccessTokenDO> result = tokenMapper.selectPage(filtered);

        assertThat(result.getTotal()).isEqualTo(1L);
        assertThat(result.getList()).extracting(OAuth2AccessTokenDO::getId).containsExactly(adminToken.getId());
        assertThat(result.getList().get(0).getUserType()).isEqualTo(ADMIN);
    }

    /**
     * 客户端编号按模糊匹配，便于按应用名或前缀检索，且未传时不追加条件。
     *
     * <p>该条件用 {@code like} 而不是 {@code eq}：传入片段即应命中完整客户端编号，
     * 写成精确匹配时运营的搜索框会永远查不到结果。</p>
     */
    @Test
    void selectPageMatchesClientIdFuzzily() {
        OAuth2AccessTokenDO defaultClient = insert("token-default", 100L, ADMIN, "client-default", 30);
        OAuth2AccessTokenDO mobileClient = insert("token-mobile", 200L, ADMIN, "client-mobile", 30);

        OAuth2AccessTokenPageReqVO fuzzy = new OAuth2AccessTokenPageReqVO();
        fuzzy.setClientId("client-");
        PageResult<OAuth2AccessTokenDO> fragmentResult = tokenMapper.selectPage(fuzzy);
        assertThat(fragmentResult.getTotal()).as("片段必须按模糊匹配命中两条").isEqualTo(2L);
        assertThat(fragmentResult.getList()).extracting(OAuth2AccessTokenDO::getId)
                .containsExactly(mobileClient.getId(), defaultClient.getId());

        OAuth2AccessTokenPageReqVO exact = new OAuth2AccessTokenPageReqVO();
        exact.setClientId("client-mobile");
        assertThat(tokenMapper.selectPage(exact).getList()).extracting(OAuth2AccessTokenDO::getId)
                .containsExactly(mobileClient.getId());

        OAuth2AccessTokenPageReqVO absent = new OAuth2AccessTokenPageReqVO();
        absent.setClientId("client-absent");
        assertThat(tokenMapper.selectPage(absent).getList()).isEmpty();

        OAuth2AccessTokenPageReqVO blank = new OAuth2AccessTokenPageReqVO();
        blank.setClientId("   ");
        assertThat(tokenMapper.selectPage(blank).getTotal())
                .as("纯空白客户端编号不构成有效条件").isEqualTo(2L);
    }

    /** 分页参数必须真实生效：总数是全部匹配记录数，列表只含当前页。 */
    @Test
    void selectPageHonoursPagination() {
        OAuth2AccessTokenDO oldest = insert("token-1", 100L, ADMIN, "client-default", 30);
        OAuth2AccessTokenDO middle = insert("token-2", 100L, ADMIN, "client-default", 30);
        OAuth2AccessTokenDO newest = insert("token-3", 100L, ADMIN, "client-default", 30);

        OAuth2AccessTokenPageReqVO firstPage = new OAuth2AccessTokenPageReqVO();
        firstPage.setPageNo(1);
        firstPage.setPageSize(2);
        PageResult<OAuth2AccessTokenDO> page = tokenMapper.selectPage(firstPage);
        assertThat(page.getTotal()).as("总数必须是全部匹配记录数").isEqualTo(3L);
        assertThat(page.getList()).extracting(OAuth2AccessTokenDO::getId)
                .containsExactly(newest.getId(), middle.getId());

        OAuth2AccessTokenPageReqVO secondPage = new OAuth2AccessTokenPageReqVO();
        secondPage.setPageNo(2);
        secondPage.setPageSize(2);
        PageResult<OAuth2AccessTokenDO> lastPage = tokenMapper.selectPage(secondPage);
        assertThat(lastPage.getTotal()).isEqualTo(3L);
        assertThat(lastPage.getList()).extracting(OAuth2AccessTokenDO::getId)
                .containsExactly(oldest.getId());
    }

    /** 空表必须返回空列表与 0 总数，调用方无需额外判空。 */
    @Test
    void selectPageReturnsEmptyResultOnEmptyTable() {
        PageResult<OAuth2AccessTokenDO> page = tokenMapper.selectPage(new OAuth2AccessTokenPageReqVO());

        assertThat(page.getTotal()).isZero();
        assertThat(page.getList()).isEmpty();
    }

    /**
     * 查询时刻已到期的令牌必须被排除，有效期比较是严格大于。
     *
     * <p>数据库列的精度为秒，落库时间会被向下取整；查询条件取当前时刻，
     * 因此"正好此刻到期"的会话不会被当作仍然有效，避免过期会话多存活一轮查询。</p>
     */
    @Test
    void selectPageExcludesTokenExpiringAtQueryMoment() {
        OAuth2AccessTokenDO alreadyExpired = insertAt("token-just-expired", LocalDateTime.now().minusSeconds(1));
        OAuth2AccessTokenDO future = insertAt("token-future", LocalDateTime.now().plusDays(1));

        PageResult<OAuth2AccessTokenDO> page = tokenMapper.selectPage(new OAuth2AccessTokenPageReqVO());

        assertThat(page.getTotal()).isEqualTo(1L);
        assertThat(page.getList()).extracting(OAuth2AccessTokenDO::getId).containsExactly(future.getId());
        assertThat(page.getList()).extracting(OAuth2AccessTokenDO::getId).doesNotContain(alreadyExpired.getId());
    }

    /**
     * 插入指定有效期（相对当前时刻的天数偏移）的未删除令牌。
     *
     * @param accessToken 访问令牌值，全表唯一
     * @param userId 用户编号
     * @param userType 用户类型
     * @param clientId 客户端编号
     * @param expiresInDays 过期时间相对当前时刻的天数，负数表示已过期
     * @return 已落库的令牌记录，含自增编号
     */
    private OAuth2AccessTokenDO insert(String accessToken, Long userId, Integer userType, String clientId,
                                       long expiresInDays) {
        return insertAt(accessToken, LocalDateTime.now().plusDays(expiresInDays), userId, userType, clientId);
    }

    /**
     * 插入指定有效期的未删除令牌。
     *
     * @param accessToken 访问令牌值，全表唯一
     * @param expiresTime 过期时间
     * @return 已落库的令牌记录，含自增编号
     */
    private OAuth2AccessTokenDO insertAt(String accessToken, LocalDateTime expiresTime) {
        return insertAt(accessToken, expiresTime, 100L, ADMIN, "client-default");
    }

    /**
     * 插入一条访问令牌记录，用户信息与授权范围按生产 NOT NULL 列要求填充。
     *
     * @param accessToken 访问令牌值，全表唯一
     * @param expiresTime 过期时间
     * @param userId 用户编号
     * @param userType 用户类型
     * @param clientId 客户端编号
     * @return 已落库的令牌记录，含自增编号
     */
    private OAuth2AccessTokenDO insertAt(String accessToken, LocalDateTime expiresTime, Long userId,
                                         Integer userType, String clientId) {
        OAuth2AccessTokenDO token = new OAuth2AccessTokenDO();
        token.setAccessToken(accessToken);
        token.setRefreshToken("refresh-" + accessToken);
        token.setUserId(userId);
        token.setUserType(userType);
        token.setUserInfo(Map.of("nickname", "合成昵称"));
        token.setClientId(clientId);
        token.setScopes(List.of("user.read"));
        token.setExpiresTime(expiresTime);
        tokenMapper.insert(token);
        return token;
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
            // 与生产一致地注册分页插件：缺少它时 selectPage 不执行 count，总数恒为 0。
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
            throw new IllegalStateException("访问令牌 Mapper 测试初始化失败", failure);
        }
    }
}
