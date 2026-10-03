package com.basicframework.module.system.framework.auth.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 管理端开放注册的部署开关，未配置时关闭；旧版分享登录不支持重开。
 *
 * @author shady2713
 */
@Data
@Component
@ConfigurationProperties(prefix = "basic-framework.auth")
public class AdminAuthenticationProperties {

    /** 是否允许开放注册；还必须同时启用数据库中的注册开关。 */
    private boolean registrationEnabled;

}
