package com.basicframework.framework.security.core.authorization;

import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.security.core.LoginUser;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;

import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证管理端与应用端兜底授权判定只接受真实用户。
 *
 * <p>该判定是机器主体隔离的唯一默认拒绝点：机器令牌即使通过令牌校验，也必须在这里被挡在管理接口之外；
 * 真实用户、匿名与未认证请求的行为同时锁定，避免把“隔离机器主体”实现成“整体拒绝”。</p>
 *
 * @author shady2713
 */
class RealUserRequiredAuthorizationManagerTest {

    /** 被测判定器，生产安全链使用同一实例。 */
    private final RealUserRequiredAuthorizationManager authorizationManager =
            RealUserRequiredAuthorizationManager.INSTANCE;

    /** 每个请求上下文只需要一个真实请求对象，判定本身不读取请求内容。 */
    private final RequestAuthorizationContext context =
            new RequestAuthorizationContext(new MockHttpServletRequest());

    /** 真实用户（正数编号）必须继续放行，数据范围与操作权限仍由后续方法级判定处理。 */
    @Test
    void realUserIsGranted() {
        assertThat(authorize(authentication(loginUser(1L)))).as("真实用户不能被机器主体隔离规则误伤").isTrue();
    }

    /** 客户端凭据模式的占位主体（userId=0）必须被拒绝，即使它持有有效令牌并带授权范围。 */
    @Test
    void machinePrincipalWithZeroIdIsDenied() {
        LoginUser machine = loginUser(0L);
        machine.setScopes(List.of("user.read"));

        assertThat(authorize(authentication(machine))).as("机器主体不是管理端用户").isFalse();
    }

    /** 边界为所有非正数：负占位编号的存量令牌同样被拒绝。 */
    @Test
    void machinePrincipalWithNegativeIdIsDenied() {
        assertThat(authorize(authentication(loginUser(-1L)))).as("非正数占位编号都属于机器主体").isFalse();
    }

    /** 缺少编号的主体不代表任何真实账号，必须按机器主体拒绝。 */
    @Test
    void principalWithoutUserIdIsDenied() {
        assertThat(authorize(authentication(loginUser(null)))).as("缺少用户编号的令牌不能访问管理接口").isFalse();
    }

    /** 匿名请求必须被拒绝，交由认证入口按未登录处理，而不是被当成机器主体。 */
    @Test
    void anonymousIsDenied() {
        Authentication anonymous = new AnonymousAuthenticationToken("key", "anonymousUser",
                AuthorityUtils.createAuthorityList("ROLE_ANONYMOUS"));

        assertThat(authorize(anonymous)).as("匿名请求必须保持未授信状态").isFalse();
    }

    /** 认证信息缺失时必须拒绝，不能因为拿不到主体就默认放行。 */
    @Test
    void missingAuthenticationIsDenied() {
        AuthorizationDecision decision = authorizationManager.check(() -> null, context);

        assertThat(decision.isGranted()).as("没有认证信息时必须失败关闭").isFalse();
    }

    /** 非登录用户主体（例如其他认证机制的认证对象）必须被拒绝。 */
    @Test
    void nonLoginUserPrincipalIsDenied() {
        Authentication other = new UsernamePasswordAuthenticationToken("other-principal", null,
                Collections.emptyList());

        assertThat(authorize(other)).as("判定只接受登录用户主体").isFalse();
    }

    /**
     * 用给定认证主体执行判定。
     *
     * @param authentication 当前认证信息，允许为 {@code null}
     * @return 判定是否授予访问
     */
    private boolean authorize(Authentication authentication) {
        return authorizationManager.check(() -> authentication, context).isGranted();
    }

    /**
     * 把登录用户包装为安全链使用的认证对象。
     *
     * @param loginUser 登录用户，作为认证主体
     * @return 已认证的认证对象
     */
    private static Authentication authentication(LoginUser loginUser) {
        return new UsernamePasswordAuthenticationToken(loginUser, null, Collections.emptyList());
    }

    /**
     * 构造管理端登录用户。
     *
     * @param userId 用户编号，{@code null} 表示凭据缺少编号
     * @return 登录用户
     */
    private static LoginUser loginUser(Long userId) {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(userId);
        loginUser.setUserType(UserTypeEnum.ADMIN.getValue());
        loginUser.setInfo(Map.of());
        return loginUser;
    }

}
