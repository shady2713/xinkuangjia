package com.basicframework.framework.web.config;

import com.basicframework.framework.common.biz.infra.logger.ApiErrorLogCommonApi;
import com.basicframework.framework.common.biz.infra.logger.dto.ApiErrorLogCreateReqDTO;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.enums.WebFilterOrderEnum;
import com.basicframework.framework.web.config.fixture.controller.admin.probe.AdminProbeController;
import com.basicframework.framework.web.config.fixture.controller.app.probe.AppProbeController;
import com.basicframework.framework.web.core.filter.CacheRequestBodyFilter;
import com.basicframework.framework.web.core.handler.GlobalExceptionHandler;
import com.basicframework.framework.web.core.handler.GlobalResponseBodyHandler;
import com.basicframework.framework.web.core.util.WebFrameworkUtils;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.util.TestPropertyValues;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.filter.CorsFilter;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 Web 自动配置在真实 Spring 容器中注册的 Bean 与它们的可观察行为。
 *
 * <p>这些 Bean 决定接口前缀、异常响应、请求体缓存与跨域：前缀映射错会让管理端与应用端接口
 * 互相暴露，异常处理器缺少应用名会让错误日志无法归属实例，过滤器顺序错会让请求体在读取前
 * 被消费。用例用真实容器把应用名与 Web 配置注入进去，断言真实映射结果、真实异常响应与
 * 真实错误日志内容，而不是只断言 Bean 非空。</p>
 *
 * @author shady2713
 */
class BasicFrameworkWebAutoConfigurationTest {

    /** 容器启动的应用名，用于验证异常日志归属。 */
    private static final String APPLICATION_NAME = "DUMMY-APP";

    /** 记录异常日志接口收到的创建请求，用于独立观察异常处理器的副作用。 */
    private final List<ApiErrorLogCreateReqDTO> recordedErrorLogs = new CopyOnWriteArrayList<>();

    /** 测试容器。 */
    private AnnotationConfigApplicationContext context;

    /** 启动真实容器并注入应用名、管理端地址与异常日志接口替身。 */
    @BeforeEach
    void startContext() {
        context = new AnnotationConfigApplicationContext();
        TestPropertyValues.of(
                "spring.application.name=" + APPLICATION_NAME,
                "basic-framework.web.admin-ui.url=http://127.0.0.1:0/admin/").applyTo(context);
        context.registerBean(ApiErrorLogCommonApi.class, () -> new ApiErrorLogCommonApi() {

            /**
             * 记录异常日志创建请求，供用例断言异常处理器的真实副作用。
             *
             * @param createDTO 异常日志创建信息
             */
            @Override
            public void createApiErrorLog(ApiErrorLogCreateReqDTO createDTO) {
                recordedErrorLogs.add(createDTO);
            }
        });
        context.registerBean("restTemplateBuilder", RestTemplateBuilder.class, () -> new RestTemplateBuilder());
        context.register(BasicFrameworkWebAutoConfiguration.class);
        context.refresh();
    }

    /** 关闭容器，避免上下文与静态配置在用例之间泄漏。 */
    @AfterEach
    void stopContext() {
        if (context != null) {
            context.close();
            context = null;
        }
    }

    /**
     * 路径前缀必须按"包 + RestController 注解"真实匹配到对应的 API 前缀。
     *
     * <p>管理端前缀命中管理端包下的控制器，不得命中应用端控制器；匹配包但没有
     * {@code RestController} 的类也不得命中，避免普通组件被加上接口前缀。</p>
     */
    @Test
    void pathPrefixesMatchControllerPackagesOnly() {
        RequestMappingHandlerMapping mapping = context.getBean(
                org.springframework.boot.autoconfigure.web.servlet.WebMvcRegistrations.class)
                .getRequestMappingHandlerMapping();

        Map<String, java.util.function.Predicate<Class<?>>> prefixes = mapping.getPathPrefixes();

        assertThat(prefixes).containsOnlyKeys("/admin-api", "/app-api");
        assertThat(prefixes.get("/admin-api").test(AdminProbeController.class))
                .as("管理端包下的控制器必须命中管理端前缀").isTrue();
        assertThat(prefixes.get("/admin-api").test(AdminProbeController.AdminPlainComponent.class))
                .as("缺少 RestController 注解的类不得命中前缀").isFalse();
        assertThat(prefixes.get("/admin-api").test(AppProbeController.class))
                .as("管理端前缀不得命中应用端控制器").isFalse();
        assertThat(prefixes.get("/app-api").test(AppProbeController.class))
                .as("应用端包下的控制器必须命中应用端前缀").isTrue();
    }

    /** 登录用户类型必须按真实请求路径前缀推断，未知路径返回 null。 */
    @Test
    void webFrameworkUtilsInfersUserTypeFromPathPrefix() {
        assertThat(context.getBean(WebFrameworkUtils.class)).isNotNull();
        MockHttpServletRequest adminRequest = pathRequest("/admin-api/system/user/page");
        MockHttpServletRequest appRequest = pathRequest("/app-api/user/profile");
        MockHttpServletRequest otherRequest = pathRequest("/actuator/health");

        assertThat(WebFrameworkUtils.getLoginUserType(adminRequest)).isEqualTo(UserTypeEnum.ADMIN.getValue());
        assertThat(WebFrameworkUtils.getLoginUserType(appRequest)).isEqualTo(UserTypeEnum.MEMBER.getValue());
        assertThat(WebFrameworkUtils.getLoginUserType(otherRequest)).as("未知前缀不得推断出用户类型").isNull();
        assertThat(WebFrameworkUtils.getLoginUserType(null)).isNull();
    }

    /**
     * 缺失或空前缀的 API 配置不得注册路径前缀。
     *
     * <p>运维把某一端的前缀清空（或整段配置缺失）时，该端不应得到空前缀映射：空前缀会让
     * 该端接口与其它路径混淆，也会让路径匹配退化成"全部命中"。</p>
     */
    @Test
    void blankOrMissingApiPrefixIsNotRegistered() {
        WebProperties withoutAppApi = new WebProperties();
        withoutAppApi.setAppApi(null);
        WebProperties.Api blankPrefix = new WebProperties.Api();
        blankPrefix.setPrefix("");
        blankPrefix.setController("**.controller.admin.**");
        WebProperties withoutAdminPrefix = new WebProperties();
        withoutAdminPrefix.setAdminApi(blankPrefix);

        Map<String, java.util.function.Predicate<Class<?>>> withoutApp =
                new BasicFrameworkWebAutoConfiguration().webMvcRegistrations(withoutAppApi)
                        .getRequestMappingHandlerMapping().getPathPrefixes();
        Map<String, java.util.function.Predicate<Class<?>>> withoutAdmin =
                new BasicFrameworkWebAutoConfiguration().webMvcRegistrations(withoutAdminPrefix)
                        .getRequestMappingHandlerMapping().getPathPrefixes();

        assertThat(withoutApp).as("配置缺失的一端不得注册前缀").containsOnlyKeys("/admin-api");
        assertThat(withoutAdmin).as("空前缀不得注册为映射前缀").containsOnlyKeys("/app-api");
    }

    /**
     * 构造带真实 servletPath 的请求，路径前缀判定读取的就是该值。
     *
     * @param path 请求路径
     * @return 已设置 servletPath 的请求
     */
    private static MockHttpServletRequest pathRequest(String path) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", path);
        request.setServletPath(path);
        return request;
    }

    /**
     * 异常处理器必须把应用名与请求信息写进错误日志，并返回统一错误码。
     *
     * <p>应用名缺失或多实例场景下写错会让错误日志无法归属，因此这里用真实容器注入的应用名断言
     * 日志内容；同时确认响应码仍是统一的系统异常码。</p>
     */
    @Test
    void globalExceptionHandlerLogsWithApplicationName() {
        GlobalExceptionHandler handler = context.getBean(GlobalExceptionHandler.class);
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/system/user/page");
        request.setQueryString("pageNo=1");

        var result = handler.allExceptionHandler(request, new IllegalStateException("DUMMY-FAILURE"));

        assertThat(result.getCode()).as("必须返回统一系统异常码").isEqualTo(500);
        assertThat(recordedErrorLogs).as("异常必须写入错误日志").hasSize(1);
        ApiErrorLogCreateReqDTO errorLog = recordedErrorLogs.get(0);
        assertThat(errorLog.getApplicationName()).as("错误日志必须归属到应用名").isEqualTo(APPLICATION_NAME);
        assertThat(errorLog.getRequestUrl()).as("错误日志必须记录真实请求地址")
                .isEqualTo("/admin-api/system/user/page");
        assertThat(errorLog.getExceptionName()).isEqualTo(IllegalStateException.class.getName());
    }

    /** 请求体缓存过滤器与跨域过滤器必须按约定顺序注册，且过滤器具名。 */
    @Test
    void filterRegistrationsUseExpectedOrderAndTypes() {
        FilterRegistrationBean<CacheRequestBodyFilter> cacheFilter = context.getBean(
                "requestBodyCacheFilter", FilterRegistrationBean.class);
        FilterRegistrationBean<CorsFilter> corsFilter = context.getBean(
                "corsFilterBean", FilterRegistrationBean.class);

        assertThat(cacheFilter.getFilter()).isInstanceOf(CacheRequestBodyFilter.class);
        assertThat(cacheFilter.getOrder()).isEqualTo(WebFilterOrderEnum.REQUEST_BODY_CACHE_FILTER);
        assertThat(corsFilter.getFilter()).isInstanceOf(CorsFilter.class);
        assertThat(corsFilter.getOrder()).as("跨域过滤器必须先于认证执行")
                .isEqualTo(WebFilterOrderEnum.CORS_FILTER);
    }

    /** 响应体包装、RestTemplate 与异常处理器 Bean 必须真实可注入。 */
    @Test
    void remainingBeansAreRegistered() {
        assertThat(context.getBean(GlobalResponseBodyHandler.class)).isNotNull();
        assertThat(context.getBean(RestTemplate.class)).as("RestTemplate 必须可注入").isNotNull();
    }

}
