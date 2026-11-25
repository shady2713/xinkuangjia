package com.basicframework.framework.datapermission.core.rule.dept;

import com.basicframework.framework.common.biz.system.permission.PermissionCommonApi;
import com.basicframework.framework.common.biz.system.permission.dto.DeptDataPermissionRespDTO;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.security.core.LoginUser;
import net.sf.jsqlparser.expression.Alias;
import net.sf.jsqlparser.expression.Expression;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Collections;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证 {@link DeptDataPermissionRule} 在全部权限、指定部门、仅本人及无权限四种边界下的 SQL 条件生成。
 *
 * @author shady
 */
class DeptDataPermissionRuleTest {

    /**
     * 清理每次用例写入的登录上下文。
     */
    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    /**
     * 验证拥有全部数据权限的管理员不追加额外过滤条件，并缓存数据权限到 {@link LoginUser} 上下文。
     */
    @Test
    void returnsNullWhenUserHasAllDataScopeAndCachesPermission() {
        PermissionCommonApi permissionApi = mock(PermissionCommonApi.class);
        DeptDataPermissionRespDTO dto = new DeptDataPermissionRespDTO();
        dto.setAll(true);
        when(permissionApi.getDeptDataPermission(1L)).thenReturn(dto);

        DeptDataPermissionRule rule = buildRule(permissionApi);
        bindAdminLoginUser(1L);

        assertThat(rule.getExpression("system_users", new Alias("u"))).isNull();
        assertThat(rule.getExpression("system_users", new Alias("u"))).isNull();
        verify(permissionApi, times(1)).getDeptDataPermission(1L);
    }

    /**
     * 验证同时配置部门集合与本人可见时生成括号包裹的 {@code dept_id IN (...) OR id = userId} 组合条件。
     */
    @Test
    void buildsCombinedDeptAndSelfExpression() {
        PermissionCommonApi permissionApi = mock(PermissionCommonApi.class);
        DeptDataPermissionRespDTO dto = new DeptDataPermissionRespDTO();
        dto.setAll(false);
        dto.setDeptIds(Set.of(100L, 101L));
        dto.setSelf(true);
        when(permissionApi.getDeptDataPermission(88L)).thenReturn(dto);

        DeptDataPermissionRule rule = buildRule(permissionApi);
        bindAdminLoginUser(88L);

        Expression expression = rule.getExpression("system_users", new Alias("u"));

        assertThat(expression).isNotNull();
        String sql = expression.toString();
        assertThat(sql).contains("u.dept_id IN").contains("OR u.id = 88");
    }

    /**
     * 验证既无可见部门也无本人权限时回退为 {@code null = null}，确保查询结果恒为空集。
     */
    @Test
    void returnsEmptyGuardExpressionWhenNeitherDeptNorSelfIsAllowed() {
        PermissionCommonApi permissionApi = mock(PermissionCommonApi.class);
        DeptDataPermissionRespDTO dto = new DeptDataPermissionRespDTO();
        dto.setAll(false);
        dto.setDeptIds(Collections.emptySet());
        dto.setSelf(false);
        when(permissionApi.getDeptDataPermission(99L)).thenReturn(dto);

        DeptDataPermissionRule rule = buildRule(permissionApi);
        bindAdminLoginUser(99L);

        Expression expression = rule.getExpression("system_users", new Alias("u"));

        assertThat(expression).isNotNull();
        assertThat(expression.toString().toLowerCase()).isEqualTo("null = null");
    }

    /**
     * 构造注册了 {@code system_users} 部门与用户列的规则实例。
     */
    private static DeptDataPermissionRule buildRule(PermissionCommonApi permissionApi) {
        DeptDataPermissionRule rule = new DeptDataPermissionRule(permissionApi);
        rule.addDeptColumn("system_users", "dept_id");
        rule.addUserColumn("system_users", "id");
        return rule;
    }

    /**
     * 将管理员 {@link LoginUser} 绑定到当前线程的 Spring Security 上下文。
     */
    private static void bindAdminLoginUser(Long userId) {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(userId);
        loginUser.setUserType(UserTypeEnum.ADMIN.getValue());
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(loginUser, null, Collections.emptyList()));
    }

}
