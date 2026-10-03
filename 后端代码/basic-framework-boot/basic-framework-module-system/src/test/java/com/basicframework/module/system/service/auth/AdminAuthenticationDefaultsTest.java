package com.basicframework.module.system.service.auth;

import com.basicframework.framework.common.api.config.ConfigApi;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.module.system.controller.admin.auth.vo.AuthRegisterReqVO;
import com.basicframework.module.system.dal.mysql.user.AdminUserMapper;
import com.basicframework.module.system.framework.auth.config.AdminAuthenticationProperties;
import com.basicframework.module.system.service.user.AdminUserService;
import com.basicframework.module.system.service.user.AdminUserServiceImpl;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;
import org.springframework.test.util.ReflectionTestUtils;

import static com.basicframework.module.system.enums.ErrorCodeConstants.AUTH_SHARE_LOGIN_DISABLED;
import static com.basicframework.module.system.enums.ErrorCodeConstants.USER_REGISTER_DISABLED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 验证未配置的认证入口失败关闭，历史数据库开关不能绕过部署默认。 */
class AdminAuthenticationDefaultsTest {

    /** 缺省和显式启用均经过真实 Spring 属性绑定。 */
    @Test
    void bindsClosedDefaultsAndExplicitOptIn() {
        ApplicationContextRunner runner = new ApplicationContextRunner().withUserConfiguration(Binding.class);
        runner.run(context -> {
            AdminAuthenticationProperties properties = context.getBean(AdminAuthenticationProperties.class);
            assertThat(properties.isRegistrationEnabled()).isFalse();
        });
        runner.withPropertyValues("basic-framework.auth.registration-enabled=true").run(context -> {
                    AdminAuthenticationProperties properties = context.getBean(AdminAuthenticationProperties.class);
                    assertThat(properties.isRegistrationEnabled()).isTrue();
                });
    }

    /** 关闭分享登录时，连有效票据的数据库查询也不得发生。 */
    @Test
    void closedShareLoginRejectsBeforeReadingTicket() {
        AdminAuthServiceImpl service = new AdminAuthServiceImpl();
        assertThatThrownBy(() -> service.shareLogin("ignored-ticket"))
                .isInstanceOfSatisfying(ServiceException.class,
                        exception -> assertThat(exception.getCode()).isEqualTo(AUTH_SHARE_LOGIN_DISABLED.getCode()));
    }

    /** 关闭注册的认证入口在验证码及用户写入之前拒绝请求。 */
    @Test
    void closedRegistrationRejectsBeforeUserCreation() {
        AdminAuthServiceImpl service = new AdminAuthServiceImpl();
        AdminUserService users = mock(AdminUserService.class);
        ReflectionTestUtils.setField(service, "userService", users);
        ReflectionTestUtils.setField(service, "authenticationProperties", new AdminAuthenticationProperties());
        assertThatThrownBy(() -> service.register(new AuthRegisterReqVO()))
                .isInstanceOfSatisfying(ServiceException.class,
                        exception -> assertThat(exception.getCode()).isEqualTo(USER_REGISTER_DISABLED.getCode()));
        verifyNoInteractions(users);
    }

    /** 历史库中开启的注册项不能绕过部署关闭状态或直接调用用户 Service。 */
    @Test
    void databaseFlagCannotOverrideClosedDeployment() {
        AdminUserServiceImpl service = new AdminUserServiceImpl();
        ConfigApi config = mock(ConfigApi.class);
        AdminUserMapper users = mock(AdminUserMapper.class);
        when(config.getConfigValueByKey("system.user.register-enabled")).thenReturn("true");
        ReflectionTestUtils.setField(service, "configApi", config);
        ReflectionTestUtils.setField(service, "userMapper", users);
        ReflectionTestUtils.setField(service, "authenticationProperties", new AdminAuthenticationProperties());
        assertThatThrownBy(() -> service.registerUser(new AuthRegisterReqVO()))
                .isInstanceOfSatisfying(ServiceException.class,
                        exception -> assertThat(exception.getCode()).isEqualTo(USER_REGISTER_DISABLED.getCode()));
        verifyNoInteractions(users);
    }

    /** 只加载待验证的属性绑定，避免应用依赖掩盖缺省行为。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(AdminAuthenticationProperties.class)
    static class Binding {
    }
}
