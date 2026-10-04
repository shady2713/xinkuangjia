package com.basicframework.framework.datapermission.core.rule.dept;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.framework.common.biz.system.permission.PermissionCommonApi;
import com.basicframework.framework.common.biz.system.permission.dto.DeptDataPermissionRespDTO;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.mybatis.core.dataobject.BaseDO;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import net.sf.jsqlparser.expression.Alias;
import net.sf.jsqlparser.expression.Expression;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证部门数据权限规则的字段登记入口：默认列名、自定义列名与规则适用范围。
 *
 * <p>这些入口是框架使用方把“哪张表按哪个字段做数据权限”告诉规则的唯一方式。登记错误不会报错，
 * 只会让数据权限条件落到不存在的列（SQL 报错）或落到错误的列（越权或漏数据）。用例用真实
 * MyBatis Plus 表信息登记与真实表达式构建观察结果：默认列名必须是 {@code dept_id}/{@code user_id}，
 * 自定义列名必须覆盖默认值，且登记后的表名必须出现在规则声明的适用范围里。</p>
 *
 * <p>表达式构建依赖登录用户与权限接口，这里使用受控替身提供“指定部门 + 可查看自己”的权限，
 * 断言生成的条件确实引用被登记的列。</p>
 *
 * @author shady2713
 */
class DeptDataPermissionRuleFieldRegistrationTest {

    /** 测试实体对应的表名，用于观察规则声明的适用范围。 */
    private static final String TABLE_NAME = "test_dept_permission_entity";

    /** 触发静态表信息登记的实体类型。 */
    @BeforeAll
    static void registerTableInfo() {
        MybatisConfiguration configuration = new MybatisConfiguration();
        MapperBuilderAssistant assistant = new MapperBuilderAssistant(configuration, "");
        assistant.setCurrentNamespace(DeptDataPermissionRuleFieldRegistrationTest.class.getName());
        TableInfoHelper.initTableInfo(assistant, DeptPermissionEntity.class);
    }

    /** 清理安全上下文，避免登录用户跨用例残留。 */
    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    /** 默认部门列登记为 dept_id，且表名进入规则适用范围。 */
    @Test
    void addDeptColumnUsesDefaultColumnAndRegistersTableName() {
        DeptDataPermissionRule rule = rule(deptIds(10L, 20L), false);
        loginUser(7L);

        rule.addDeptColumn(DeptPermissionEntity.class);

        assertThat(rule.getTableNames()).as("登记后的表必须出现在规则适用范围中").contains(TABLE_NAME);
        assertThat(expressionText(rule)).contains("t.dept_id IN (10, 20)");
    }

    /** 自定义部门列必须覆盖默认列名。 */
    @Test
    void addDeptColumnWithCustomNameOverridesDefault() {
        DeptDataPermissionRule rule = rule(deptIds(10L), false);
        loginUser(7L);

        rule.addDeptColumn(DeptPermissionEntity.class, "custom_dept_id");

        assertThat(expressionText(rule)).contains("t.custom_dept_id IN (10)");
    }

    /** 默认用户列登记为 user_id，可查看自己时按登录用户编号过滤。 */
    @Test
    void addUserColumnUsesDefaultColumnAndLoginUserId() {
        DeptDataPermissionRule rule = rule(deptIds(), true);
        loginUser(7L);

        rule.addUserColumn(DeptPermissionEntity.class);

        assertThat(rule.getTableNames()).contains(TABLE_NAME);
        assertThat(expressionText(rule)).contains("t.user_id = 7");
    }

    /** 自定义用户列必须覆盖默认列名。 */
    @Test
    void addUserColumnWithCustomNameOverridesDefault() {
        DeptDataPermissionRule rule = rule(deptIds(), true);
        loginUser(7L);

        rule.addUserColumn(DeptPermissionEntity.class, "custom_user_id");

        assertThat(expressionText(rule)).contains("t.custom_user_id = 7");
    }

    /** 登记了部门列但当前用户没有可见部门时不生成部门条件，避免出现非法的空 IN。 */
    @Test
    void emptyDeptIdsSkipDeptConditionEvenWhenColumnRegistered() {
        DeptDataPermissionRule rule = rule(deptIds(), true);
        loginUser(7L);
        rule.addDeptColumn(DeptPermissionEntity.class);
        rule.addUserColumn(DeptPermissionEntity.class);

        String text = expressionText(rule);

        assertThat(text).as("没有可见部门时不得生成部门条件").doesNotContain("dept_id IN");
        assertThat(text).contains("t.user_id = 7");
    }

    /** 只登记部门列时，即使允许查看自己也不生成用户条件。 */
    @Test
    void missingUserColumnSkipsUserConditionEvenWhenSelfAllowed() {
        DeptDataPermissionRule rule = rule(deptIds(10L), true);
        loginUser(7L);
        rule.addDeptColumn(DeptPermissionEntity.class);

        String text = expressionText(rule);

        assertThat(text).contains("t.dept_id IN (10)");
        assertThat(text).as("未登记用户列时不得生成用户条件").doesNotContain("user_id");
    }

    /** 部门与用户条件同时存在时按 OR 组合，两个登记列都要出现在条件里。 */
    @Test
    void deptAndUserColumnsCombineWithOr() {
        DeptDataPermissionRule rule = rule(deptIds(10L, 20L), true);
        loginUser(7L);
        rule.addDeptColumn(DeptPermissionEntity.class);
        rule.addUserColumn(DeptPermissionEntity.class);

        String text = expressionText(rule);

        assertThat(text).contains("t.dept_id IN (10, 20)").contains("OR").contains("t.user_id = 7");
    }

    /**
     * 构造被测规则。
     *
     * @param deptIds 可见部门编号
     * @param self 是否可查看自己
     * @return 部门数据权限规则
     */
    private static DeptDataPermissionRule rule(Set<Long> deptIds, boolean self) {
        return new DeptDataPermissionRule(new FixedPermissionApi(deptIds, self));
    }

    /**
     * 构造可见部门编号集合。
     *
     * @param ids 部门编号
     * @return 部门编号集合，保持入参顺序
     */
    private static Set<Long> deptIds(Long... ids) {
        return new LinkedHashSet<>(List.of(ids));
    }

    /** 只提供部门数据权限的接口替身，其余权限判断不参与本用例。 */
    private static class FixedPermissionApi implements PermissionCommonApi {

        /** 可见部门编号。 */
        private final Set<Long> deptIds;
        /** 是否可查看自己。 */
        private final boolean self;

        /**
         * 构造固定权限的接口替身。
         *
         * @param deptIds 可见部门编号
         * @param self 是否可查看自己
         */
        FixedPermissionApi(Set<Long> deptIds, boolean self) {
            this.deptIds = deptIds;
            this.self = self;
        }

        /**
         * 本替身不参与权限字符串判断。
         *
         * @param userId 用户编号
         * @param permissions 权限标识
         * @return 始终为 false
         */
        @Override
        public boolean hasAnyPermissions(Long userId, String... permissions) {
            return false;
        }

        /**
         * 本替身不参与角色判断。
         *
         * @param userId 用户编号
         * @param roles 角色编码
         * @return 始终为 false
         */
        @Override
        public boolean hasAnyRoles(Long userId, String... roles) {
            return false;
        }

        /**
         * 返回固定的部门数据权限。
         *
         * @param userId 用户编号
         * @return 部门数据权限
         */
        @Override
        public DeptDataPermissionRespDTO getDeptDataPermission(Long userId) {
            DeptDataPermissionRespDTO permission = new DeptDataPermissionRespDTO();
            permission.setAll(false);
            permission.setDeptIds(deptIds);
            permission.setSelf(self);
            return permission;
        }
    }

    /**
     * 在安全上下文中登记管理员登录用户。
     *
     * @param userId 用户编号
     */
    private static void loginUser(Long userId) {
        SecurityFrameworkUtils.setLoginUser(
                new LoginUser().setId(userId).setUserType(UserTypeEnum.ADMIN.getValue()),
                new MockHttpServletRequest());
    }

    /**
     * 构建并返回被测表的数据权限条件文本。
     *
     * @param rule 数据权限规则
     * @return 条件文本
     */
    private static String expressionText(DeptDataPermissionRule rule) {
        Expression expression = rule.getExpression(TABLE_NAME, new Alias("t"));
        assertThat(expression).as("存在可见范围时必须生成过滤条件").isNotNull();
        return expression.toString();
    }

    /** 测试实体，用于真实登记 MyBatis Plus 表信息。 */
    @TableName(TABLE_NAME)
    private static class DeptPermissionEntity extends BaseDO {

        /** 部门编号字段，仅用于表信息登记。 */
        private Long deptId;
    }

}
