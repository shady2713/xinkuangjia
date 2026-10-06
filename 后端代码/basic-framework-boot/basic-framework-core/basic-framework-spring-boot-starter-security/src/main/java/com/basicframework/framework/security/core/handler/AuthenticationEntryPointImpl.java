package com.basicframework.framework.security.core.handler;

import com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.util.servlet.ServletUtils;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.ExceptionTranslationFilter;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import static com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants.UNAUTHORIZED;

/**
 * 访问需要认证的 URL 资源但尚未登录时，返回 {@link GlobalErrorCodeConstants#UNAUTHORIZED} 错误码，
 * 由前端据此重定向到登录页。
 *
 * 补充：Spring Security 的 {@link ExceptionTranslationFilter} 在
 * {@code sendStartAuthentication} 中调用当前类，把未认证翻译成统一错误码。
 *
 * @author ruoyi
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 *
 */
@Slf4j
@SuppressWarnings("JavadocReference")
public class AuthenticationEntryPointImpl implements AuthenticationEntryPoint {

    /**
     * 未登录访问受保护资源时，返回标准未授权返回体
     *
     * @param request  请求对象
     * @param response 响应对象
     * @param e        认证异常
     */
    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response, AuthenticationException e) {
        log.debug("[commence][访问 URL({}) 时，没有登录，exception({})]",
                request.getRequestURI(), e.getClass().getSimpleName());
        ServletUtils.writeJSON(response, CommonResult.error(UNAUTHORIZED));
    }

}
