package com.basicframework.framework.datasource.config;

import com.alibaba.druid.spring.boot3.autoconfigure.properties.DruidStatProperties;
import com.basicframework.framework.datasource.core.filter.DruidAdRemoveFilter;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.web.servlet.FilterRegistrationBean;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 校验 Druid 监控页广告过滤器注册 Bean 的装配条件与 URL 模式推导。
 *
 * <p>该过滤器只挂在 common.js 静态资源上，路径由监控页配置的 {@code url-pattern} 推导：
 * 把模式中的 {@code *} 替换为 {@code js/common.js}。若推导错误，广告过滤要么不生效，要么
 * 误挂在监控页本身；未开启监控页时又必须完全不注册该 Bean，避免给生产环境多挂一个过滤器。
 * 默认配置（未显式配置 url-pattern）必须回退到 {@code /druid/*}。</p>
 *
 * @author shady2713
 */
class BasicFrameworkDataSourceAutoConfigurationTest {

    /** 未配置 url-pattern 时必须回退到 /druid/* 并注册广告过滤器。 */
    @Test
    void defaultUrlPatternFallsBackToDruidPrefix() {
        FilterRegistrationBean<DruidAdRemoveFilter> registrationBean = new BasicFrameworkDataSourceAutoConfiguration()
                .druidAdRemoveFilterFilter(new DruidStatProperties());

        assertThat(registrationBean.getFilter()).isInstanceOf(DruidAdRemoveFilter.class);
        assertThat(registrationBean.getUrlPatterns())
                .as("通配符位置决定 common.js 的访问路径").containsExactly("/druid/js/common.js");
    }

    /** 自定义 url-pattern 时必须按同一规则推导出 common.js 路径。 */
    @Test
    void customUrlPatternDerivesCommonJsPath() {
        DruidStatProperties properties = new DruidStatProperties();
        properties.getStatViewServlet().setUrlPattern("/druid2/*");

        FilterRegistrationBean<DruidAdRemoveFilter> registrationBean = new BasicFrameworkDataSourceAutoConfiguration()
                .druidAdRemoveFilterFilter(properties);

        assertThat(registrationBean.getUrlPatterns()).containsExactly("/druid2/js/common.js");
    }

    /** 不含通配符的 url-pattern 没有可替换位置，必须原样保留而不是拼接出错误路径。 */
    @Test
    void urlPatternWithoutWildcardIsKeptAsIs() {
        DruidStatProperties properties = new DruidStatProperties();
        properties.getStatViewServlet().setUrlPattern("/monitor");

        FilterRegistrationBean<DruidAdRemoveFilter> registrationBean = new BasicFrameworkDataSourceAutoConfiguration()
                .druidAdRemoveFilterFilter(properties);

        assertThat(registrationBean.getUrlPatterns()).containsExactly("/monitor");
    }

    /** 只有开启 Druid 监控页时才注册广告过滤器 Bean，未开启时不得出现在容器中。 */
    @Test
    void filterBeanIsRegisteredOnlyWhenStatViewServletEnabled() {
        ApplicationContextRunner contextRunner = new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(BasicFrameworkDataSourceAutoConfiguration.class));

        contextRunner.run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).as("未开启监控页时不得注册广告过滤器")
                    .doesNotHaveBean("druidAdRemoveFilterFilter");
        });

        contextRunner.withPropertyValues("spring.datasource.druid.stat-view-servlet.enabled=true")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    FilterRegistrationBean<?> registrationBean =
                            context.getBean("druidAdRemoveFilterFilter", FilterRegistrationBean.class);
                    assertThat(registrationBean.getFilter()).isInstanceOf(DruidAdRemoveFilter.class);
                    assertThat(registrationBean.getUrlPatterns())
                            .as("默认配置绑定出 null url-pattern，因此回退到 /druid/*")
                            .containsExactly("/druid/js/common.js");
                });
    }
}
