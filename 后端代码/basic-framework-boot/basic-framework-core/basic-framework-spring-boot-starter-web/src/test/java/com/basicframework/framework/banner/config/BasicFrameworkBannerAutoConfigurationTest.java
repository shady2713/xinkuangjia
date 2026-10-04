package com.basicframework.framework.banner.config;

import com.basicframework.framework.banner.core.BannerApplicationRunner;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 Banner 自动配置在最小上下文中注册启动提示 Runner。
 *
 * <p>该自动配置只做一件事：注册启动完成后打印访问地址的 Runner。漏注册不会导致启动失败，
 * 只会在真实部署时静默缺少启动提示，因此这里用真实上下文确认 Bean 存在且类型正确。</p>
 *
 * @author shady2713
 */
class BasicFrameworkBannerAutoConfigurationTest {

    /** 应用该自动配置后必须注册唯一的启动提示 Runner。 */
    @Test
    void registersBannerApplicationRunner() {
        new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(BasicFrameworkBannerAutoConfiguration.class))
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).hasSingleBean(BannerApplicationRunner.class);
                });
    }

}
