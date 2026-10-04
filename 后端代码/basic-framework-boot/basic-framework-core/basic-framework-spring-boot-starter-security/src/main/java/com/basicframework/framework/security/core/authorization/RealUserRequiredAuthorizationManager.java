package com.basicframework.framework.security.core.authorization;

import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;

import java.util.function.Supplier;

/**
 * 管理端与应用端接口的兜底授权判定：请求必须已认证，且认证主体必须是真实用户。
 *
 * <p>OAuth2 客户端凭据模式签发的机器主体持有有效令牌，但没有可被禁用或撤销的真实账号，不能作为
 * 管理端或应用端用户使用。安全链把它挡在管理接口之外，只允许模块通过
 * {@code AuthorizeRequestsCustomizer#authorizeMachineApi} 显式声明的机器接口放行。</p>
 *
 * <p>该判定只拒绝机器主体：未认证或匿名请求同样返回拒绝，由认证入口按未登录处理；真实用户不受影响，
 * 数据范围与操作权限仍在后续的方法级 {@code @PreAuthorize} 与数据权限中判定。</p>
 *
 * @author shady2713
 */
public final class RealUserRequiredAuthorizationManager implements AuthorizationManager<RequestAuthorizationContext> {

    /**
     * 无状态共享实例；判定结果只取决于当前认证主体，可直接用于安全链与单元测试。
     */
    public static final RealUserRequiredAuthorizationManager INSTANCE = new RealUserRequiredAuthorizationManager();

    /**
     * 判定器无状态，禁止外部重复实例化。
     */
    private RealUserRequiredAuthorizationManager() {
    }

    /**
     * 判定当前请求是否由真实用户发起。
     *
     * @param authentication 当前认证信息的提供者，由安全链注入，允许返回 {@code null}
     * @param context 请求授权上下文，本判定不读取请求内容
     * @return 主体是真实用户时授予访问；未认证、匿名或机器主体返回拒绝
     */
    @Override
    public AuthorizationDecision check(Supplier<Authentication> authentication,
                                       RequestAuthorizationContext context) {
        Authentication current = authentication.get();
        if (current == null || !(current.getPrincipal() instanceof LoginUser loginUser)) {
            // 未登录或匿名请求沿用 authenticated() 的语义交给认证入口返回未授权。
            return new AuthorizationDecision(false);
        }
        return new AuthorizationDecision(!SecurityFrameworkUtils.isMachinePrincipal(loginUser));
    }

}
