package com.basicframework.framework.security.config;

import com.basicframework.framework.web.config.WebProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AuthorizeHttpRequestsConfigurer;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.RETURNS_DEEP_STUBS;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * 验证各模块自定义授权规则的拼装入口。
 *
 * <p>模块通过本类声明自己的免登录与机器接口：前缀拼装错了，规则就会被注册到不存在的路径上，接口
 * 既没有按预期免登录也没有按预期放行，而且不会有任何报错。机器接口的注册顺序同样关键——它必须
 * 排在安全链的机器主体兜底规则之前才生效。</p>
 *
 * @author shady2713
 */
class AuthorizeRequestsCustomizerTest {

    /** 被测自定义器。 */
    private AuthorizeRequestsCustomizer customizer;
    /** 请求匹配注册器替身。 */
    private AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry registry;

    /** 装配被测自定义器，并把 Web 属性的管理端与应用端前缀设为可区分的值。 */
    @BeforeEach
    void setUp() {
        WebProperties webProperties = new WebProperties();
        webProperties.getAdminApi().setPrefix("/admin-api");
        webProperties.getAppApi().setPrefix("/app-api");
        customizer = new AuthorizeRequestsCustomizer() {

            /**
             * 本用例只验证前缀拼装与机器接口注册，不声明任何具体规则。
             *
             * @param registry Spring Security 请求匹配注册器
             */
            @Override
            public void customize(AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry registry) {
                // 无规则：模块没有需要在此声明的接口。
            }

        };
        ReflectionTestUtils.setField(customizer, "webProperties", webProperties);
        registry = mock(AuthorizeHttpRequestsConfigurer.AuthorizationManagerRequestMatcherRegistry.class,
                RETURNS_DEEP_STUBS);
    }

    /** 管理端前缀必须按配置拼装，调用方传入相对路径即可。 */
    @Test
    void buildAdminApiPrefixesTheConfiguredAdminPath() {
        assertThat(invoke("buildAdminApi", "/system/user/list"))
                .isEqualTo("/admin-api/system/user/list");
    }

    /** 应用端前缀必须与调用方传入的端点类型对应，两个前缀不得混用。 */
    @Test
    void buildAppApiPrefixesTheConfiguredAppPath() {
        assertThat(invoke("buildAppApi", "/member/profile"))
                .isEqualTo("/app-api/member/profile");
    }

    /** 机器接口必须按给定路径整体注册为"已认证"，不能逐个前缀拆开注册。 */
    @Test
    void authorizeMachineApiRegistersTheDeclaredPathsAsAuthenticated() {
        customizer.authorizeMachineApi(registry, "/admin-api/system/oauth2/user/get");

        verify(registry).requestMatchers("/admin-api/system/oauth2/user/get");
        assertThat(invoke("getOrder")).as("模块规则必须排在安全链兜底规则之前").isEqualTo(0);
    }

    /** 不声明机器接口时注册器完全不被触碰，模块接口继续由兜底规则拒绝机器主体。 */
    @Test
    void withoutDeclaredMachineApisTheRegistryIsUntouched() {
        verifyNoInteractions(registry);
        assertThat(invoke("getOrder")).isEqualTo(0);
    }

    /**
     * 通过反射调用受保护方法，用于在测试中直接验证前缀拼装结果。
     *
     * @param name 方法名
     * @param argument 传入的相对路径
     * @return 拼装后的完整路径
     */
    private String invoke(String name, String argument) {
        return ReflectionTestUtils.invokeMethod(customizer, name, argument);
    }

    /**
     * 通过反射调用无参方法，用于读取排序序号。
     *
     * @param name 方法名
     * @return 方法返回值
     */
    private Object invoke(String name) {
        return ReflectionTestUtils.invokeMethod(customizer, name);
    }

}