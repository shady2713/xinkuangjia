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
import com.basicframework.module.system.api.logger.dto.OperateLogPageReqDTO;
import com.basicframework.module.system.controller.admin.dept.vo.post.PostPageReqVO;
import com.basicframework.module.system.controller.admin.logger.vo.operatelog.OperateLogPageReqVO;
import com.basicframework.module.system.controller.admin.permission.vo.menu.MenuListReqVO;
import com.basicframework.module.system.controller.admin.permission.vo.role.RolePageReqVO;
import com.basicframework.module.system.dal.dataobject.dept.PostDO;
import com.basicframework.module.system.dal.dataobject.logger.OperateLogDO;
import com.basicframework.module.system.dal.dataobject.permission.MenuDO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.dal.dataobject.permission.RoleMenuDO;
import com.basicframework.module.system.dal.dataobject.permission.UserRoleDO;
import com.basicframework.module.system.dal.mysql.dept.PostMapper;
import com.basicframework.module.system.dal.mysql.logger.OperateLogMapper;
import com.basicframework.module.system.dal.mysql.permission.MenuMapper;
import com.basicframework.module.system.dal.mysql.permission.RoleMapper;
import com.basicframework.module.system.dal.mysql.permission.RoleMenuMapper;
import com.basicframework.module.system.dal.mysql.permission.UserRoleMapper;
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
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 用独立 MySQL 库与生产 Mapper 验证岗位、角色、菜单、角色菜单、用户角色与操作日志的真实查询与删除条件。
 *
 * <p>这些 Mapper 方法把条件写在 Java 侧 Wrapper 里，条件写错不会编译失败，但后果直接落在业务上：
 * 岗位与角色分页漏掉可选条件会返回不该出现的记录；按状态批量查询若把空集合当成"不过滤"，
 * 权限计算会把停用角色当成有效授权；角色菜单与用户角色的删除条件写错会误删其它角色或用户的关联，
 * 导致越权或授权丢失；操作日志分页条件失效则会让审计查询返回无关日志。</p>
 *
 * <p>因此本用例不依赖 Mock，而是建随机库、导入生产 DDL、用真实 MyBatis Plus 与真实 SQL 观察结果，
 * 删除类方法还额外用 JDBC 独立观察受影响行，避免只信 Mapper 自报结果。</p>
 *
 * <p>显式执行此集成入口必须提供环回测试环境，缺失环境直接失败，不连接业务库。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class PermissionAndLogMapperMySqlIT {

    /** 本测试使用的生产表：岗位表。 */
    private static final String POST_TABLE = "system_post";
    /** 本测试使用的生产表：角色表。 */
    private static final String ROLE_TABLE = "system_role";
    /** 本测试使用的生产表：菜单表。 */
    private static final String MENU_TABLE = "system_menu";
    /** 本测试使用的生产表：角色菜单关联表。 */
    private static final String ROLE_MENU_TABLE = "system_role_menu";
    /** 本测试使用的生产表：用户角色关联表。 */
    private static final String USER_ROLE_TABLE = "system_user_role";
    /** 本测试使用的生产表：操作日志表。 */
    private static final String OPERATE_LOG_TABLE = "system_operate_log";

    /** 可信管理平台类型，与生产枚举取值一致。 */
    private static final String BUSINESS_ADMIN = "business_admin";
    /** 另一个管理平台类型，用于验证平台隔离。 */
    private static final String SUPER_ADMIN = "super_admin";

    /** 本测试独占的随机库名，结束时整体删除。 */
    private final String schema = "bf_perm_mapper_" + UUID.randomUUID().toString().replace("-", "");

    /** 测试装配的上下文，持有真实数据源与六个生产 Mapper。 */
    private AnnotationConfigApplicationContext context;
    /** 直连测试库的 JDBC 模板，用于在 Mapper 之外观察持久状态。 */
    private JdbcTemplate jdbc;
    /** 被测岗位 Mapper。 */
    private PostMapper postMapper;
    /** 被测角色 Mapper。 */
    private RoleMapper roleMapper;
    /** 被测菜单 Mapper。 */
    private MenuMapper menuMapper;
    /** 被测角色菜单 Mapper。 */
    private RoleMenuMapper roleMenuMapper;
    /** 被测用户角色 Mapper。 */
    private UserRoleMapper userRoleMapper;
    /** 被测操作日志 Mapper。 */
    private OperateLogMapper operateLogMapper;
    /** 管理连接使用的库级 URL，用于建库与删库。 */
    private String adminUrl;
    /** 隔离测试账号。 */
    private String databaseUser;
    /** 隔离测试口令。 */
    private String databasePassword;
    /** 是否已真实建库，决定结束时是否需要回收。 */
    private boolean schemaCreated;

    /** 建立随机数据库并只导入六张生产表；不导入种子数据。 */
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
        for (String table : List.of(POST_TABLE, ROLE_TABLE, MENU_TABLE, ROLE_MENU_TABLE,
                USER_ROLE_TABLE, OPERATE_LOG_TABLE)) {
            var matcher = Pattern.compile("CREATE TABLE `" + table + "`[\\s\\S]*?;").matcher(ddl);
            assertThat(matcher.find()).as("生产表 %s 必须存在", table).isTrue();
            jdbc.execute(matcher.group());
        }

        context = new AnnotationConfigApplicationContext();
        context.registerBean(DataSource.class, () -> dataSource);
        context.registerBean(SqlSessionFactory.class, () -> sqlSessionFactory(dataSource));
        registerMapper(PostMapper.class);
        registerMapper(RoleMapper.class);
        registerMapper(MenuMapper.class);
        registerMapper(RoleMenuMapper.class);
        registerMapper(UserRoleMapper.class);
        registerMapper(OperateLogMapper.class);
        context.refresh();
        postMapper = context.getBean(PostMapper.class);
        roleMapper = context.getBean(RoleMapper.class);
        menuMapper = context.getBean(MenuMapper.class);
        roleMenuMapper = context.getBean(RoleMenuMapper.class);
        userRoleMapper = context.getBean(UserRoleMapper.class);
        operateLogMapper = context.getBean(OperateLogMapper.class);
    }

    /** 每例清空六张表，避免跨用例的唯一键冲突污染查询结果。 */
    @BeforeEach
    void resetFixtures() {
        for (String table : List.of(ROLE_MENU_TABLE, USER_ROLE_TABLE, OPERATE_LOG_TABLE,
                MENU_TABLE, ROLE_TABLE, POST_TABLE)) {
            jdbc.update("DELETE FROM " + table);
        }
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

    /** 岗位列表必须按编号集合与状态集合同时过滤，两者都缺省时不得追加条件。 */
    @Test
    void postListAppliesIdAndStatusFilters() {
        PostDO development = post("post_dev", "研发岗", 1, CommonStatusEnum.ENABLE.getStatus());
        post("post_ops", "运维岗", 2, CommonStatusEnum.ENABLE.getStatus());
        PostDO disabled = post("post_old", "停用岗", 3, CommonStatusEnum.DISABLE.getStatus());

        assertThat(postMapper.selectList(List.of(development.getId(), disabled.getId()),
                List.of(CommonStatusEnum.ENABLE.getStatus())))
                .as("编号与状态必须同时生效").extracting(PostDO::getCode).containsExactly("post_dev");
        Collection<Long> noIds = null;
        assertThat(postMapper.selectList(noIds, List.of(CommonStatusEnum.DISABLE.getStatus())))
                .extracting(PostDO::getCode).containsExactly("post_old");
        Collection<Long> absentIds = null;
        Collection<Integer> absentStatuses = null;
        assertThat(postMapper.selectList(absentIds, absentStatuses)).as("两个集合都缺省时不得追加过滤").hasSize(3);
        assertThat(postMapper.selectList(List.<Long>of(), List.<Integer>of())).as("空集合按不筛选处理").hasSize(3);
    }

    /** 岗位分页必须支持编号/名称模糊与状态精确过滤，并按编号倒序。 */
    @Test
    void postPageAppliesOptionalFiltersAndOrder() {
        post("post_dev", "研发岗", 1, CommonStatusEnum.ENABLE.getStatus());
        post("post_qa", "测试岗", 2, CommonStatusEnum.ENABLE.getStatus());
        post("post_ops", "运维岗", 3, CommonStatusEnum.DISABLE.getStatus());

        PostPageReqVO statusReq = new PostPageReqVO();
        statusReq.setName("岗");
        statusReq.setStatus(CommonStatusEnum.ENABLE.getStatus());
        PageResult<PostDO> statusPage = postMapper.selectPage(statusReq);
        assertThat(statusPage.getTotal()).isEqualTo(2L);
        assertThat(statusPage.getList()).as("按编号倒序返回").extracting(PostDO::getCode)
                .containsExactly("post_qa", "post_dev");

        PostPageReqVO codeReq = new PostPageReqVO();
        codeReq.setCode("dev");
        assertThat(postMapper.selectPage(codeReq).getList()).extracting(PostDO::getCode).containsExactly("post_dev");

        PostPageReqVO nameReq = new PostPageReqVO();
        nameReq.setName("运维");
        assertThat(postMapper.selectPage(nameReq).getList()).extracting(PostDO::getCode).containsExactly("post_ops");

        assertThat(postMapper.selectPage(new PostPageReqVO()).getTotal())
                .as("未提供可选条件时不得追加过滤").isEqualTo(3L);
    }

    /** 岗位按名称与编码查询必须精确匹配，未知取值返回 null。 */
    @Test
    void postSelectByNameAndCodeMatchExactly() {
        post("post_dev", "研发岗", 1, CommonStatusEnum.ENABLE.getStatus());

        assertThat(postMapper.selectByName("研发岗")).isNotNull();
        assertThat(postMapper.selectByName("研发")).as("名称必须精确匹配，不做模糊").isNull();
        assertThat(postMapper.selectByCode("post_dev").getName()).isEqualTo("研发岗");
        assertThat(postMapper.selectByCode("post_absent")).isNull();
    }

    /** 角色分页必须支持名称/编码模糊、状态与平台类型精确、创建时间区间，并按排序值升序。 */
    @Test
    void rolePageAppliesAllOptionalFiltersAndOrder() {
        role("超级管理员", "role_super", SUPER_ADMIN, 1, CommonStatusEnum.ENABLE.getStatus(), 1);
        role("业务管理员", "role_biz", BUSINESS_ADMIN, 2, CommonStatusEnum.ENABLE.getStatus(), 1);
        role("停用角色", "role_old", BUSINESS_ADMIN, 3, CommonStatusEnum.DISABLE.getStatus(), 2);

        RolePageReqVO platformReq = new RolePageReqVO();
        platformReq.setRoleType(BUSINESS_ADMIN);
        platformReq.setStatus(CommonStatusEnum.ENABLE.getStatus());
        assertThat(roleMapper.selectPage(platformReq).getList()).as("平台类型必须真实隔离")
                .extracting(RoleDO::getCode).containsExactly("role_biz");

        RolePageReqVO nameReq = new RolePageReqVO();
        nameReq.setName("管理员");
        assertThat(roleMapper.selectPage(nameReq).getList()).extracting(RoleDO::getCode)
                .containsExactlyInAnyOrder("role_super", "role_biz");

        RolePageReqVO codeReq = new RolePageReqVO();
        codeReq.setCode("role_super");
        assertThat(roleMapper.selectPage(codeReq).getList()).extracting(RoleDO::getCode).containsExactly("role_super");

        RolePageReqVO recentReq = new RolePageReqVO();
        recentReq.setCreateTime(new LocalDateTime[] {LocalDateTime.now().minusMinutes(5), LocalDateTime.now().plusMinutes(5)});
        assertThat(roleMapper.selectPage(recentReq).getTotal()).as("创建时间落在区间内时必须命中").isEqualTo(3L);

        RolePageReqVO pastReq = new RolePageReqVO();
        pastReq.setCreateTime(new LocalDateTime[] {LocalDateTime.now().minusDays(2), LocalDateTime.now().minusDays(1)});
        assertThat(roleMapper.selectPage(pastReq).getTotal()).as("区间外不得命中").isZero();

        assertThat(roleMapper.selectPage(new RolePageReqVO()).getList()).as("按排序值升序返回")
                .extracting(RoleDO::getCode).containsExactly("role_super", "role_biz", "role_old");
    }

    /** 角色按名称/编码查询与按状态、平台类型批量查询的真实语义。 */
    @Test
    void roleSelectsByNameCodeStatusAndRoleType() {
        role("业务管理员", "role_biz", BUSINESS_ADMIN, 1, CommonStatusEnum.ENABLE.getStatus(), 1);
        role("停用角色", "role_old", BUSINESS_ADMIN, 2, CommonStatusEnum.DISABLE.getStatus(), 2);
        role("超级管理员", "role_super", SUPER_ADMIN, 3, CommonStatusEnum.ENABLE.getStatus(), 3);

        assertThat(roleMapper.selectByName("业务管理员").getCode()).isEqualTo("role_biz");
        assertThat(roleMapper.selectByName("不存在")).isNull();
        assertThat(roleMapper.selectByCode("role_super").getName()).isEqualTo("超级管理员");

        assertThat(roleMapper.selectListByStatus(List.of(CommonStatusEnum.ENABLE.getStatus())))
                .extracting(RoleDO::getCode).containsExactlyInAnyOrder("role_biz", "role_super");
        assertThat(roleMapper.selectListByStatus(null))
                .as("状态集合缺省时必须短路为空结果，绝不能退化成不过滤而返回停用角色").isEmpty();
        assertThat(roleMapper.selectListByStatus(List.of()))
                .as("空状态集合与缺省同义").isEmpty();

        assertThat(roleMapper.selectListByRoleType(BUSINESS_ADMIN)).extracting(RoleDO::getCode)
                .containsExactlyInAnyOrder("role_biz", "role_old");
        assertThat(roleMapper.selectListByRoleType("unknown_platform")).isEmpty();
    }

    /** 菜单按父级与名称、按父级计数、按可选条件列表，以及按权限/类型/组件名查询。 */
    @Test
    void menuQueriesMatchParentPermissionTypeAndComponent() {
        MenuDO catalog = menu(0L, "系统管理", 1, "CATALOG", null, null,
                CommonStatusEnum.ENABLE.getStatus(), 1);
        menu(catalog.getId(), "用户管理", 2, "MENU", "system:user:list", "system/user/index",
                CommonStatusEnum.ENABLE.getStatus(), 2);
        menu(catalog.getId(), "角色管理", 2, "MENU", "system:role:list", "system/role/index",
                CommonStatusEnum.DISABLE.getStatus(), 3);

        assertThat(menuMapper.selectByParentIdAndName(catalog.getId(), "用户管理")).isNotNull();
        assertThat(menuMapper.selectByParentIdAndName(0L, "用户管理"))
                .as("父级不同不得命中同名菜单").isNull();
        assertThat(menuMapper.selectCountByParentId(catalog.getId())).isEqualTo(2L);
        assertThat(menuMapper.selectCountByParentId(999L)).isZero();

        MenuListReqVO reqVO = new MenuListReqVO();
        reqVO.setName("管理");
        reqVO.setStatus(CommonStatusEnum.ENABLE.getStatus());
        reqVO.setMenuType("MENU");
        assertThat(menuMapper.selectList(reqVO)).extracting(MenuDO::getName).containsExactly("用户管理");
        assertThat(menuMapper.selectList(new MenuListReqVO())).as("缺省条件不得过滤").hasSize(3);

        assertThat(menuMapper.selectListByPermission("system:user:list")).extracting(MenuDO::getName)
                .containsExactly("用户管理");
        assertThat(menuMapper.selectListByPermission("system:absent:list")).isEmpty();
        assertThat(menuMapper.selectListByMenuType("CATALOG")).extracting(MenuDO::getName)
                .containsExactly("系统管理");
        assertThat(menuMapper.selectByComponentName("system/role/index").getName()).isEqualTo("角色管理");
        assertThat(menuMapper.selectByComponentName("system/absent/index")).isNull();
    }

    /** 角色菜单查询必须按角色集合或菜单过滤，删除必须只影响指定范围。 */
    @Test
    void roleMenuQueriesAndDeletesAreScoped() {
        roleMenu(1L, 11L);
        roleMenu(1L, 12L);
        roleMenu(2L, 11L);

        assertThat(roleMenuMapper.selectListByRoleId(List.of(1L, 2L))).hasSize(3);
        assertThat(roleMenuMapper.selectListByRoleId(List.of())).as("空角色集合必须短路为空结果").isEmpty();
        assertThat(roleMenuMapper.selectListByMenuId(11L)).extracting(RoleMenuDO::getRoleId)
                .containsExactlyInAnyOrder(1L, 2L);
        assertThat(roleMenuMapper.selectListByMenuId(99L)).isEmpty();

        roleMenuMapper.deleteListByRoleIdAndMenuIds(1L, List.of(11L));
        assertThat(roleMenuMapper.selectListByRoleId(1L)).as("只删除指定角色的指定菜单")
                .extracting(RoleMenuDO::getMenuId).containsExactly(12L);
        assertThat(roleMenuMapper.selectListByMenuId(11L)).as("其它角色的同一菜单关联必须保留").hasSize(1);

        roleMenuMapper.deleteListByMenuId(11L);
        assertThat(roleMenuMapper.selectListByMenuId(11L)).isEmpty();
        assertThat(countActive(ROLE_MENU_TABLE)).as("删除必须真实落库").isEqualTo(1);
        assertThat(countAll(ROLE_MENU_TABLE)).as("逻辑删除必须保留物理行").isEqualTo(3);

        roleMenuMapper.deleteListByRoleId(1L);
        assertThat(roleMenuMapper.selectListByRoleId(1L)).isEmpty();
        assertThat(countActive(ROLE_MENU_TABLE)).isZero();
    }

    /** 用户角色查询必须按用户集合或角色集合过滤，删除必须只影响指定范围。 */
    @Test
    void userRoleQueriesAndDeletesAreScoped() {
        userRole(1L, 11L);
        userRole(1L, 12L);
        userRole(2L, 11L);

        assertThat(userRoleMapper.selectListByUserIds(List.of(1L))).hasSize(2);
        assertThat(userRoleMapper.selectListByUserIds(List.of()))
                .as("空用户集合必须直接返回空结果，不得退化为全表查询").isEmpty();
        assertThat(userRoleMapper.selectListByUserIds(null)).as("缺省用户集合同样短路").isEmpty();
        assertThat(userRoleMapper.selectListByUserId(1L)).hasSize(2);
        assertThat(userRoleMapper.selectListByRoleIds(List.of(11L))).extracting(UserRoleDO::getUserId)
                .containsExactlyInAnyOrder(1L, 2L);
        assertThat(userRoleMapper.selectListByRoleIds(List.of())).isEmpty();

        userRoleMapper.deleteListByUserIdAndRoleIdIds(1L, List.of(11L));
        assertThat(userRoleMapper.selectListByUserId(1L)).as("只删除指定用户的指定角色")
                .extracting(UserRoleDO::getRoleId).containsExactly(12L);
        assertThat(userRoleMapper.selectListByRoleIds(List.of(11L))).as("其它用户的同一角色关联必须保留").hasSize(1);

        userRoleMapper.deleteListByUserId(1L);
        assertThat(userRoleMapper.selectListByUserId(1L)).isEmpty();
        assertThat(countActive(USER_ROLE_TABLE)).as("删除必须真实落库").isEqualTo(1);
        assertThat(countAll(USER_ROLE_TABLE)).as("逻辑删除必须保留物理行").isEqualTo(3);

        userRoleMapper.deleteListByRoleId(11L);
        assertThat(countActive(USER_ROLE_TABLE)).isZero();
    }

    /** 操作日志分页必须支持管理端全部可选条件、创建时间区间与倒序，并支持跨模块精简条件。 */
    @Test
    void operateLogPageAppliesFiltersForBothRequestTypes() {
        OperateLogDO first = operateLog("USER", "CREATE", 100L, 7L, "新增用户");
        operateLog("USER", "UPDATE", 100L, 8L, "修改用户");
        operateLog("ROLE", "CREATE", 200L, 7L, "新增角色");

        OperateLogPageReqVO identityReq = new OperateLogPageReqVO();
        identityReq.setUserId(7L);
        identityReq.setBizId(100L);
        PageResult<OperateLogDO> identityPage = operateLogMapper.selectPage(identityReq);
        assertThat(identityPage.getTotal()).isEqualTo(1L);
        assertThat(identityPage.getList().get(0).getId()).isEqualTo(first.getId());

        OperateLogPageReqVO textReq = new OperateLogPageReqVO();
        textReq.setType("USER");
        textReq.setSubType("CREATE");
        textReq.setAction("新增");
        assertThat(operateLogMapper.selectPage(textReq).getList()).extracting(OperateLogDO::getAction)
                .containsExactly("新增用户");

        OperateLogPageReqVO recentReq = new OperateLogPageReqVO();
        recentReq.setCreateTime(new LocalDateTime[] {LocalDateTime.now().minusMinutes(5), LocalDateTime.now().plusMinutes(5)});
        assertThat(operateLogMapper.selectPage(recentReq).getTotal()).as("区间内必须命中全部日志").isEqualTo(3L);

        OperateLogPageReqVO pastReq = new OperateLogPageReqVO();
        pastReq.setCreateTime(new LocalDateTime[] {LocalDateTime.now().minusDays(2), LocalDateTime.now().minusDays(1)});
        assertThat(operateLogMapper.selectPage(pastReq).getTotal()).isZero();

        assertThat(operateLogMapper.selectPage(new OperateLogPageReqVO()).getList())
                .as("按编号倒序返回，最新日志在前").extracting(OperateLogDO::getAction)
                .containsExactly("新增角色", "修改用户", "新增用户");

        OperateLogPageReqDTO dtoReq = new OperateLogPageReqDTO();
        dtoReq.setType("USER");
        dtoReq.setBizId(100L);
        dtoReq.setUserId(7L);
        assertThat(operateLogMapper.selectPage(dtoReq).getTotal()).isEqualTo(1L);
        assertThat(operateLogMapper.selectPage(new OperateLogPageReqDTO()).getTotal())
                .as("跨模块分页缺省条件不得过滤").isEqualTo(3L);
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
     * 统计指定表内未被逻辑删除的行数，用于独立观察删除结果。
     *
     * <p>这些 Mapper 的删除是逻辑删除，物理行仍保留；只统计 {@code deleted = 0} 的行，
     * 避免把“已删除但仍留档”的行误判为未删除。</p>
     *
     * @param table 表名
     * @return 未删除行数
     */
    private Integer countActive(String table) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE deleted = 0", Integer.class);
    }

    /**
     * 统计指定表的物理行数，用于确认逻辑删除保留数据。
     *
     * @param table 表名
     * @return 物理行数
     */
    private Integer countAll(String table) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class);
    }

    /**
     * 构造岗位记录并落库。
     *
     * @param code 岗位编码
     * @param name 岗位名称
     * @param sort 显示顺序
     * @param status 状态
     * @return 落库后的岗位记录
     */
    private PostDO post(String code, String name, Integer sort, Integer status) {
        PostDO post = new PostDO();
        post.setCode(code);
        post.setName(name);
        post.setSort(sort);
        post.setStatus(status);
        postMapper.insert(post);
        return post;
    }

    /**
     * 构造角色记录并落库。
     *
     * @param name 角色名称
     * @param code 角色编码
     * @param roleType 平台类型
     * @param sort 显示顺序
     * @param status 状态
     * @param type 角色类型
     * @return 落库后的角色记录
     */
    private RoleDO role(String name, String code, String roleType, Integer sort, Integer status, Integer type) {
        RoleDO role = new RoleDO();
        role.setName(name);
        role.setCode(code);
        role.setRoleType(roleType);
        role.setSort(sort);
        role.setStatus(status);
        role.setType(type);
        roleMapper.insert(role);
        return role;
    }

    /**
     * 构造菜单记录并落库。
     *
     * @param parentId 父菜单编号
     * @param name 菜单名称
     * @param type 菜单类型
     * @param menuType 菜单类型编码
     * @param permission 权限标识，可为 null
     * @param componentName 组件名，可为 null
     * @param status 状态
     * @param sort 显示顺序
     * @return 落库后的菜单记录
     */
    private MenuDO menu(Long parentId, String name, Integer type, String menuType, String permission,
                        String componentName, Integer status, Integer sort) {
        MenuDO menu = new MenuDO();
        menu.setParentId(parentId);
        menu.setName(name);
        menu.setType(type);
        menu.setMenuType(menuType);
        menu.setPermission(permission);
        menu.setComponentName(componentName);
        menu.setStatus(status);
        menu.setSort(sort);
        menuMapper.insert(menu);
        return menu;
    }

    /**
     * 构造角色菜单关联并落库。
     *
     * @param roleId 角色编号
     * @param menuId 菜单编号
     * @return 落库后的关联记录
     */
    private RoleMenuDO roleMenu(Long roleId, Long menuId) {
        RoleMenuDO roleMenu = new RoleMenuDO();
        roleMenu.setRoleId(roleId);
        roleMenu.setMenuId(menuId);
        roleMenuMapper.insert(roleMenu);
        return roleMenu;
    }

    /**
     * 构造用户角色关联并落库。
     *
     * @param userId 用户编号
     * @param roleId 角色编号
     * @return 落库后的关联记录
     */
    private UserRoleDO userRole(Long userId, Long roleId) {
        UserRoleDO userRole = new UserRoleDO();
        userRole.setUserId(userId);
        userRole.setRoleId(roleId);
        userRoleMapper.insert(userRole);
        return userRole;
    }

    /**
     * 构造操作日志并落库。
     *
     * @param type 操作模块
     * @param subType 操作子模块
     * @param bizId 业务编号
     * @param userId 操作人编号
     * @param action 操作动作
     * @return 落库后的日志记录
     */
    private OperateLogDO operateLog(String type, String subType, Long bizId, Long userId, String action) {
        OperateLogDO log = new OperateLogDO();
        log.setType(type);
        log.setSubType(subType);
        log.setBizId(bizId);
        log.setUserId(userId);
        log.setAction(action);
        operateLogMapper.insert(log);
        return log;
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
            throw new IllegalStateException("权限与日志 Mapper 测试初始化失败", failure);
        }
    }

}
