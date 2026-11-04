package com.basicframework.module.system.framework.security.login;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.util.servlet.ServletUtils;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.basicframework.framework.web.config.WebProperties;
import com.basicframework.framework.web.core.filter.ApiRequestFilter;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.service.user.AdminUserService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.Set;

import static com.basicframework.module.system.enums.ErrorCodeConstants.USER_PASSWORD_CHANGE_REQUIRED;

/**
 * 首次改密拦截过滤器。
 *
 * <p>只拦截已登录、且 {@code password_change_required=true} 的管理端请求。
 * 登录、刷新令牌、权限信息、个人中心和修改密码等必要入口放行，其余接口返回 403，
 * 防止前端绕过路由守卫继续调用业务接口。</p>
 *
 * @author shady2713
 */
@Component
@Order(Ordered.LOWEST_PRECEDENCE - 10)
public class PasswordChangeRequiredFilter extends ApiRequestFilter {

    /**
     * 强制改密期间仍需要放行的管理端接口。
     */
    private static final Set<String> ALLOWED_PATHS = Set.of(
            "/system/auth/login",
            "/system/auth/super-admin-login",
            "/system/auth/sms-login",
            "/system/auth/logout",
            "/system/auth/refresh-token",
            "/system/auth/get-permission-info",
            "/system/auth/send-sms-code",
            "/system/auth/reset-password",
            "/system/auth/register",
            "/system/auth/sm2-public-key",
            "/system/user/profile/get",
            "/system/user/profile/update-password");

    private final AdminUserService adminUserService;

    /**
     * 构造过滤器。
     *
     * @param webProperties Web 配置，用于识别管理端 API 前缀
     * @param adminUserService 用户服务，用于读取当前用户的改密标志
     */
    public PasswordChangeRequiredFilter(WebProperties webProperties, AdminUserService adminUserService) {
        super(webProperties);
        this.adminUserService = adminUserService;
    }

    /**
     * 对已登录且要求改密的用户阻断非必要接口。
     *
     * @param request 请求
     * @param response 响应
     * @param chain 过滤链
     * @throws ServletException Servlet 异常
     * @throws IOException IO 异常
     */
    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            chain.doFilter(request, response);
            return;
        }
        Long loginUserId = SecurityFrameworkUtils.getLoginUserId();
        if (loginUserId == null) {
            chain.doFilter(request, response);
            return;
        }
        AdminUserDO user = adminUserService.getUser(loginUserId);
        if (user == null || !Boolean.TRUE.equals(user.getPasswordChangeRequired())) {
            chain.doFilter(request, response);
            return;
        }
        String apiUri = resolveApiUri(request);
        if (ALLOWED_PATHS.contains(apiUri) || apiUri.startsWith("/system/captcha/")) {
            chain.doFilter(request, response);
            return;
        }
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        ServletUtils.writeJSON(response, CommonResult.error(USER_PASSWORD_CHANGE_REQUIRED));
    }

    /**
     * 去掉上下文路径和 Web 前缀，得到 Controller 相对路径。
     *
     * @param request 请求
     * @return 形如 {@code /system/user/page} 的相对路径
     */
    private String resolveApiUri(HttpServletRequest request) {
        String apiUri = request.getRequestURI().substring(request.getContextPath().length());
        String adminPrefix = webProperties.getAdminApi().getPrefix();
        if (apiUri.startsWith(adminPrefix)) {
            return apiUri.substring(adminPrefix.length());
        }
        String appPrefix = webProperties.getAppApi().getPrefix();
        if (apiUri.startsWith(appPrefix)) {
            return apiUri.substring(appPrefix.length());
        }
        return apiUri;
    }
}
