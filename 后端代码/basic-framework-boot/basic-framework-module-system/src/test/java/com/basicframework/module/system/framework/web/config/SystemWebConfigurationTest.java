package com.basicframework.module.system.framework.web.config;

import org.junit.jupiter.api.Test;
import org.springdoc.core.models.GroupedOpenApi;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 system 模块的 OpenAPI 分组注册结果。
 *
 * <p>分组名决定文档访问路径与接口归属，路径匹配决定 system 的管理端与应用端接口是否出现在文档中；
 * 两项写错都不会导致启动失败，只会在真实对接时发现文档缺接口。</p>
 *
 * @author shady2713
 */
class SystemWebConfigurationTest {

    /** 注册的分组必须命名 system，且同时匹配管理端与应用端前缀。 */
    @Test
    void registersSystemGroupedOpenApi() {
        try (AnnotationConfigApplicationContext context =
                     new AnnotationConfigApplicationContext(SystemWebConfiguration.class)) {
            GroupedOpenApi groupedOpenApi = context.getBean(GroupedOpenApi.class);

            assertThat(groupedOpenApi.getGroup()).isEqualTo("system");
            assertThat(groupedOpenApi.getPathsToMatch())
                    .as("system 的管理端与应用端接口都必须进入该分组")
                    .containsExactlyInAnyOrder("/admin-api/system/**", "/app-api/system/**");
        }
    }

}
