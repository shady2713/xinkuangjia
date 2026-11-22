package com.basicframework.framework.banner.config;

import com.basicframework.framework.banner.core.BannerApplicationRunner;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Bean;

/**
 * Banner 自动配置类
 *
 * 在应用启动后注册 BannerApplicationRunner 打印启动提示。
 *
 * @author 李杰
 */
@AutoConfiguration
public class BasicFrameworkBannerAutoConfiguration {

    /**
     * 注册启动后异步打印启动完成信息的 Runner
     *
     * @return BannerApplicationRunner
     */
    @Bean
    public BannerApplicationRunner bannerApplicationRunner() {
        return new BannerApplicationRunner();
    }

}
