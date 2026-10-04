package com.basicframework.framework.xss.config;

import com.basicframework.framework.common.enums.WebFilterOrderEnum;
import com.basicframework.framework.xss.core.clean.JsoupXssCleaner;
import com.basicframework.framework.xss.core.clean.XssCleaner;
import com.basicframework.framework.xss.core.filter.XssFilter;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.util.AntPathMatcher;
import org.springframework.util.PathMatcher;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 校验 XSS 自动配置装配的清理器、Jackson 反序列化定制器与过滤器注册 Bean。
 *
 * <p>三条装配路径共同决定“哪些输入会被清理”：清理器是 Web 参数与 JSON 字符串共用的白名单
 * 实现；Jackson 定制器让请求体中的字符串在反序列化阶段就被清理，并遵守排除名单；过滤器按
 * 约定顺序注册，保证它排在请求体缓存之后、安全链之前。开关与缺省 Bean 条件也必须如实生效，
 * 否则关闭 XSS 过滤或自定义清理器时会出现“配置了但不生效”的假象。</p>
 *
 * @author shady2713
 */
class BasicFrameworkXssAutoConfigurationTest {

    /** 请求路径匹配器，与生产使用同一 Ant 实现。 */
    private static final AntPathMatcher PATH_MATCHER = new AntPathMatcher();

    /** 用例结束后清理请求上下文，避免线程级状态泄漏到其它测试。 */
    @AfterEach
    void resetRequestContext() {
        RequestContextHolder.resetRequestAttributes();
    }

    /** 默认清理器必须是基于 Jsoup 的真实白名单实现，脚本与事件属性被清除。 */
    @Test
    void defaultCleanerRemovesScriptsAndEventHandlers() {
        XssCleaner cleaner = new BasicFrameworkXssAutoConfiguration().xssCleaner();

        assertThat(cleaner).isInstanceOf(JsoupXssCleaner.class);
        assertThat(cleaner.clean("<script>alert(1)</script>安全")).as("脚本标签及其内容被整体清除")
                .isEqualTo("安全");
        assertThat(cleaner.clean("<img src=x onerror=alert(1)>文字")).as("事件属性被移除，标签与文本保留")
                .isEqualTo("<img>文字");
        assertThat(cleaner.clean("<b>加粗</b>普通")).as("白名单内的排版标签必须保留").isEqualTo("<b>加粗</b>普通");
    }

    /** Jackson 定制器必须让请求体字符串在反序列化阶段完成清理。 */
    @Test
    void jacksonCustomizerCleansStringValues() throws Exception {
        ObjectMapper objectMapper = customizedObjectMapper(new XssProperties());

        Holder holder = objectMapper.readValue("{\"value\":\"<script>alert(1)</script>安全\"}", Holder.class);

        assertThat(holder.value).as("反序列化得到的字符串必须是清理后的内容").isEqualTo("安全");
    }

    /** 命中排除名单的请求路径必须跳过清理，回调接口才能收到第三方原文。 */
    @Test
    void jacksonCustomizerHonoursExcludedUrls() throws Exception {
        XssProperties properties = new XssProperties();
        properties.setExcludeUrls(List.of("/app-api/notify/**"));
        ObjectMapper objectMapper = customizedObjectMapper(properties);

        bindRequest("/app-api/notify/callback");
        Holder excluded = objectMapper.readValue("{\"value\":\"<script>alert(1)</script>原文\"}", Holder.class);
        bindRequest("/app-api/order/create");
        Holder included = objectMapper.readValue("{\"value\":\"<script>alert(1)</script>原文\"}", Holder.class);

        assertThat(excluded.value).as("排除名单内的请求保留原文").isEqualTo("<script>alert(1)</script>原文");
        assertThat(included.value).as("未排除的请求必须清理").isEqualTo("原文");
    }

    /** 过滤器注册 Bean 必须携带真实过滤器与约定顺序。 */
    @Test
    void filterRegistrationCarriesFilterAndOrder() {
        FilterRegistrationBean<XssFilter> registrationBean = new BasicFrameworkXssAutoConfiguration()
                .xssFilter(new XssProperties(), PATH_MATCHER, new JsoupXssCleaner());

        assertThat(registrationBean.getFilter()).isInstanceOf(XssFilter.class);
        assertThat(registrationBean.getOrder())
                .as("必须排在请求体缓存之后、安全链之前").isEqualTo(WebFilterOrderEnum.XSS_FILTER);
    }

    /** 开关与缺省 Bean 条件必须如实生效：默认不开通 Jackson 定制器，关闭开关则整体不装配。 */
    @Test
    void autoConfigurationRespectsPropertiesAndConditions() {
        ApplicationContextRunner contextRunner = new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(BasicFrameworkXssAutoConfiguration.class))
                .withBean(PathMatcher.class, AntPathMatcher::new);

        contextRunner.run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).hasSingleBean(XssCleaner.class);
            assertThat(context).hasBean("xssFilter");
            assertThat(context).as("Jackson 定制器要求显式开启，默认不注册")
                    .doesNotHaveBean("xssJacksonCustomizer");
        });

        contextRunner.withPropertyValues("basic-framework.xss.enable=true").run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).hasBean("xssJacksonCustomizer");
        });

        contextRunner.withPropertyValues("basic-framework.xss.enable=false").run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).as("关闭开关后整体不装配").doesNotHaveBean(XssCleaner.class);
            assertThat(context).doesNotHaveBean("xssFilter");
            assertThat(context).doesNotHaveBean(XssProperties.class);
        });
    }

    /**
     * 按自动配置输出的定制器构建 ObjectMapper。
     *
     * @param properties XSS 配置
     * @return 应用定制器后的对象映射器
     */
    private static ObjectMapper customizedObjectMapper(XssProperties properties) {
        Jackson2ObjectMapperBuilderCustomizer customizer = new BasicFrameworkXssAutoConfiguration()
                .xssJacksonCustomizer(properties, PATH_MATCHER, new JsoupXssCleaner());
        Jackson2ObjectMapperBuilder builder = new Jackson2ObjectMapperBuilder();
        customizer.customize(builder);
        return builder.build();
    }

    /**
     * 把当前线程的请求上下文绑定到指定路径。
     *
     * @param uri 请求路径
     */
    private static void bindRequest(String uri) {
        RequestContextHolder.setRequestAttributes(
                new ServletRequestAttributes(new MockHttpServletRequest("POST", uri)));
    }

    /** 承载字符串字段的反序列化样例类型。 */
    static class Holder {

        /** 待清理的字符串取值。 */
        private String value;

        /**
         * 读取字符串取值。
         *
         * @return 字符串取值
         */
        String getValue() {
            return value;
        }

        /**
         * 设置字符串取值。
         *
         * @param value 字符串取值
         */
        public void setValue(String value) {
            this.value = value;
        }
    }
}
