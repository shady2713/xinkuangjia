package com.basicframework.framework.security.core.handler;

import com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.basicframework.framework.common.util.servlet.ServletUtils;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.access.ExceptionTranslationFilter;

import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;

import static com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants.FORBIDDEN;

/**
 * 访问一个需要认证的 URL 资源，已经认证（登录）但是没有权限的情况下，返回 {@link GlobalErrorCodeConstants#FORBIDDEN} 错误码。
 *
 * 补充：Spring Security 的 {@link ExceptionTranslationFilter} 在
 * {@code handleAccessDeniedException} 中调用当前类，把权限不足翻译成统一错误码。
 *
 * @author 李杰
 *
 */
@Slf4j
@SuppressWarnings("JavadocReference")
public class AccessDeniedHandlerImpl implements AccessDeniedHandler {

    /**
     * 已登录场景下权限不足时返回标准错误码
     *
     * @param request  请求对象
     * @param response 响应对象
     * @param e        权限不足异常
     * @throws IOException      IO 异常
     * @throws ServletException servlet 异常
     */
    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, AccessDeniedException e)
            throws IOException, ServletException {
        log.warn("[commence][访问 URL({}) 时，用户({}) 权限不够，exception({})]",
                request.getRequestURI(), SecurityFrameworkUtils.getLoginUserId(), e.getClass().getSimpleName());
        ServletUtils.writeJSON(response, CommonResult.error(FORBIDDEN));
    }

}
