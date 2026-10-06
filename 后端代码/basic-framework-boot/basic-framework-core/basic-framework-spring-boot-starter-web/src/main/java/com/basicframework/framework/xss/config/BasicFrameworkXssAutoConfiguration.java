package com.basicframework.framework.xss.config;

import com.basicframework.framework.common.enums.WebFilterOrderEnum;
import com.basicframework.framework.xss.core.clean.JsoupXssCleaner;
import com.basicframework.framework.xss.core.clean.XssCleaner;
import com.basicframework.framework.xss.core.filter.XssFilter;
import com.basicframework.framework.xss.core.json.XssStringJsonDeserializer;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.util.PathMatcher;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import static com.basicframework.framework.web.config.BasicFrameworkWebAutoConfiguration.createFilterBean;

/**
 * BasicFrameworkXssAutoConfiguration 自动配置类。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-framework/yudao-spring-boot-starter-web/src/main/java/cn/iocoder/yudao/framework/xss/config/YudaoXssAutoConfiguration.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配、配置前缀由 yudao.* 改为 basic-framework.*；本地改写/新增代码 2 行，上游代码 2 行在本地被移除或改写，例如 @ConditionalOnProperty(prefix = "basic-framework.xss", name = "enable", havingValue = "true", matchIfMissing = true) // ；@ConditionalOnProperty(value = "basic-framework.xss.enable", havingValue = "true")。
 */
@AutoConfiguration
@EnableConfigurationProperties(XssProperties.class)
@ConditionalOnProperty(prefix = "basic-framework.xss", name = "enable", havingValue = "true", matchIfMissing = true) // 设置为 false 时，禁用
public class BasicFrameworkXssAutoConfiguration implements WebMvcConfigurer {

    /**
     * Xss 清理者
     *
     * @return XssCleaner
     */
    @Bean
    @ConditionalOnMissingBean(XssCleaner.class)
    public XssCleaner xssCleaner() {
        return new JsoupXssCleaner();
    }

    /**
     * 注册 Jackson 的序列化器，用于处理 json 类型参数的 xss 过滤
     *
     * @return Jackson2ObjectMapperBuilderCustomizer
     */
    @Bean
    @ConditionalOnMissingBean(name = "xssJacksonCustomizer")
    @ConditionalOnProperty(value = "basic-framework.xss.enable", havingValue = "true")
    public Jackson2ObjectMapperBuilderCustomizer xssJacksonCustomizer(XssProperties properties,
                                                                      PathMatcher pathMatcher,
                                                                      XssCleaner xssCleaner) {
        // 在反序列化时进行 xss 过滤，可以替换使用 XssStringJsonSerializer，在序列化时进行处理
        return builder ->
                builder.deserializerByType(String.class, new XssStringJsonDeserializer(properties, pathMatcher, xssCleaner));
    }

    /**
     * 创建 XssFilter Bean，解决 Xss 安全问题
     */
    @Bean
    @ConditionalOnBean(XssCleaner.class)
    public FilterRegistrationBean<XssFilter> xssFilter(XssProperties properties, PathMatcher pathMatcher, XssCleaner xssCleaner) {
        return createFilterBean(new XssFilter(properties, pathMatcher, xssCleaner), WebFilterOrderEnum.XSS_FILTER);
    }

}
