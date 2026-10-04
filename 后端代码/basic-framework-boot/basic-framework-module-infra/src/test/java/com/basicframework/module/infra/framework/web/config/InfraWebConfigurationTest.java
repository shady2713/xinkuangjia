package com.basicframework.module.infra.framework.web.config;

import org.junit.jupiter.api.Test;
import org.springdoc.core.models.GroupedOpenApi;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 infra 模块的 OpenAPI 分组注册结果。
 *
 * <p>分组名决定文档访问路径与接口归属；路径匹配决定 infra 的管理端与应用端接口是否出现在文档中。
 * 两项写错都不会导致启动失败，只会在真实对接时发现文档缺接口，因此这里用真实上下文断言分组配置。</p>
 *
 * @author shady2713
 */
class InfraWebConfigurationTest {

    /** 注册的分组必须命名 infra，且同时匹配管理端与应用端前缀。 */
    @Test
    void registersInfraGroupedOpenApi() {
        try (AnnotationConfigApplicationContext context =
                     new AnnotationConfigApplicationContext(InfraWebConfiguration.class)) {
            GroupedOpenApi groupedOpenApi = context.getBean(GroupedOpenApi.class);

            assertThat(groupedOpenApi.getGroup()).isEqualTo("infra");
            assertThat(groupedOpenApi.getPathsToMatch())
                    .as("infra 的管理端与应用端接口都必须进入该分组")
                    .containsExactlyInAnyOrder("/admin-api/infra/**", "/app-api/infra/**");
        }
    }

}
