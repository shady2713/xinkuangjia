package com.basicframework.framework.security.core.filter;

import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.biz.system.oauth2.OAuth2TokenCommonApi;
import com.basicframework.framework.common.biz.system.oauth2.dto.OAuth2AccessTokenCheckRespDTO;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.util.servlet.ServletUtils;
import com.basicframework.framework.security.config.SecurityProperties;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.basicframework.framework.web.core.handler.GlobalExceptionHandler;
import com.basicframework.framework.web.core.util.WebFrameworkUtils;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Token 过滤器，负责校验请求携带的访问令牌。
 * 校验通过后，将解析出的 {@link LoginUser} 写入 Spring Security 上下文。
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@RequiredArgsConstructor
public class TokenAuthenticationFilter extends OncePerRequestFilter {

    private final SecurityProperties securityProperties;

    private final GlobalExceptionHandler globalExceptionHandler;

    private final ObjectProvider<OAuth2TokenCommonApi> oauth2TokenApiProvider;

    /**
     * 处理每个 HTTP 请求的鉴权前置逻辑
     *
     * <p>有 token 时进行验签并尝试写入上下文；无 token 或验签失败则按原链路继续或直接返回错误。</p>
     *
     * @param request  请求
     * @param response 响应
     * @param chain    过滤链
     * @throws ServletException servlet 异常
     * @throws IOException      IO 异常
     */
    @Override
    @SuppressWarnings("NullableProblems")
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String token = SecurityFrameworkUtils.obtainAuthorization(request,
                securityProperties.getTokenHeader(), securityProperties.getTokenParameter());
        if (StrUtil.isNotEmpty(token)) {
            Integer userType = WebFrameworkUtils.getLoginUserType(request);
            try {
                // 基于标准 token 校验结果构建登录用户，开源版不再保留 mock 登录兜底能力。
                LoginUser loginUser = buildLoginUserByToken(token, userType);
                // 仅在标准 token 校验通过时写入当前登录用户。
                if (loginUser != null) {
                    SecurityFrameworkUtils.setLoginUser(loginUser, request);
                }
            } catch (Exception ex) {
                // 只转换可处理的应用异常；JVM Error 必须继续传播，避免把进程级故障伪装成鉴权响应。
                CommonResult<?> result = globalExceptionHandler.allExceptionHandler(request, ex);
                ServletUtils.writeJSON(response, result);
                return;
            }
        }

        // 继续后续过滤链。
        chain.doFilter(request, response);
    }

    /**
     * 基于标准 Token 构建登录用户
     *
     * @param token    访问 token
     * @param userType 用户类型，可能为空
     * @return 登录用户；验证失败则返回 null
     */
    private LoginUser buildLoginUserByToken(String token, Integer userType) {
        try {
            OAuth2AccessTokenCheckRespDTO accessToken = oauth2TokenApiProvider.getObject().checkAccessToken(token);
            if (accessToken == null) {
                return null;
            }
            // 用户类型不匹配时直接拒绝访问。
            // 仅 /admin-api/* 和 /app-api/* 这类请求会带用户类型，其他场景允许为空。
            if (userType != null
                    && ObjectUtil.notEqual(accessToken.getUserType(), userType)) {
                throw new AccessDeniedException("错误的用户类型");
            }
            // 构建登录用户并透传权限和附加信息。
            LoginUser loginUser = new LoginUser();
            loginUser.setId(accessToken.getUserId());
            loginUser.setUserType(accessToken.getUserType());
            loginUser.setInfo(accessToken.getUserInfo());
            loginUser.setScopes(accessToken.getScopes());
            loginUser.setExpiresTime(accessToken.getExpiresTime());
            return loginUser;
        } catch (ServiceException serviceException) {
            // token 校验失败时直接按未登录处理，交由后续鉴权链路决定是否允许访问。
            return null;
        }
    }

}
