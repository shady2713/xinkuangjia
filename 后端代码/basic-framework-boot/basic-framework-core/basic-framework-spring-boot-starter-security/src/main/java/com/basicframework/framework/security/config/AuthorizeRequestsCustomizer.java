package com.basicframework.framework.security.config;

import com.basicframework.framework.web.config.WebProperties;
import jakarta.annotation.Resource;
import org.springframework.core.Ordered;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AuthorizeHttpRequestsConfigurer;

/**
 * 自定义的 URL 的安全配置
 * 目的：每个 Maven Module 可以自定义规则！
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 *
 */
public abstract class AuthorizeRequestsCustomizer
        implements Customizer<AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry>, Ordered {

    @Resource
    private WebProperties webProperties;

    /**
     * 组合 admin-api 前缀 + 相对路径
     *
     * @param url 相对路径
     * @return 完整 URL
     */
    protected String buildAdminApi(String url) {
        return webProperties.getAdminApi().getPrefix() + url;
    }

    /**
     * 组合 app-api 前缀 + 相对路径
     *
     * @param url 相对路径
     * @return 完整 URL
     */
    protected String buildAppApi(String url) {
        return webProperties.getAppApi().getPrefix() + url;
    }

    /**
     * 声明机器主体（OAuth2 客户端凭据模式）允许访问的管理端或应用端接口。
     *
     * <p>机器主体不对应任何真实用户，管理端与应用端接口默认按无权限拒绝机器主体；只有在这里显式声明的
     * 接口才会放行。声明的接口必须自行用 {@code @PreAuthorize("@ss.hasScope('...')")} 限定授权范围，
     * 否则任何有效机器令牌都能调用它。</p>
     *
     * <p>这里注册的匹配器先于安全链的机器主体兜底规则生效，因此这是模块开放机器访问面的唯一入口；
     * 业务模块新增机器接口时应在自己的 {@link AuthorizeRequestsCustomizer} 中声明。</p>
     *
     * @param registry Spring Security 请求匹配注册器，按注册顺序先匹配先生效
     * @param urls 机器主体可访问的接口路径，必须带管理端或应用端前缀
     */
    protected void authorizeMachineApi(
            AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry registry,
            String... urls) {
        registry.requestMatchers(urls).authenticated();
    }

    /**
     * 获取Order。
     *
     * @return 查询或转换后的结果
     */
    @Override
    public int getOrder() {
        return 0;
    }

}
