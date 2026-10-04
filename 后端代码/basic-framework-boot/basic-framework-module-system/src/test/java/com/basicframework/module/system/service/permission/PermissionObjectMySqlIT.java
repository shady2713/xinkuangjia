package com.basicframework.module.system.service.permission;

import cn.hutool.extra.spring.SpringUtil;

import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.DataPermissionInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.basicframework.framework.common.biz.system.permission.PermissionCommonApi;
import com.basicframework.framework.common.biz.system.permission.dto.DeptDataPermissionRespDTO;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.datapermission.core.db.DataPermissionRuleHandler;
import com.basicframework.framework.datapermission.core.aop.DataPermissionAnnotationAdvisor;
import com.basicframework.framework.datapermission.core.rule.DataPermissionRuleFactoryImpl;
import com.basicframework.framework.datapermission.core.rule.dept.DeptDataPermissionRule;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.module.system.controller.admin.user.vo.user.UserPageReqVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserSaveReqVO;
import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptSaveReqVO;
import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptListReqVO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.enums.permission.DataScopeEnum;
import com.basicframework.module.system.dal.mysql.dept.DeptMapper;
import com.basicframework.module.system.dal.mysql.dept.UserPostMapper;
import com.basicframework.module.system.dal.mysql.permission.MenuMapper;
import com.basicframework.module.system.dal.mysql.permission.RoleMapper;
import com.basicframework.module.system.dal.mysql.permission.RoleMenuMapper;
import com.basicframework.module.system.dal.mysql.permission.UserRoleMapper;
import com.basicframework.module.system.dal.mysql.user.AdminUserMapper;
import com.basicframework.module.system.service.dept.DeptService;
import com.basicframework.module.system.service.dept.DeptServiceImpl;
import com.basicframework.module.system.service.dept.PostService;
import com.basicframework.module.system.service.user.AdminUserService;
import com.basicframework.module.system.service.user.AdminUserServiceImpl;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.mybatis.spring.mapper.MapperFactoryBean;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.AnnotationConfigUtils;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.EnableAspectJAutoProxy;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.concurrent.ConcurrentMapCacheManager;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.AopTestUtils;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.basicframework.module.system.enums.ErrorCodeConstants.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 使用生产 DDL、Mapper、数据权限拦截器与真实事务验证对象级授权，测试环境缺失时直接失败。 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class PermissionObjectMySqlIT {

    private static final List<String> TABLES = List.of("system_users", "system_dept", "system_user_post",
            "system_role", "system_menu", "system_user_role", "system_role_menu");
    private final String schema = "bf_permission_" + UUID.randomUUID().toString().replace("-", "");
    private String adminUrl;
    private String databaseUser;
    private String databasePassword;
    private boolean schemaCreated;
    private AnnotationConfigApplicationContext context;
    private JdbcTemplate jdbc;
    private AdminUserService users;
    private PermissionService permissions;
    private Object previousSpringBeanFactory;
    private Object previousSpringContext;
    private boolean allDataVisible;

    /** 只向随机测试 schema 导入生产建表语句，不执行种子数据或重建脚本。 */
    @BeforeAll
    void startDatabase() throws Exception {
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
        DataSource dataSource = new DriverManagerDataSource(parts[0] + schema + (parts.length == 2 ? "?" + parts[1] : ""),
                databaseUser, databasePassword);
        jdbc = new JdbcTemplate(dataSource);
        String ddl = Files.readString(schemaSource());
        for (String table : TABLES) {
            Matcher matcher = Pattern.compile("CREATE TABLE `" + table + "`[\\s\\S]*?;").matcher(ddl);
            assertThat(matcher.find()).as("生产表 %s 必须存在", table).isTrue();
            jdbc.execute(matcher.group());
        }
        context = new AnnotationConfigApplicationContext();
        previousSpringBeanFactory = ReflectionTestUtils.getField(SpringUtil.class, "beanFactory");
        previousSpringContext = ReflectionTestUtils.getField(SpringUtil.class, "applicationContext");
        context.registerBean(SpringUtil.class);
        context.register(TransactionConfiguration.class);
        context.removeBeanDefinition(AnnotationConfigUtils.COMMON_ANNOTATION_PROCESSOR_BEAN_NAME);
        context.registerBean(PlatformTransactionManager.class, () -> new DataSourceTransactionManager(dataSource));
        context.registerBean(DataSource.class, () -> dataSource);
        context.registerBean(CacheManager.class, () -> new ConcurrentMapCacheManager());
        context.registerBean(DataPermissionAnnotationAdvisor.class);
        context.registerBean(SqlSessionFactory.class, () -> sqlSessionFactory(dataSource));
        for (Class<?> type : List.of(AdminUserMapper.class, UserPostMapper.class, DeptMapper.class,
                UserRoleMapper.class, RoleMapper.class, MenuMapper.class, RoleMenuMapper.class)) {
            registerMapper(type);
        }
        context.registerBean(DeptService.class, () -> {
            DeptServiceImpl service = wire(new DeptServiceImpl(), "deptMapper", context.getBean(DeptMapper.class));
            return wire(service, "userServiceProvider", context.getBeanProvider(AdminUserService.class));
        });
        context.registerBean(RoleService.class, () -> wire(new RoleServiceImpl(), "roleMapper", context.getBean(RoleMapper.class)));
        context.registerBean(MenuService.class, () -> wire(new MenuServiceImpl(), "menuMapper", context.getBean(MenuMapper.class)));
        context.registerBean(AdminUserService.class, () -> {
            AdminUserServiceImpl service = new AdminUserServiceImpl();
            wire(service, "userMapper", context.getBean(AdminUserMapper.class));
            wire(service, "userPostMapper", context.getBean(UserPostMapper.class));
            wire(service, "deptService", context.getBean(DeptService.class));
            wire(service, "postService", mock(PostService.class));
            return wire(service, "permissionServiceProvider", context.getBeanProvider(PermissionService.class));
        });
        context.registerBean(PermissionService.class, () -> {
            PermissionServiceImpl service = new PermissionServiceImpl();
            wire(service, "userService", context.getBean(AdminUserService.class));
            wire(service, "roleService", context.getBean(RoleService.class));
            wire(service, "menuService", context.getBean(MenuService.class));
            wire(service, "deptService", context.getBean(DeptService.class));
            wire(service, "roleMenuMapper", context.getBean(RoleMenuMapper.class));
            return wire(service, "userRoleMapper", context.getBean(UserRoleMapper.class));
        });
        context.refresh();
        users = context.getBean(AdminUserService.class);
        permissions = context.getBean(PermissionService.class);
    }

    /** 每例创建两个部门、同平台可见/不可见用户和另一平台用户，凭据为随机测试值。 */
    @BeforeEach
    void seedObjects() {
        allDataVisible = false;
        CacheManager cacheManager = context.getBean(CacheManager.class);
        cacheManager.getCacheNames().forEach(name -> cacheManager.getCache(name).clear());
        for (String table : TABLES) {
            jdbc.update("DELETE FROM " + table);
        }
        jdbc.update("INSERT INTO system_dept (id,name,role_type,status) VALUES (10,'本部门','business_admin',0),"
                + "(20,'其他部门','business_admin',0),(30,'另一平台部门','super_admin',0)");
        for (int id : List.of(1, 2, 3, 4)) {
            jdbc.update("INSERT INTO system_users (id,username,password,nickname,dept_id,user_type,status) VALUES (?,?,?,?,?,?,0)",
                    id, "account_" + id, UUID.randomUUID().toString(), "user_" + id, id == 3 ? 20 : 10,
                    id == 4 ? "super_admin" : "business_admin");
        }
        jdbc.update("INSERT INTO system_role (id,name,code,role_type,sort,status,type,data_scope) "
                + "VALUES (1,'业务角色','test_business','business_admin',0,0,2,5),"
                + "(2,'另一平台角色','test_other','super_admin',0,0,2,1)");
        jdbc.update("INSERT INTO system_menu (id,name,permission,menu_type,type,sort,parent_id,path,status) "
                + "VALUES (1,'业务菜单','test:read','business_admin',3,0,0,'',0)");
    }

    /** 不可见用户与真正不存在用户都必须在写角色关系前失败，不能把 null 当作授权通过。 */
    @Test
    void invisibleAndMissingUsersCannotReceiveRoles() {
        asActor(() -> {
            assertThat(users.getUser(3L)).isNull();
            assertBusinessError(() -> permissions.assignUserRole(3L, Set.of(1L)), USER_NOT_EXISTS.getCode());
            assertBusinessError(() -> permissions.assignUserRole(999L, Set.of(1L)), USER_NOT_EXISTS.getCode());
        });
        assertThat(count("system_user_role")).isZero();
    }

    /** 不存在角色或菜单不能被提前写入关联表，防止未来复用编号时产生隐式授权。 */
    @Test
    void missingRoleAndMenuIdsCannotCreateFutureGrants() {
        asActor(() -> {
            assertBusinessError(() -> permissions.assignUserRole(2L, Set.of(1L, 999L)), ROLE_NOT_EXISTS.getCode());
            assertBusinessError(() -> permissions.assignRoleMenu(1L, Set.of(1L, 999L)), MENU_NOT_EXISTS.getCode());
            assertBusinessError(() -> permissions.assignRoleMenu(999L, Set.of(1L)), ROLE_NOT_EXISTS.getCode());
        });
        assertThat(count("system_user_role")).isZero();
        assertThat(count("system_role_menu")).isZero();
    }

    /** 编辑不可见用户必须在任何关联表写入前拒绝，不能只依赖用户 UPDATE 的行范围条件。 */
    @Test
    void invisibleUserUpdateCannotChangePosts() {
        jdbc.update("INSERT INTO system_user_post (user_id,post_id) VALUES (3,100)");
        asActor(() -> assertBusinessError(() -> users.updateUser(updateRequest(3L, 20L), "business_admin"),
                USER_NOT_EXISTS.getCode()));
        assertThat(jdbc.queryForList("SELECT post_id FROM system_user_post WHERE user_id=3 AND deleted=0", Long.class))
                .containsExactly(100L);
        assertThat(jdbc.queryForObject("SELECT nickname FROM system_users WHERE id=3", String.class)).isEqualTo("user_3");
    }

    /** 可见用户也不能被迁入不可见部门；正常的同部门修改仍能完成。 */
    @Test
    void userDepartmentChangeRespectsVisibleDepartments() {
        asActor(() -> {
            assertBusinessError(() -> users.updateUser(updateRequest(2L, 20L), "business_admin"), DEPT_NOT_FOUND.getCode());
            users.updateUser(updateRequest(2L, 10L), "business_admin");
        });
        assertThat(jdbc.queryForObject("SELECT dept_id FROM system_users WHERE id=2", Long.class)).isEqualTo(10L);
        assertThat(jdbc.queryForObject("SELECT nickname FROM system_users WHERE id=2", String.class)).isEqualTo("updated");
    }

    /** 混合批量中有不可见或跨平台对象时整体拒绝，已通过校验的对象也不得提前删除。 */
    @Test
    void mixedBatchDeletionIsAllOrNothing() {
        asActor(() -> {
            assertBusinessError(() -> users.deleteUserList(List.of(2L, 3L), "business_admin"), USER_NOT_EXISTS.getCode());
            assertBusinessError(() -> users.deleteUserList(List.of(2L, 4L), "business_admin"), SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
        });
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM system_users WHERE deleted=0", Integer.class)).isEqualTo(4);
    }

    /** 同平台可见对象正常授予角色与菜单；跨平台对象或角色不得混入请求。 */
    @Test
    void normalGrantsWorkAndCrossPlatformGrantsFail() {
        asActor(() -> {
            permissions.assignUserRole(2L, Set.of(1L));
            permissions.assignRoleMenu(1L, Set.of(1L));
            assertBusinessError(() -> permissions.assignUserRole(4L, Set.of(1L)), SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
            assertBusinessError(() -> permissions.assignUserRole(2L, Set.of(2L)), SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
        });
        assertThat(count("system_user_role")).isEqualTo(1);
        assertThat(count("system_role_menu")).isEqualTo(1);
    }

    /** 页面和导出共用的查询服务必须同时保留部门与平台范围，扩大 pageSize 不扩大授权集合。 */
    @Test
    void pageAndExportQueriesRemainScoped() {
        asActor(() -> {
            UserPageReqVO request = new UserPageReqVO();
            request.setUserType("business_admin");
            request.setPageSize(10000);
            assertThat(users.getUserPage(request).getList()).extracting(AdminUserDO::getId).containsExactly(2L, 1L);
            assertBusinessError(() -> users.getUser(4L, "business_admin"), SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
        });
    }

    /** 历史跨平台角色关联不能将另一平台的 ALL 数据范围带入当前账号。 */
    @Test
    void legacyCrossPlatformRoleDoesNotExpandDataScope() {
        jdbc.update("INSERT INTO system_user_role (user_id,role_id) VALUES (1,2)");
        DeptDataPermissionRespDTO scope = permissions.getDeptDataPermission(1L);
        assertThat(scope.getAll()).isFalse();
        assertThat(scope.getSelf()).isTrue();
        assertThat(scope.getDeptIds()).isEmpty();
    }

    /** 创建部门必须从可信登录平台写入生产表的必填 role_type，不能依赖客户端补字段。 */
    @Test
    void departmentCreationUsesTrustedPlatform() {
        asActor(() -> {
            DeptSaveReqVO request = new DeptSaveReqVO();
            request.setName("new_department");
            request.setSort(0);
            request.setStatus(0);
            Long id = context.getBean(DeptService.class).createDept(request);
            assertThat(jdbc.queryForObject("SELECT role_type FROM system_dept WHERE id=?", String.class, id))
                    .isEqualTo("business_admin");
        });
    }

    /** 即使数据范围为 ALL，列表、详情、修改和混合批量仍受登录平台限制。 */
    @Test
    void departmentQueriesAndMutationsStayInPlatform() {
        asActor(1L, true, () -> {
            DeptService departments = context.getBean(DeptService.class);
            assertThat(departments.getDept(30L)).isNull();
            assertThat(departments.getDeptList(new DeptListReqVO())).extracting(DeptDO::getId)
                    .containsExactlyInAnyOrder(10L, 20L);
            assertThat(departments.getDeptByName("另一平台部门")).isNull();
            DeptSaveReqVO request = departmentRequest();
            request.setId(30L);
            assertBusinessError(() -> departments.updateDept(request), DEPT_NOT_FOUND.getCode());
            assertBusinessError(() -> departments.deleteDeptList(List.of(10L, 30L)), DEPT_NOT_FOUND.getCode());
        });
        assertThat(count("system_dept")).isEqualTo(3);
    }

    /** 父部门和负责人都必须同平台；正常负责人可以保存，禁用用户不能作为新负责人。 */
    @Test
    void departmentParentAndLeaderMustBelongToCurrentPlatform() {
        asActor(1L, true, () -> {
            DeptService departments = context.getBean(DeptService.class);
            DeptSaveReqVO request = departmentRequest();
            request.setParentId(30L);
            assertBusinessError(() -> departments.createDept(request), DEPT_PARENT_NOT_EXITS.getCode());
            request.setParentId(10L);
            request.setLeaderUserId(4L);
            assertBusinessError(() -> departments.createDept(request), SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
            jdbc.update("UPDATE system_users SET status=1 WHERE id=2");
            request.setLeaderUserId(2L);
            assertBusinessError(() -> departments.createDept(request), USER_IS_DISABLE.getCode());
            request.setLeaderUserId(3L);
            Long id = departments.createDept(request);
            assertThat(jdbc.queryForObject("SELECT leader_user_id FROM system_dept WHERE id=?", Long.class, id)).isEqualTo(3L);
            assertThat(departments.getDept(id).getRoleType()).isEqualTo("business_admin");
        });
    }

    /** 缓存内容由根部门的平台决定，另一平台先访问内部计算入口也不能污染后续结果。 */
    @Test
    void departmentTreeCacheIsAnchoredToRootPlatform() {
        jdbc.update("INSERT INTO system_dept (id,name,parent_id,role_type,status) VALUES "
                + "(11,'同平台子部门',10,'business_admin',0),(12,'历史跨平台子部门',10,'super_admin',0)");
        DeptService departments = context.getBean(DeptService.class);
        asActor(4L, false, () -> assertThat(departments.getChildDeptIdListFromCache(10L)).containsExactly(11L));
        asActor(1L, true, () -> {
            assertThat(departments.getChildDeptIdListFromCache(10L)).containsExactly(11L);
            assertThat(departments.getChildDeptList(10L)).extracting(DeptDO::getId).containsExactly(11L);
        });
    }

    /** 批量补齐角色名必须过滤空编号、跨平台角色与已删除角色，并对重复名称去重。 */
    @Test
    void userRoleNamesCoverOnlyCurrentPlatformRoles() {
        jdbc.update("INSERT INTO system_user_role (user_id,role_id) VALUES (1,1),(1,1),(1,2),(1,999)");

        Map<Long, List<String>> names = permissions.getUserRoleNames(Arrays.asList(1L, null, 1L), "business_admin");

        assertThat(names).containsOnlyKeys(1L);
        assertThat(names.get(1L)).as("重复关联、跨平台角色与已删除角色都必须被过滤").containsExactly("业务角色");
        assertThat(permissions.getUserRoleNames(List.of(), "business_admin")).isEmpty();
        assertThat(permissions.getUserRoleNames(null, "business_admin")).isEmpty();
        assertThat(permissions.getUserRoleNames(List.of(3L), "business_admin"))
                .as("没有任何角色关联时必须返回空映射").isEmpty();
    }

    /** 空权限数组表示无需校验即通过；没有角色的用户必须拒绝。 */
    @Test
    void hasAnyPermissionsShortCircuitsEmptyArrayAndRolelessUser() {
        assertThat(permissions.hasAnyPermissions(1L)).isTrue();
        assertThat(permissions.hasAnyPermissions(3L, "test:read")).isFalse();
    }

    /**
     * 权限必须同时命中同平台菜单与角色授权；未授权菜单、缺失菜单或跨平台菜单都必须拒绝。
     *
     * <p>菜单到角色的反查带缓存，因此每个权限标识只在其最终数据状态下查询一次，
     * 避免用缓存结果冒充权限判断。</p>
     */
    @Test
    void hasAnyPermissionsRequiresSamePlatformMenuAndRoleGrant() {
        jdbc.update("INSERT INTO system_user_role (user_id,role_id) VALUES (1,1)");
        jdbc.update("INSERT INTO system_role_menu (role_id,menu_id) VALUES (1,1)");
        jdbc.update("INSERT INTO system_menu (id,name,permission,menu_type,type,sort,parent_id,path,status) VALUES "
                + "(2,'未授权菜单','test:ungranted','business_admin',3,0,0,'',0),"
                + "(3,'另一平台菜单','test:other','super_admin',3,0,0,'',0)");

        assertThat(permissions.hasAnyPermissions(1L, "test:read")).as("同平台菜单且已授权给角色时必须通过").isTrue();
        assertThat(permissions.hasAnyPermissions(1L, "test:ungranted"))
                .as("菜单存在但未授权给任何角色时必须拒绝").isFalse();
        assertThat(permissions.hasAnyPermissions(1L, "test:missing")).as("权限没有对应菜单时必须拒绝").isFalse();
        assertThat(permissions.hasAnyPermissions(1L, "test:other")).as("跨平台菜单不得授予当前平台权限").isFalse();
    }

    /** 内置超管只在当前平台存在对应菜单时才通过，跨平台菜单不放大权限。 */
    @Test
    void superAdminPermissionStaysInCurrentPlatform() {
        seedSuperAdminRole();
        jdbc.update("INSERT INTO system_user_role (user_id,role_id) VALUES (1,3)");

        assertThat(permissions.hasAnyPermissions(1L, "test:read")).as("超管也必须有当前平台菜单").isTrue();
        assertThat(permissions.hasAnyPermissions(1L, "test:missing")).isFalse();

        jdbc.update("INSERT INTO system_menu (id,name,permission,menu_type,type,sort,parent_id,path,status) "
                + "VALUES (2,'另一平台菜单','test:other','super_admin',3,0,0,'',0)");
        assertThat(permissions.hasAnyPermissions(1L, "test:other")).as("超管不得跨平台通过").isFalse();
    }

    /** 角色标识判断只在当前平台内生效，跨平台角色不得匹配。 */
    @Test
    void hasAnyRolesMatchesOnlyCurrentPlatformRoleCodes() {
        jdbc.update("INSERT INTO system_user_role (user_id,role_id) VALUES (1,1),(4,2)");

        assertThat(permissions.hasAnyRoles(1L)).isTrue();
        assertThat(permissions.hasAnyRoles(3L, "test_business")).as("无角色用户必须拒绝").isFalse();
        assertThat(permissions.hasAnyRoles(1L, "test_business")).isTrue();
        assertThat(permissions.hasAnyRoles(1L, "test_other")).as("跨平台角色不得匹配").isFalse();
        assertThat(permissions.hasAnyRoles(4L, "test_other")).as("另一平台用户在自己的平台内可以匹配").isTrue();
    }

    /** 角色菜单授权必须只做差量写入，取消授权时删除多余关联。 */
    @Test
    void assignRoleMenuAddsAndRemovesDifferences() {
        asActor(() -> {
            permissions.assignRoleMenu(1L, Set.of(1L));
            assertThat(roleMenuIds(1L)).containsExactly(1L);

            permissions.assignRoleMenu(1L, Set.of());
            assertThat(roleMenuIds(1L)).as("取消授权必须删除关联").isEmpty();

            permissions.assignRoleMenu(1L, Set.of());
            assertThat(roleMenuIds(1L)).isEmpty();
        });
    }

    /** 角色只能绑定同平台菜单，跨平台菜单必须拒绝且不落库。 */
    @Test
    void assignRoleMenuRejectsCrossPlatformMenu() {
        jdbc.update("INSERT INTO system_menu (id,name,permission,menu_type,type,sort,parent_id,path,status) "
                + "VALUES (2,'另一平台菜单','test:other','super_admin',3,0,0,'',0)");

        asActor(() -> assertBusinessError(() -> permissions.assignRoleMenu(1L, Set.of(2L)),
                SYSTEM_PLATFORM_ACCESS_DENIED.getCode()));

        assertThat(roleMenuIds(1L)).isEmpty();
    }

    /** 删除角色必须同时清空用户角色与角色菜单关联。 */
    @Test
    void processRoleDeletedClearsBothRelations() {
        jdbc.update("INSERT INTO system_user_role (user_id,role_id) VALUES (1,1)");
        jdbc.update("INSERT INTO system_role_menu (role_id,menu_id) VALUES (1,1)");

        permissions.processRoleDeleted(1L);

        assertThat(count("system_user_role")).isZero();
        assertThat(count("system_role_menu")).isZero();
    }

    /** 删除菜单必须清空角色菜单关联。 */
    @Test
    void processMenuDeletedClearsRoleMenuRelations() {
        jdbc.update("INSERT INTO system_role_menu (role_id,menu_id) VALUES (1,1)");

        permissions.processMenuDeleted(1L);

        assertThat(count("system_role_menu")).isZero();
    }

    /** 角色菜单查询必须区分空输入、超管返回全部菜单与普通角色返回已授权菜单。 */
    @Test
    void roleMenuListByRoleIdDistinguishesSuperAdmin() {
        seedSuperAdminRole();
        jdbc.update("INSERT INTO system_role_menu (role_id,menu_id) VALUES (1,1)");

        assertThat(permissions.getRoleMenuListByRoleId(List.of())).isEmpty();
        assertThat(permissions.getRoleMenuListByRoleId(List.of(1L))).containsExactly(1L);
        assertThat(permissions.getRoleMenuListByRoleId(List.of(3L))).as("超管角色返回全部菜单").containsExactly(1L);
    }

    /** 菜单到角色的反查必须按菜单编号返回真实授权角色。 */
    @Test
    void menuRoleIdsAreResolvedByMenuId() {
        jdbc.update("INSERT INTO system_role_menu (role_id,menu_id) VALUES (1,1)");

        assertThat(permissions.getMenuRoleIdListByMenuIdFromCache(1L)).containsExactly(1L);
        assertThat(permissions.getMenuRoleIdListByMenuIdFromCache(999L)).isEmpty();
    }

    /** 用户角色授权必须只做差量写入，取消授权时删除多余关联。 */
    @Test
    void assignUserRoleAddsAndRemovesDifferences() {
        asActor(() -> {
            permissions.assignUserRole(2L, Set.of(1L));
            assertThat(userRoleIds(2L)).containsExactly(1L);

            permissions.assignUserRole(2L, Set.of());
            assertThat(userRoleIds(2L)).as("取消授权必须删除关联").isEmpty();
        });
    }

    /** 停用角色不得授予给用户，必须在写入关联前拒绝。 */
    @Test
    void assignUserRoleRejectsDisabledRole() {
        jdbc.update("INSERT INTO system_role (id,name,code,role_type,sort,status,type,data_scope) "
                + "VALUES (4,'停用角色','test_disabled','business_admin',0,1,2,1)");

        asActor(() -> assertThatThrownBy(() -> permissions.assignUserRole(2L, Set.of(4L)))
                .isInstanceOfSatisfying(ServiceException.class, exception -> {
                    assertThat(exception.getCode()).isEqualTo(ROLE_IS_DISABLE.getCode());
                    assertThat(exception.getMessage()).contains("停用角色");
                }));

        assertThat(userRoleIds(2L)).isEmpty();
    }

    /** 用户被删除时必须清空用户角色关联。 */
    @Test
    void processUserDeletedClearsUserRoleRelations() {
        jdbc.update("INSERT INTO system_user_role (user_id,role_id) VALUES (2,1)");

        permissions.processUserDeleted(2L);

        assertThat(count("system_user_role")).isZero();
    }

    /** 用户角色查询必须覆盖按用户、按角色与启用状态过滤三种入口。 */
    @Test
    void userRoleQueriesCoverUserRoleAndStatusFilters() {
        jdbc.update("INSERT INTO system_user_role (user_id,role_id) VALUES (1,1),(2,1)");

        assertThat(permissions.getUserRoleIdListByUserId(1L)).containsExactly(1L);
        assertThat(permissions.getUserRoleIdListByUserIdFromCache(2L)).containsExactly(1L);
        assertThat(permissions.getUserRoleIdListByRoleId(List.of(1L))).containsExactlyInAnyOrder(1L, 2L);
        assertThat(effectiveRoles(1L)).extracting(RoleDO::getId).containsExactly(1L);
    }

    /** 停用角色不得进入有效角色集合。 */
    @Test
    void disabledRoleIsExcludedFromEffectiveRoles() {
        jdbc.update("UPDATE system_role SET status=1 WHERE id=1");
        jdbc.update("INSERT INTO system_user_role (user_id,role_id) VALUES (1,1)");

        assertThat(effectiveRoles(1L)).isEmpty();
    }

    /** 数据范围授权必须校验角色存在与平台归属，合法调用必须落库。 */
    @Test
    void assignRoleDataScopeValidatesPlatformAndPersists() {
        asActor(() -> {
            permissions.assignRoleDataScope(1L, DataScopeEnum.DEPT_ONLY.getScope(), Set.of(20L));
            assertBusinessError(() -> permissions.assignRoleDataScope(999L, DataScopeEnum.ALL.getScope(), Set.of()),
                    ROLE_NOT_EXISTS.getCode());
            assertBusinessError(() -> permissions.assignRoleDataScope(2L, DataScopeEnum.ALL.getScope(), Set.of()),
                    SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
        });

        assertThat(jdbc.queryForObject("SELECT data_scope FROM system_role WHERE id=1", Integer.class))
                .isEqualTo(DataScopeEnum.DEPT_ONLY.getScope());
        assertThat(jdbc.queryForObject("SELECT data_scope_dept_ids FROM system_role WHERE id=1", String.class))
                .contains("20");
    }

    /** 任一角色为全部数据权限时必须放开全部数据。 */
    @Test
    void deptDataPermissionGrantsAllForAllScopeRole() {
        seedRole(3L, "scope_all", DataScopeEnum.ALL.getScope(), "");
        jdbc.update("INSERT INTO system_user_role (user_id,role_id) VALUES (1,3)");

        assertThat(permissions.getDeptDataPermission(1L).getAll()).isTrue();
    }

    /** 自定义部门范围必须同时包含指定部门与用户自身部门。 */
    @Test
    void deptDataPermissionAddsCustomAndOwnDepartment() {
        seedRole(3L, "scope_custom", DataScopeEnum.DEPT_CUSTOM.getScope(), "[20]");
        jdbc.update("INSERT INTO system_user_role (user_id,role_id) VALUES (1,3)");

        assertThat(permissions.getDeptDataPermission(1L).getDeptIds()).containsExactlyInAnyOrder(20L, 10L);
    }

    /** 仅本部门范围只能包含用户自身部门。 */
    @Test
    void deptDataPermissionUsesOwnDepartmentOnly() {
        seedRole(3L, "scope_only", DataScopeEnum.DEPT_ONLY.getScope(), "");
        jdbc.update("INSERT INTO system_user_role (user_id,role_id) VALUES (1,3)");

        assertThat(permissions.getDeptDataPermission(1L).getDeptIds()).containsExactly(10L);
    }

    /** 本部门及以下范围必须包含子部门与自身部门。 */
    @Test
    void deptDataPermissionIncludesChildDepartments() {
        seedRole(3L, "scope_child", DataScopeEnum.DEPT_AND_CHILD.getScope(), "");
        jdbc.update("INSERT INTO system_user_role (user_id,role_id) VALUES (1,3)");
        jdbc.update("INSERT INTO system_dept (id,name,parent_id,role_type,status) "
                + "VALUES (11,'子部门',10,'business_admin',0)");

        assertThat(permissions.getDeptDataPermission(1L).getDeptIds()).containsExactlyInAnyOrder(10L, 11L);
    }

    /** 仅本人范围必须只标记本人可见，不写入任何部门。 */
    @Test
    void deptDataPermissionMarksSelfOnly() {
        seedRole(3L, "scope_self", DataScopeEnum.SELF.getScope(), "");
        jdbc.update("INSERT INTO system_user_role (user_id,role_id) VALUES (1,3)");

        DeptDataPermissionRespDTO scope = permissions.getDeptDataPermission(1L);

        assertThat(scope.getSelf()).isTrue();
        assertThat(scope.getDeptIds()).isEmpty();
    }

    /** 未知数据范围不得放大权限，也不能中断其它角色的处理。 */
    @Test
    void deptDataPermissionIgnoresUnknownScope() {
        seedRole(3L, "scope_unknown", 99, "");
        jdbc.update("INSERT INTO system_user_role (user_id,role_id) VALUES (1,3)");

        DeptDataPermissionRespDTO scope = permissions.getDeptDataPermission(1L);

        assertThat(scope.getAll()).isFalse();
        assertThat(scope.getSelf()).isFalse();
        assertThat(scope.getDeptIds()).isEmpty();
    }

    /**
     * 读取用户的有效角色（已过滤停用与跨平台角色）。
     *
     * <p>该入口在实现类上标注为测试可见、未暴露到接口，因此从代理对象取出目标实现后调用；
     * 内部仍通过容器代理访问缓存入口，缓存语义不变。</p>
     *
     * @param userId 用户编号
     * @return 有效角色列表
     */
    @SuppressWarnings("unchecked")
    private List<RoleDO> effectiveRoles(Long userId) {
        PermissionServiceImpl target = (PermissionServiceImpl) AopTestUtils.getTargetObject(permissions);
        return target.getEnableUserRoleListByUserIdFromCache(userId);
    }

    /**
     * 写入一个当前业务平台的内置超管角色。
     *
     * <p>超管判定只看角色编码，因此用例必须用真实编码而不是自造名称。</p>
     */
    private void seedSuperAdminRole() {
        jdbc.update("INSERT INTO system_role (id,name,code,role_type,sort,status,type,data_scope) "
                + "VALUES (3,'内置超管','super_admin','business_admin',0,0,2,1)");
    }

    /**
     * 写入一个当前业务平台的角色，用于验证数据范围分支。
     *
     * @param id 角色编号
     * @param code 角色编码，必须全库唯一
     * @param dataScope 数据范围编码
     * @param dataScopeDeptIds 自定义部门编号文本，多个用逗号分隔
     */
    private void seedRole(Long id, String code, Integer dataScope, String dataScopeDeptIds) {
        jdbc.update("INSERT INTO system_role (id,name,code,role_type,sort,status,type,data_scope,data_scope_dept_ids) "
                + "VALUES (?,?,?,'business_admin',0,0,2,?,?)", id, code, code, dataScope, dataScopeDeptIds);
    }

    /**
     * 查询角色的有效菜单编号。
     *
     * @param roleId 角色编号
     * @return 菜单编号列表
     */
    private List<Long> roleMenuIds(Long roleId) {
        return jdbc.queryForList("SELECT menu_id FROM system_role_menu WHERE role_id = ? AND deleted = 0",
                Long.class, roleId);
    }

    /**
     * 查询用户的有效角色编号。
     *
     * @param userId 用户编号
     * @return 角色编号列表
     */
    private List<Long> userRoleIds(Long userId) {
        return jdbc.queryForList("SELECT role_id FROM system_user_role WHERE user_id = ? AND deleted = 0",
                Long.class, userId);
    }

    /** 构造不带平台字段的部门请求，平台只能由服务端决定。 */
    private DeptSaveReqVO departmentRequest() {
        DeptSaveReqVO request = new DeptSaveReqVO();
        request.setName("created_department");
        request.setSort(0);
        request.setStatus(0);
        return request;
    }

    /** 恢复调用线程原有安全上下文；该账号具有部门 10 数据范围，业务函数权限由外层 Controller 管理。 */
    private void asActor(Runnable action) {
        asActor(1L, false, action);
    }

    /** 按账号和指定数据范围进入真实数据权限链，结束后恢复线程与测试授权状态。 */
    private void asActor(Long actorId, boolean allowAll, Runnable action) {
        SecurityContext original = SecurityContextHolder.getContext();
        boolean previousVisible = allDataVisible;
        try {
            allDataVisible = allowAll;
            SecurityContext security = SecurityContextHolder.createEmptyContext();
            LoginUser login = new LoginUser().setId(actorId).setUserType(UserTypeEnum.ADMIN.getValue());
            security.setAuthentication(new UsernamePasswordAuthenticationToken(login, null, List.of()));
            SecurityContextHolder.setContext(security);
            action.run();
        } finally {
            allDataVisible = previousVisible;
            SecurityContextHolder.setContext(original);
        }
    }

    /** 构造用户编辑契约，岗位集合保持空以检验越权时是否发生关系删除。 */
    private UserSaveReqVO updateRequest(Long id, Long deptId) {
        UserSaveReqVO request = new UserSaveReqVO();
        request.setId(id);
        request.setUsername("account_" + id);
        request.setNickname("updated");
        request.setDeptId(deptId);
        request.setPostIds(Set.of());
        return request;
    }

    /** 只接受预期业务拒绝，SQL 异常或装配异常不能冒充安全边界通过。 */
    private void assertBusinessError(Runnable action, int errorCode) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(ServiceException.class,
                exception -> assertThat(exception.getCode()).isEqualTo(errorCode));
    }

    /** 对本测试固定表名计数，检查真实持久化副作用。 */
    private int count(String table) {
        assertThat(TABLES).contains(table);
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE deleted=0", Integer.class);
    }

    /** 装配生产数据权限规则与分页插件；权限接口只提供既定角色计算结果，SQL 处理保持真实。 */
    private SqlSessionFactory sqlSessionFactory(DataSource dataSource) {
        try {
            PermissionCommonApi api = mock(PermissionCommonApi.class);
            when(api.getDeptDataPermission(any())).thenAnswer(invocation -> {
                DeptDataPermissionRespDTO result = new DeptDataPermissionRespDTO();
                result.setAll(allDataVisible);
                result.setDeptIds(Set.of(10L));
                return result;
            });
            DeptDataPermissionRule rule = new DeptDataPermissionRule(api);
            rule.addDeptColumn("system_users", "dept_id");
            rule.addUserColumn("system_users", "id");
            rule.addDeptColumn("system_dept", "id");
            MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
            interceptor.addInnerInterceptor(new DataPermissionInterceptor(
                    new DataPermissionRuleHandler(new DataPermissionRuleFactoryImpl(List.of(rule)))));
            interceptor.addInnerInterceptor(new PaginationInnerInterceptor(DbType.MYSQL));
            MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
            factory.setDataSource(dataSource);
            MybatisConfiguration configuration = new MybatisConfiguration();
            configuration.setMapUnderscoreToCamelCase(true);
            factory.setConfiguration(configuration);
            GlobalConfig global = new GlobalConfig();
            global.setDbConfig(new GlobalConfig.DbConfig().setIdType(IdType.AUTO));
            global.setMetaObjectHandler(new DefaultDBFieldHandler());
            factory.setGlobalConfig(global);
            factory.setPlugins(interceptor);
            return factory.getObject();
        } catch (Exception exception) {
            throw new IllegalStateException("测试 Mapper 装配失败", exception);
        }
    }

    /** 为每个生产 Mapper 建立真实代理，不扫描无关业务依赖。 */
    private <T> void registerMapper(Class<T> type) {
        context.registerBean(type, () -> {
            try {
                MapperFactoryBean<T> mapper = new MapperFactoryBean<>(type);
                mapper.setSqlSessionFactory(context.getBean(SqlSessionFactory.class));
                mapper.afterPropertiesSet();
                return mapper.getObject();
            } catch (Exception exception) {
                throw new IllegalStateException("测试 Mapper 创建失败", exception);
            }
        });
    }

    /** 显式注入本测试所需依赖，由 Spring 为生产方法建立实际事务代理。 */
    private static <T> T wire(T target, String field, Object value) {
        ReflectionTestUtils.setField(target, field, value);
        return target;
    }

    /** 测试环境必须显式提供，不跳过安全集成测试。 */
    private String requiredEnvironment(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("缺少测试环境变量 " + key);
        }
        return value;
    }

    /** 定位当前工作区生产 DDL，不维护脱节的测试表结构。 */
    private Path schemaSource() {
        for (Path path = Path.of("").toAbsolutePath(); path != null; path = path.getParent()) {
            Path candidate = path.resolve("数据库文件/basic_framework.sql");
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("未找到生产 DDL");
    }

    /** 只删除本测试创建的随机 schema，并关闭所属 Spring 上下文。 */
    @AfterAll
    void closeDatabase() throws Exception {
        if (context != null) {
            context.close();
            ReflectionTestUtils.setField(SpringUtil.class, "beanFactory", previousSpringBeanFactory);
            ReflectionTestUtils.setField(SpringUtil.class, "applicationContext", previousSpringContext);
        }
        if (schemaCreated) {
            try (Connection connection = DriverManager.getConnection(adminUrl, databaseUser, databasePassword);
                 Statement statement = connection.createStatement()) {
                statement.execute("DROP DATABASE `" + schema + "`");
            }
        }
    }

    /** 开启生产服务的事务边界，异常必须回滚真实 MySQL。 */
    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement(proxyTargetClass = true)
    @EnableCaching(proxyTargetClass = true)
    @EnableAspectJAutoProxy(proxyTargetClass = true)
    static class TransactionConfiguration {
    }
}
