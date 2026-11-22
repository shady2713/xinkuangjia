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
 * @author 李杰
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
     * 获取Order。
     *
     * @return 查询或转换后的结果
     */
    @Override
    public int getOrder() {
        return 0;
    }

}
