package com.basicframework.framework.swagger.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import io.swagger.v3.oas.models.parameters.Parameter;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.junit.jupiter.api.Test;
import org.springdoc.core.customizers.OperationCustomizer;
import org.springdoc.core.models.GroupedOpenApi;
import org.springdoc.core.properties.SpringDocConfigProperties;
import org.springdoc.core.service.OpenAPIService;
import org.springdoc.core.service.SecurityService;
import org.springdoc.core.utils.PropertyResolverUtils;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.http.HttpHeaders;
import org.springframework.web.method.HandlerMethod;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * 验证 Swagger 自动配置产出的文档元信息、安全方案、分组匹配与自定义处理器的真实契约。
 *
 * <p>这些 Bean 决定在线接口文档的内容：文档标题与联系人写错会让对接方找不到维护入口，
 * 安全方案或分组路径写错会让调试页面缺少认证头、或把接口归到错误分组。用例直接调用配置类的
 * 工厂方法并用真实 OpenAPI／GroupedOpenApi 模型断言产出，再对真实
 * {@link HandlerMethod} 执行分组注册的两个自定义处理器，核对可观察的文档结果。</p>
 *
 * <p>OpenAPI 服务构造所需的 Springdoc 协作者中，只有无法在单测里廉价构造的
 * {@link SecurityService} 使用替身，用于证明参数按声明顺序转发；其余均使用真实实现。</p>
 *
 * @author shady2713
 */
class BasicFrameworkSwaggerAutoConfigurationTest {

    /** 被测自动配置实例，方法本身无状态。 */
    private static final BasicFrameworkSwaggerAutoConfiguration CONFIGURATION =
            new BasicFrameworkSwaggerAutoConfiguration();

    /** 文档元信息必须完整映射到 OpenAPI 的 info、contact 与 license。 */
    @Test
    void createApiCarriesInfoContactAndLicense() {
        OpenAPI openAPI = CONFIGURATION.createApi(properties());

        Info info = openAPI.getInfo();
        assertThat(info.getTitle()).isEqualTo("DUMMY-文档标题");
        assertThat(info.getDescription()).isEqualTo("DUMMY-文档描述");
        assertThat(info.getVersion()).isEqualTo("1.0.0-DUMMY");
        Contact contact = info.getContact();
        assertThat(contact.getName()).isEqualTo("DUMMY-AUTHOR");
        assertThat(contact.getUrl()).isEqualTo("https://example.com/DUMMY-DOC");
        assertThat(contact.getEmail()).isEqualTo("DUMMY-AUTHOR@example.com");
        License license = info.getLicense();
        assertThat(license.getName()).isEqualTo("DUMMY-LICENSE");
        assertThat(license.getUrl()).isEqualTo("https://example.com/DUMMY-LICENSE");
    }

    /** 安全方案必须是 Authorization 请求头形式的 API Key，并成为全局安全要求。 */
    @Test
    void createApiDeclaresAuthorizationApiKeyRequirement() {
        OpenAPI openAPI = CONFIGURATION.createApi(properties());

        Map<String, SecurityScheme> schemes = openAPI.getComponents().getSecuritySchemes();
        assertThat(schemes).containsOnlyKeys(HttpHeaders.AUTHORIZATION);
        SecurityScheme scheme = schemes.get(HttpHeaders.AUTHORIZATION);
        assertThat(scheme.getType()).isEqualTo(SecurityScheme.Type.APIKEY);
        assertThat(scheme.getName()).isEqualTo(HttpHeaders.AUTHORIZATION);
        assertThat(scheme.getIn()).isEqualTo(SecurityScheme.In.HEADER);

        List<SecurityRequirement> requirements = openAPI.getSecurity();
        assertThat(requirements).as("显式认证项与按方案名追加的认证项都必须存在").hasSize(2);
        assertThat(requirements).allSatisfy(requirement ->
                assertThat(requirement.keySet()).containsExactly(HttpHeaders.AUTHORIZATION));
    }

    /** 分组必须同时匹配管理端与应用端前缀，并注册认证头与 operationId 两个处理器。 */
    @Test
    void buildGroupedOpenApiMatchesBothApiPrefixesAndCustomizesOperations() {
        GroupedOpenApi grouped = BasicFrameworkSwaggerAutoConfiguration.buildGroupedOpenApi("system");

        assertThat(grouped.getGroup()).isEqualTo("system");
        assertThat(grouped.getPathsToMatch())
                .containsExactly("/admin-api/system/**", "/app-api/system/**");
        assertThat(grouped.getOperationCustomizers()).hasSize(2);

        Operation operation = new Operation();
        for (OperationCustomizer customizer : grouped.getOperationCustomizers()) {
            operation = customizer.customize(operation, handlerMethod(SwaggerProbeController.class, "list"));
        }

        assertThat(operation.getOperationId()).as("operationId 必须为 类名前缀_方法名")
                .isEqualTo("SwaggerProbe_list");
        assertThat(operation.getParameters()).hasSize(1);
        Parameter parameter = operation.getParameters().get(0);
        assertThat(parameter.getName()).isEqualTo(HttpHeaders.AUTHORIZATION);
        assertThat(parameter.getIn()).isEqualTo(String.valueOf(SecurityScheme.In.HEADER));
        assertThat(parameter.getDescription()).isEqualTo("认证 Token");
        assertThat(parameter.getSchema().getDefault()).isEqualTo("Bearer CHANGE_ME_TOKEN");
        assertThat(parameter.getSchema().getName()).isEqualTo(HttpHeaders.AUTHORIZATION);
    }

    /** 类名不以 Controller 结尾时不得截断类名，operationId 仍由类名与方法名组合。 */
    @Test
    void buildGroupedOpenApiKeepsClassNameWithoutControllerSuffix() {
        GroupedOpenApi grouped = BasicFrameworkSwaggerAutoConfiguration.buildGroupedOpenApi("probe", "probe");

        assertThat(grouped.getPathsToMatch()).containsExactly("/admin-api/probe/**", "/app-api/probe/**");
        Operation operation = new Operation();
        for (OperationCustomizer customizer : grouped.getOperationCustomizers()) {
            operation = customizer.customize(operation, handlerMethod(SwaggerProbe.class, "list"));
        }

        assertThat(operation.getOperationId()).isEqualTo("SwaggerProbe_list");
    }

    /** all 分组必须覆盖全部模块：分组名固定为 all，路径前缀按空路径拼接。 */
    @Test
    void allGroupedOpenApiUsesAllGroupName() {
        GroupedOpenApi grouped = CONFIGURATION.allGroupedOpenApi();

        assertThat(grouped.getGroup()).isEqualTo("all");
        assertThat(grouped.getPathsToMatch())
                .as("all 分组以空路径拼接前缀，这是当前实现的真实取值")
                .containsExactly("/admin-api//**", "/app-api//**");
    }

    /** OpenAPI 服务必须按声明顺序接收协作者，避免把安全解析器或配置装错位置。 */
    @Test
    void openApiBuilderForwardsCollaboratorsInDeclaredOrder() {
        SecurityService securityService = mock(SecurityService.class);
        SpringDocConfigProperties configProperties = new SpringDocConfigProperties();
        PropertyResolverUtils propertyResolverUtils = new PropertyResolverUtils(
                new DefaultListableBeanFactory(), new StaticMessageSource(), configProperties);

        OpenAPIService service = CONFIGURATION.openApiBuilder(Optional.empty(), securityService, configProperties,
                propertyResolverUtils, Optional.empty(), Optional.empty(), Optional.empty());

        assertThat(service).isNotNull();
        assertThat(service.getSecurityParser()).as("安全解析器必须按位置转发").isSameAs(securityService);
    }

    /** 构造字段齐全的文档配置。 */
    private static SwaggerProperties properties() {
        SwaggerProperties properties = new SwaggerProperties();
        properties.setTitle("DUMMY-文档标题");
        properties.setDescription("DUMMY-文档描述");
        properties.setAuthor("DUMMY-AUTHOR");
        properties.setVersion("1.0.0-DUMMY");
        properties.setUrl("https://example.com/DUMMY-DOC");
        properties.setEmail("DUMMY-AUTHOR@example.com");
        properties.setLicense("DUMMY-LICENSE");
        properties.setLicenseUrl("https://example.com/DUMMY-LICENSE");
        return properties;
    }

    /** 用真实控制器方法构造处理器方法。 */
    private static HandlerMethod handlerMethod(Class<?> beanType, String methodName) {
        try {
            Object bean = beanType.getDeclaredConstructor().newInstance();
            return new HandlerMethod(bean, beanType.getMethod(methodName));
        } catch (ReflectiveOperationException failure) {
            throw new IllegalStateException("探针控制器不可用", failure);
        }
    }

    /**
     * 带 Controller 后缀的探针控制器。
     *
     * @author shady2713
     */
    public static class SwaggerProbeController {

        /** 探针方法，仅用于取方法名。 */
        public void list() {
        }
    }

    /**
     * 不带 Controller 后缀的探针类。
     *
     * @author shady2713
     */
    public static class SwaggerProbe {

        /** 探针方法，仅用于取方法名。 */
        public void list() {
        }
    }

}
