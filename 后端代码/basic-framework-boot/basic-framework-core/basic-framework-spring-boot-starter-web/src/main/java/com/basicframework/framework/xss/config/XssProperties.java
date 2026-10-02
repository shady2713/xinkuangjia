package com.basicframework.framework.xss.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.util.Collections;
import java.util.List;

/**
 * XSS 配置属性
 * <p>
 * 允许在配置中控制是否启用过滤、以及需要忽略的 URL 列表。
 *
 * @author 李杰
 */
@ConfigurationProperties(prefix = "basic-framework.xss")
@Validated
@Data
public class XssProperties {

    /**
     * 是否开启，默认为 true
     */
    private boolean enable = true;
    /**
     * 需要排除的 URL，默认为空
     */
    private List<String> excludeUrls = Collections.emptyList();

}
