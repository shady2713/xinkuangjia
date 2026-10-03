package com.basicframework.framework.datapermission.core.rule.dept;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.DataPermissionInterceptor;
import com.basicframework.framework.common.biz.system.permission.PermissionCommonApi;
import com.basicframework.framework.common.biz.system.permission.dto.DeptDataPermissionRespDTO;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.datapermission.core.db.DataPermissionRuleHandler;
import com.basicframework.framework.datapermission.core.rule.DataPermissionRuleFactoryImpl;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import net.sf.jsqlparser.expression.Expression;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 用独立 MySQL、真实 MyBatis Plus 数据权限插件和生产 {@link DeptDataPermissionRule}，
 * 验证部门数据权限拼出的真实 SQL 与真实过滤结果。
 *
 * <p>重点确认机器主体（userId=0）在数据权限层的实际行为：
 * 该主体没有可解析的部门范围，若规则静默产出空条件或放行全部都属于越权。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class DeptDataPermissionRuleMySqlIT {

    /** 供静态装配读取的数据源。 */
    private static DataSource dataSource;
    /** 供静态装配读取的权限替身。 */
    private static RecordingPermissionCommonApi permissionApi;

    private final String schema = "bf_deptperm_" + UUID.randomUUID().toString().replace("-", "");

    private JdbcTemplate jdbc;
    private SqlSessionFactory sqlSessionFactory;
    private DeptDataPermissionRule rule;
    private String adminUrl;
    private String databaseUser;
    private String databasePassword;
    private boolean schemaCreated;

    /** 建立独立库与真实数据权限插件；只接受环回无库名连接，缺失环境直接失败。 */
    @BeforeAll
    void createEnvironment() throws Exception {
        adminUrl = requiredEnvironment("AUTH_TEST_MYSQL_URL");
        if (!adminUrl.matches("jdbc:mysql://(?:127\\.0\\.0\\.1|localhost):[0-9]+/(?:\\?.*)?")) {
            throw new IllegalArgumentException("AUTH_TEST_MYSQL_URL 必须是环回测试服务且不得包含数据库名");
        }
        databaseUser = requiredEnvironment("AUTH_TEST_MYSQL_USERNAME");
        databasePassword = requiredEnvironment("AUTH_TEST_MYSQL_PASSWORD");
        try (Connection connection = DriverManager.getConnection(adminUrl, databaseUser, databasePassword);
             Statement statement = connection.createStatement()) {
            statement.execute("CREATE DATABASE `" + schema + "` CHARACTER SET utf8mb4");
            schemaCreated = true;
        }
        String[] urlParts = adminUrl.split("\\?", 2);
        String url = urlParts[0] + schema + (urlParts.length == 2 ? "?" + urlParts[1] : "");
        dataSource = new DriverManagerDataSource(url, databaseUser, databasePassword);
        jdbc = new JdbcTemplate(dataSource);
        // 被测表刻意建在测试库内，与业务库隔离。
        jdbc.execute("CREATE TABLE t_perm_probe (id BIGINT NOT NULL AUTO_INCREMENT, dept_id BIGINT NOT NULL, "
                + "owner_id BIGINT NOT NULL, label VARCHAR(64) NOT NULL, PRIMARY KEY (id))");

        permissionApi = new RecordingPermissionCommonApi();
        rule = new DeptDataPermissionRule(permissionApi);
        rule.addDeptColumn("t_perm_probe", "dept_id");
        rule.addUserColumn("t_perm_probe", "owner_id");
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        DataPermissionRuleHandler handler = new DataPermissionRuleHandler(
                new DataPermissionRuleFactoryImpl(List.of(rule)));
        interceptor.addInnerInterceptor(new DataPermissionInterceptor(handler));
        interceptor.addInnerInterceptor(new PaginationInnerInterceptor(DbType.MYSQL));
        MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
        factory.setDataSource(dataSource);
        MybatisConfiguration configuration = new MybatisConfiguration();
        configuration.setMapUnderscoreToCamelCase(true);
        // 注册探针 Mapper，使其产生真实 MappedStatement 并被数据权限插件改写。
        configuration.addMapper(ProbeMapper.class);
        factory.setConfiguration(configuration);
        GlobalConfig global = new GlobalConfig();
        global.setDbConfig(new GlobalConfig.DbConfig().setIdType(IdType.AUTO));
        global.setMetaObjectHandler(new DefaultDBFieldHandler());
        factory.setGlobalConfig(global);
        factory.setPlugins(interceptor);
        sqlSessionFactory = factory.getObject();
    }

    /** 删除随机库，异常路径同样不遗留测试资源。 */
    @AfterAll
    void closeEnvironment() throws Exception {
        if (schemaCreated) {
            try (Connection connection = DriverManager.getConnection(adminUrl, databaseUser, databasePassword);
                 Statement statement = connection.createStatement()) {
                statement.execute("DROP DATABASE `" + schema + "`");
            }
        }
    }

    /** 每例清空数据与权限配置，并确保线程上没有残留身份。 */
    @BeforeEach
    void resetFixture() {
        SecurityContextHolder.clearContext();
        permissionApi.reset();
        jdbc.update("DELETE FROM t_perm_probe");
        // 两个部门各两名用户，另有一条无归属数据用于验证空集边界。
        jdbc.update("INSERT INTO t_perm_probe (dept_id, owner_id, label) VALUES "
                + "(10, 100, 'dept10-user100'), (10, 101, 'dept10-user101'), "
                + "(20, 200, 'dept20-user200'), (20, 201, 'dept20-user201')");
    }

    /**
     * 指定部门范围时只能读到该部门数据。
     * 若规则未生效或拼错列，越权读取会直接读到其他部门行。
     */
    @Test
    void realUserSeesOnlyPermittedDeptRows() {
        permissionApi.grant(scope(false, false, Set.of(10L)));
        asUser(100L, UserTypeEnum.ADMIN.getValue());

        List<String> labels = queryLabels();

        assertThat(labels).containsExactlyInAnyOrder("dept10-user100", "dept10-user101");
        assertThat(labels).as("不得读到其他部门数据").noneMatch(label -> label.startsWith("dept20"));
    }

    /** 部门范围叠加“可查看自己”时，应同时看到部门数据与本人数据。 */
    @Test
    void deptAndSelfAreCombinedWithOr() {
        permissionApi.grant(scope(false, true, Set.of(20L)));
        asUser(201L, UserTypeEnum.ADMIN.getValue());

        List<String> labels = queryLabels();

        assertThat(labels).containsExactlyInAnyOrder("dept20-user200", "dept20-user201");
    }

    /** 可查看自己但部门为空时，只能看到本人数据。 */
    @Test
    void selfOnlySeesOwnRow() {
        permissionApi.grant(scope(false, true, Set.of()));
        asUser(100L, UserTypeEnum.ADMIN.getValue());

        List<String> labels = queryLabels();

        assertThat(labels).containsExactly("dept10-user100");
    }

    /** 既不能看部门也不能看自己时必须返回空集，而不是放行全部。 */
    @Test
    void noDeptAndNoSelfYieldsEmptyResult() {
        permissionApi.grant(scope(false, false, Set.of()));
        asUser(100L, UserTypeEnum.ADMIN.getValue());

        assertThat(queryLabels())
                .as("无任何范围时静默放行等于全量泄露").isEmpty();
    }

    /** 可查看全部时不追加任何过滤条件。 */
    @Test
    void allScopeReturnsNullExpression() {
        permissionApi.grant(scope(true, true, Set.of()));
        asUser(100L, UserTypeEnum.ADMIN.getValue());

        assertThat(rule.getExpression("t_perm_probe", null))
                .as("可查看全部时不应拼接条件").isNull();
        assertThat(queryLabels()).hasSize(4);
    }

    /** 未登录时不追加条件，公开查询不应被数据权限误伤。 */
    @Test
    void anonymousUserIsNotFiltered() {
        assertThat(rule.getExpression("t_perm_probe", null)).isNull();
        assertThat(queryLabels()).hasSize(4);
    }

    /** 非管理员主体不受部门规则约束，数据权限只面向管理后台。 */
    @Test
    void nonAdminUserIsNotFiltered() {
        permissionApi.grant(scope(false, false, Set.of(10L)));
        asUser(100L, UserTypeEnum.MEMBER.getValue());

        assertThat(rule.getExpression("t_perm_probe", null)).isNull();
        assertThat(queryLabels()).hasSize(4);
    }

    /**
     * 锁定机器主体（userId=0）在数据权限层的实际行为。
     *
     * <p>生产权限服务对零号主体解析不出角色，只能给出“可查看自己”的范围，
     * 于是规则拼出 {@code owner_id = 0}。该编号不对应任何真实数据，结果是空集，
     * 属于静默无数据而不是显式拒绝；若下游把它当作有效身份继续处理，仍需在别处加固。</p>
     */
    @Test
    void machinePrincipalSeesEmptySetInsteadOfAllRows() {
        permissionApi.grant(scope(false, true, Set.of()));
        asUser(0L, UserTypeEnum.ADMIN.getValue());

        List<String> labels = queryLabels();

        assertThat(labels)
                .as("机器主体实际行为是空集，实测结果=%s", labels)
                .isEmpty();
    }

    /** 负数主体与零号主体同属机器边界，行为一致。 */
    @Test
    void negativePrincipalSeesEmptySet() {
        permissionApi.grant(scope(false, true, Set.of()));
        asUser(-1L, UserTypeEnum.ADMIN.getValue());

        assertThat(queryLabels()).isEmpty();
    }

    /** 数据权限必须在登录上下文中缓存，避免同一次请求内重复查询。 */
    @Test
    void permissionIsCachedInLoginUserContext() {
        permissionApi.grant(scope(false, false, Set.of(10L)));
        asUser(100L, UserTypeEnum.ADMIN.getValue());

        rule.getExpression("t_perm_probe", null);
        rule.getExpression("t_perm_probe", null);

        assertThat(permissionApi.queriedUserIds)
                .as("同一登录态内不得重复查询数据权限").containsExactly(100L);
    }

    /** 权限服务返回 null 时必须显式失败，不能退化为放行全部。 */
    @Test
    void nullPermissionResponseFailsLoudly() {
        permissionApi.returnNull = true;
        asUser(100L, UserTypeEnum.ADMIN.getValue());

        assertThatThrownBy(() -> rule.getExpression("t_perm_probe", new net.sf.jsqlparser.expression.Alias("p")))
                .as("权限服务异常时必须失败，不能静默放行").isInstanceOf(NullPointerException.class)
                .hasMessageContaining("未返回数据权限");
    }

    /**
     * 记录无表别名时的真实报错内容。
     *
     * <p>未加别名的查询是常见写法，此时规则本应给出“未返回数据权限”的可诊断信息，
     * 但异常消息的拼装会先解引用空的别名，导致抛出的是空指针本身，
     * 原始原因被掩盖。此处锁定实际表现，便于后续定位与修复。</p>
     */
    @Test
    void nullPermissionResponseWithoutAliasMasksRootCause() {
        permissionApi.returnNull = true;
        asUser(100L, UserTypeEnum.ADMIN.getValue());

        assertThatThrownBy(() -> rule.getExpression("t_perm_probe", null))
                .as("当前实际抛出的是别名解引用空指针，原始原因不可见")
                .isInstanceOf(NullPointerException.class)
                .hasMessageContaining("tableAlias");
    }

    /**
     * 记录未登记表名的真实规则输出。
     *
     * <p>规则本身不按表名过滤，而是产出恒假条件；按表名跳过未登记表是
     * {@code DataPermissionRuleHandler} 的职责。此处锁定分层，避免误判过滤位置。</p>
     */
    @Test
    void unregisteredTableYieldsDenyAllExpression() {
        permissionApi.grant(scope(false, false, Set.of(10L)));
        asUser(100L, UserTypeEnum.ADMIN.getValue());

        Expression expression = rule.getExpression("t_other_table", null);
        assertThat(expression)
                .as("未登记表在规则层表现为恒假条件").isNotNull();
        assertThat(expression.toString()).isEqualTo("null = null");
    }

    /** 规则暴露的表名集合必须与登记的列一致，供插件按表匹配。 */
    @Test
    void tableNamesReflectRegisteredColumns() {
        assertThat(rule.getTableNames()).contains("t_perm_probe");
    }

    /**
     * 通过真实 Mapper 执行验证过滤结果。
     *
     * <p>必须走 MyBatis 映射语句，原始 JDBC 语句不会经过数据权限插件改写，
     * 直接调用规则也只能验证表达式，两者都无法证明过滤真的作用在 SQL 上。</p>
     */
    private List<String> queryLabels() {
        try (var session = sqlSessionFactory.openSession()) {
            return session.getMapper(ProbeMapper.class).selectLabels();
        }
    }

    /** 探针表查询接口，用于产生真实 MappedStatement 以触发数据权限插件。 */
    interface ProbeMapper {

        /** 查询全部标签，由数据权限插件追加过滤条件。 */
        @org.apache.ibatis.annotations.Select("SELECT label FROM t_perm_probe")
        List<String> selectLabels();
    }

    /**
     * 构造数据权限范围。
     *
     * @param all  是否可查看全部
     * @param self 是否可查看自己
     * @param deptIds 可查看的部门编号
     * @return 数据权限范围
     */
    private static DeptDataPermissionRespDTO scope(Boolean all, Boolean self, Set<Long> deptIds) {
        DeptDataPermissionRespDTO result = new DeptDataPermissionRespDTO();
        result.setAll(all);
        result.setSelf(self);
        if (deptIds != null) {
            result.setDeptIds(new java.util.HashSet<>(deptIds));
        }
        return result;
    }

    /** 以指定身份执行查询，结束后恢复空上下文。 */
    private void asUser(Long userId, Integer userType) {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(userId);
        loginUser.setUserType(userType);
        SecurityFrameworkUtils.setLoginUser(loginUser, new MockHttpServletRequest());
    }

    /** 从测试专用环境读取必要连接参数，缺失时直接失败。 */
    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("必须提供测试环境变量 " + name);
        }
        return value;
    }

    /**
     * 权限接口替身：只返回用例显式授予的范围，并记录真实查询。
     * 一律放行会让数据权限断言成为恒真，无法证明过滤真的生效。
     */
    static class RecordingPermissionCommonApi implements PermissionCommonApi {

        /** 本次授予的数据权限范围。 */
        private final AtomicReference<DeptDataPermissionRespDTO> granted = new AtomicReference<>();
        /** 记录被查询的用户编号。 */
        private final List<Long> queriedUserIds = java.util.Collections.synchronizedList(new ArrayList<>());
        /** 是否模拟权限服务返回 null。 */
        private volatile boolean returnNull;

        /** 授予指定数据权限范围。 */
        void grant(DeptDataPermissionRespDTO permission) {
            granted.set(permission);
        }

        /** 清空本例状态。 */
        void reset() {
            granted.set(null);
            queriedUserIds.clear();
            returnNull = false;
        }

        /** 返回显式授予的范围。 */
        @Override
        public DeptDataPermissionRespDTO getDeptDataPermission(Long userId) {
            queriedUserIds.add(userId);
            return returnNull ? null : granted.get();
        }

        /** 功能权限不在本测试的被测范围内。 */
        @Override
        public boolean hasAnyPermissions(Long userId, String... permissions) {
            throw new UnsupportedOperationException("本测试不校验功能权限");
        }

        /** 功能权限不在本测试的被测范围内。 */
        @Override
        public boolean hasAnyRoles(Long userId, String... roles) {
            throw new UnsupportedOperationException("本测试不校验功能权限");
        }
    }


}
