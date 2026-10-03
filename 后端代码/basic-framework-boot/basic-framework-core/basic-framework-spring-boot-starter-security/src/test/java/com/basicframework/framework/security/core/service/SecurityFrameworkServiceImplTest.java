package com.basicframework.framework.security.core.service;

import com.basicframework.framework.common.biz.system.permission.PermissionCommonApi;
import com.basicframework.framework.common.biz.system.permission.dto.DeptDataPermissionRespDTO;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 {@link SecurityFrameworkServiceImpl} 的功能权限、角色与授权范围判定。
 *
 * <p>未登录时必须在触达权限接口前返回拒绝：一旦把空身份传给下游，
 * 下游按默认值放行就会造成未授权访问。</p>
 *
 * @author shady2713
 */
class SecurityFrameworkServiceImplTest {

    /** 被授予权限与角色的用户编号。 */
    private final Set<Long> grantedUserIds = ConcurrentHashMap.newKeySet();
    /** 记录权限与角色查询是否被触达。 */
    private final List<String> permissionQueries = java.util.Collections.synchronizedList(new ArrayList<>());

    private SecurityFrameworkServiceImpl service;

    /** 每例使用干净的替身与空上下文，避免用例之间共享授权状态。 */
    @BeforeEach
    void setUp() {
        SecurityContextHolder.clearContext();
        grantedUserIds.clear();
        permissionQueries.clear();
        service = new SecurityFrameworkServiceImpl(recordingPermissionApi());
    }

    /** 恢复默认上下文策略，避免影响同 JVM 的其他测试。 */
    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    /** 无登录用户时权限、角色与范围判定都必须拒绝。 */
    @Test
    void anonymousIsDeniedEverything() {
        assertThat(service.hasPermission("system:user:query")).isFalse();
        assertThat(service.hasRole("admin")).isFalse();
        assertThat(service.hasScope("user.read")).isFalse();
        assertThat(permissionQueries)
                .as("未登录时不得触达权限接口，否则空身份可能被按默认值放行")
                .isEmpty();
    }

    /** 已登录且被授权时权限判定通过。 */
    @Test
    void grantedUserPassesPermissionCheck() {
        grantedUserIds.add(1L);
        asUser(1L, List.of("user.read"));

        assertThat(service.hasPermission("system:user:query")).isTrue();
        assertThat(service.hasRole("admin")).isTrue();
        assertThat(permissionQueries).contains("permissions:1", "roles:1");
    }

    /** 已登录但未被授权时必须拒绝，授权结果不得由登录态本身推导。 */
    @Test
    void ungrantedUserIsDenied() {
        asUser(2L, List.of());

        assertThat(service.hasPermission("system:user:query")).isFalse();
        assertThat(service.hasRole("admin")).isFalse();
        assertThat(permissionQueries).contains("permissions:2", "roles:2");
    }

    /** 单值入口必须委托给复数入口，避免两条判定路径出现分歧。 */
    @Test
    void singleValueEntryDelegatesToAnyVariant() {
        grantedUserIds.add(3L);
        asUser(3L, List.of());

        assertThat(service.hasPermission("system:user:query"))
                .isEqualTo(service.hasAnyPermissions("system:user:query"));
        assertThat(service.hasRole("admin")).isEqualTo(service.hasAnyRoles("admin"));
    }

    /** 授权范围命中时放行。 */
    @Test
    void scopeMatchGrantsAccess() {
        asUser(4L, List.of("user.read", "user.write"));

        assertThat(service.hasScope("user.read")).isTrue();
        assertThat(service.hasAnyScopes("user.write", "other")).isTrue();
    }

    /** 授权范围未命中时拒绝，范围判定不得因登录态而默认通过。 */
    @Test
    void scopeMismatchDeniesAccess() {
        asUser(5L, List.of("user.read"));

        assertThat(service.hasScope("user.delete")).isFalse();
        assertThat(service.hasAnyScopes("user.delete", "other")).isFalse();
    }

    /** 登录用户没有任何授权范围时必须拒绝。 */
    @Test
    void userWithoutScopesIsDenied() {
        asUser(6L, List.of());

        assertThat(service.hasScope("user.read")).isFalse();
    }

    /** 授权范围判定只依据令牌内的范围，不触达权限接口。 */
    @Test
    void scopeCheckDoesNotCallPermissionApi() {
        asUser(7L, List.of("user.read"));

        assertThat(service.hasScope("user.read")).isTrue();
        assertThat(permissionQueries)
                .as("范围来自令牌本身，无需再查询角色")
                .isEmpty();
    }

    /**
     * 以指定身份执行一段逻辑，结束后清空上下文。
     * 身份隔离不完整时，权限判定会在无登录态下得出错误结论。
     */
    private void asUser(Long userId, List<String> scopes) {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(userId);
        loginUser.setUserType(UserTypeEnum.ADMIN.getValue());
        loginUser.setScopes(scopes);
        SecurityFrameworkUtils.setLoginUser(loginUser, new MockHttpServletRequest());
    }

    /**
     * 权限接口替身：只对已登记用户放行，并记录真实调用。
     * 一律放行会让“无权限应被拒绝”的断言成为恒真，无法证明拒绝路径可达。
     */
    private PermissionCommonApi recordingPermissionApi() {
        return new PermissionCommonApi() {

            /** 只对已授权用户放行。 */
            @Override
            public boolean hasAnyPermissions(Long userId, String... permissions) {
                permissionQueries.add("permissions:" + userId);
                return grantedUserIds.contains(userId);
            }

            /** 只对已授权用户放行。 */
            @Override
            public boolean hasAnyRoles(Long userId, String... roles) {
                permissionQueries.add("roles:" + userId);
                return grantedUserIds.contains(userId);
            }

            /** 数据权限不在本测试的被测范围内。 */
            @Override
            public DeptDataPermissionRespDTO getDeptDataPermission(Long userId) {
                throw new UnsupportedOperationException("本测试不查询数据权限");
            }
        };
    }
}
