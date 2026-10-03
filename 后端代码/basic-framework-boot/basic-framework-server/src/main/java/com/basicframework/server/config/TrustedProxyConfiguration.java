package com.basicframework.server.config;

import org.springframework.boot.autoconfigure.web.ServerProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.regex.Pattern;

/**
 * 约束转发头只由 Tomcat 原生可信代理规则处理，防止框架过滤器绕过来源校验。
 *
 * @author shady2713
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(ServerProperties.class)
public class TrustedProxyConfiguration {

    /**
     * 校验容器的转发头模式与代理白名单；Tomcat 的默认私网白名单不得代替部署配置。
     *
     * @param properties 实际绑定的容器配置
     * @return 启动时执行的配置校验器；不创建额外的转发头解析器
     * @throws IllegalStateException 未采用 native 模式或使用空白代理规则时抛出
     * @throws java.util.regex.PatternSyntaxException 代理规则不是合法正则表达式时抛出
     */
    @Bean
    public WebServerFactoryCustomizer<TomcatServletWebServerFactory> trustedProxyGuard(ServerProperties properties) {
        return factory -> {
            // FRAMEWORK 会直接接受来路不明的转发头；直接访问时仍采用 native + 空信任集合。
            if (properties.getForwardHeadersStrategy() != ServerProperties.ForwardHeadersStrategy.NATIVE) {
                throw new IllegalStateException("server.forward-headers-strategy 必须为 native");
            }
            String internalProxies = properties.getTomcat().getRemoteip().getInternalProxies();
            if (internalProxies == null || internalProxies.isBlank()) {
                throw new IllegalStateException("可信代理规则不得为空；不使用代理时请配置 (?!)");
            }
            Pattern.compile(internalProxies);
        };
    }
}
