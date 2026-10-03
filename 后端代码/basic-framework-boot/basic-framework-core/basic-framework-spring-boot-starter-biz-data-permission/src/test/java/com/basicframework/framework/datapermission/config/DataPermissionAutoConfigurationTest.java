package com.basicframework.framework.datapermission.config;

import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.basicframework.framework.common.biz.system.permission.PermissionCommonApi;
import com.basicframework.framework.common.biz.system.permission.dto.DeptDataPermissionRespDTO;
import com.basicframework.framework.datapermission.core.aop.DataPermissionAnnotationAdvisor;
import com.basicframework.framework.datapermission.core.db.DataPermissionRuleHandler;
import com.basicframework.framework.datapermission.core.rule.DataPermissionRule;
import com.basicframework.framework.datapermission.core.rule.DataPermissionRuleFactory;
import com.basicframework.framework.datapermission.core.rule.DataPermissionRuleFactoryImpl;
import com.basicframework.framework.datapermission.core.rule.dept.DeptDataPermissionRule;
import com.basicframework.framework.datapermission.core.rule.dept.DeptDataPermissionRuleCustomizer;
import net.sf.jsqlparser.expression.Alias;
import net.sf.jsqlparser.expression.Expression;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证数据权限自动配置在有、无自定义规则两种装配下的真实行为。
 *
 * <p>部门规则按条件装配：未提供自定义器时不得凭空创建规则，
 * 否则所有表都会被套上默认的部门过滤，导致本不需要隔离的查询返回空集。</p>
 *
 * @author shady2713
 */
class DataPermissionAutoConfigurationTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(BasicFrameworkDataPermissionAutoConfiguration.class,
                    BasicFrameworkDeptDataPermissionAutoConfiguration.class));

    /** 每例从空上下文开始。 */
    @BeforeEach
    @AfterEach
    void clearRuleContext() {
        com.basicframework.framework.datapermission.core.aop.DataPermissionContextHolder.clear();
    }

    /**
     * 记录缺少 MyBatis Plus 拦截器时的装配结果。
     *
     * <p>数据权限处理器显式依赖 {@code MybatisPlusInterceptor}，缺少该 Bean 时整个上下文启动失败，
     * 而不是降级为“不启用数据权限”。该行为会让误配环境在启动期直接暴露，需锁定以防被改成静默跳过。</p>
     */
    @Test
    void missingMybatisPlusInterceptorFailsContextStartup() {
        contextRunner.run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure())
                    .hasMessageContaining("MybatisPlusInterceptor");
        });
    }

    /** 依赖齐备时必须提供规则工厂、处理器与注解切面。 */
    @Test
    void baseAutoConfigurationRegistersPipeline() {
        contextRunner.withBean(MybatisPlusInterceptor.class, MybatisPlusInterceptor::new)
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).hasSingleBean(DataPermissionRuleFactory.class);
                    assertThat(context).hasSingleBean(DataPermissionRuleHandler.class);
                    assertThat(context).hasSingleBean(DataPermissionAnnotationAdvisor.class);
                });
    }

    /**
     * 记录插件链被包装后的真实结构。
     *
     * <p>数据权限插件注册后会被 MyBatis Plus 包装为多表增强实现，
     * 内部仍持有原始数据权限插件并接入生产处理器。此处按实际类型断言，
     * 避免用具体实现类误判而假绿。</p>
     */
    @Test
    void dataPermissionPluginIsRegisteredIntoInterceptorChain() {
        contextRunner.withBean(MybatisPlusInterceptor.class, MybatisPlusInterceptor::new)
                .run(context -> {
                    MybatisPlusInterceptor interceptor = context.getBean(MybatisPlusInterceptor.class);
                    assertThat(interceptor.getInterceptors())
                            .as("拦截器链必须包含数据权限插件").hasSize(1);
                    Object plugin = interceptor.getInterceptors().get(0);
                    assertThat(plugin.getClass().getName())
                            .as("实际为包装类型，内部持有原始数据权限插件")
                            .contains("DataPermission");
                    assertThat(org.springframework.test.util.ReflectionTestUtils.getField(plugin, "dataPermissionHandler"))
                            .as("包装后必须仍接入生产处理器")
                            .isInstanceOf(DataPermissionRuleHandler.class);
                });
    }

    /**
     * 数据权限插件必须排在分页插件之前。
     * 顺序颠倒会让分页先统计再过滤，导致总数与分页结果不一致。
     */
    @Test
    void dataPermissionPluginPrecedesPaginationPlugin() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        interceptor.addInnerInterceptor(new com.baomidou.mybatisplus.extension.plugins.inner
                .PaginationInnerInterceptor(com.baomidou.mybatisplus.annotation.DbType.MYSQL));
        contextRunner.withBean(MybatisPlusInterceptor.class, () -> interceptor)
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(interceptor.getInterceptors()).hasSize(2);
                    assertThat(interceptor.getInterceptors().get(0).getClass().getName())
                            .as("数据权限必须先于分页改写 SQL，实际顺序=%s",
                                    interceptor.getInterceptors().stream().map(Object::getClass).toList())
                            .contains("DataPermission");
                    assertThat(interceptor.getInterceptors().get(1).getClass().getName())
                            .contains("Pagination");
                });
    }

    /** 重复装配不得叠加多个数据权限插件，否则同一条件会被重复追加。 */
    @Test
    void dataPermissionInterceptorIsNotDuplicated() {
        contextRunner.withBean(MybatisPlusInterceptor.class, MybatisPlusInterceptor::new)
                .withBean(DeptDataPermissionRuleCustomizer.class,
                        () -> rule -> rule.addDeptColumn("t_custom", "dept_id"))
                .withBean(PermissionCommonApi.class, DataPermissionAutoConfigurationTest::permissionApi)
                .run(context -> {
                    MybatisPlusInterceptor interceptor = context.getBean(MybatisPlusInterceptor.class);
                    assertThat(interceptor.getInterceptors())
                            .as("同一拦截器链只能有一个数据权限插件").hasSize(1);
                });
    }

    /** 未提供自定义器时不得创建部门规则，否则会误伤无数据权限的表。 */
    @Test
    void deptRuleIsAbsentWithoutCustomizer() {
        contextRunner.withBean(MybatisPlusInterceptor.class, MybatisPlusInterceptor::new)
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).doesNotHaveBean(DeptDataPermissionRule.class);
                });
    }

    /** 提供自定义器后必须创建部门规则，并应用自定义的表字段映射。 */
    @Test
    void deptRuleAppliesCustomizerColumns() {
        contextRunner.withBean(MybatisPlusInterceptor.class, MybatisPlusInterceptor::new)
                .withBean(DeptDataPermissionRuleCustomizer.class,
                        () -> rule -> rule.addDeptColumn("t_custom", "custom_dept_id"))
                .withBean(PermissionCommonApi.class, DataPermissionAutoConfigurationTest::permissionApi)
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    DeptDataPermissionRule rule = context.getBean(DeptDataPermissionRule.class);
                    assertThat(rule.getTableNames()).containsExactly("t_custom");
                });
    }

    /** 多个自定义器的字段映射必须全部生效。 */
    @Test
    void allCustomizersAreApplied() {
        contextRunner.withBean(MybatisPlusInterceptor.class, MybatisPlusInterceptor::new)
                .withBean("firstCustomizer", DeptDataPermissionRuleCustomizer.class,
                        () -> rule -> rule.addDeptColumn("t_first", "dept_id"))
                .withBean("secondCustomizer", DeptDataPermissionRuleCustomizer.class,
                        () -> rule -> rule.addUserColumn("t_second", "owner_id"))
                .withBean(PermissionCommonApi.class, DataPermissionAutoConfigurationTest::permissionApi)
                .run(context -> {
                    DeptDataPermissionRule rule = context.getBean(DeptDataPermissionRule.class);
                    assertThat(rule.getTableNames()).containsExactlyInAnyOrder("t_first", "t_second");
                });
    }

    /** 规则工厂必须返回容器中登记的全部规则。 */
    @Test
    void factoryExposesRegisteredRules() {
        contextRunner.withBean(MybatisPlusInterceptor.class, MybatisPlusInterceptor::new)
                .withBean(DeptDataPermissionRuleCustomizer.class,
                        () -> rule -> rule.addDeptColumn("t_custom", "dept_id"))
                .withBean(PermissionCommonApi.class, DataPermissionAutoConfigurationTest::permissionApi)
                .run(context -> {
                    DataPermissionRuleFactory factory = context.getBean(DataPermissionRuleFactory.class);
                    assertThat(factory).isInstanceOf(DataPermissionRuleFactoryImpl.class);
                    assertThat(factory.getDataPermissionRules())
                            .as("已创建的部门规则必须进入工厂")
                            .hasSize(1)
                            .allMatch(DataPermissionRule.class::isInstance);
                    assertThat(context.getBean(DataPermissionRuleFactory.class).getDataPermissionRules().get(0))
                            .as("工厂持有的必须是容器中的同一个规则实例")
                            .isSameAs(context.getBean(DeptDataPermissionRule.class));
                });
    }

    /**
     * 记录无登录态时部门规则的表达式为空。
     * 装配正确不等于过滤生效，该断言把切面装配与实际过滤行为关联起来。
     */
    @Test
    void deptRuleProducesNoConditionWithoutLoginUser() {
        contextRunner.withBean(MybatisPlusInterceptor.class, MybatisPlusInterceptor::new)
                .withBean(DeptDataPermissionRuleCustomizer.class,
                        () -> rule -> rule.addDeptColumn("t_custom", "dept_id"))
                .withBean(PermissionCommonApi.class, DataPermissionAutoConfigurationTest::permissionApi)
                .run(context -> {
                    DeptDataPermissionRule rule = context.getBean(DeptDataPermissionRule.class);
                    Expression expression = rule.getExpression("t_custom", new Alias("c"));
                    assertThat(expression).as("无登录态时不得追加条件").isNull();
                });
    }

    /** 权限接口替身：仅用于满足装配，不参与本组断言。 */
    private static PermissionCommonApi permissionApi() {
        return new PermissionCommonApi() {

            /** 返回空范围。 */
            @Override
            public DeptDataPermissionRespDTO getDeptDataPermission(Long userId) {
                return new DeptDataPermissionRespDTO();
            }

            /** 装配占位。 */
            @Override
            public boolean hasAnyPermissions(Long userId, String... permissions) {
                return true;
            }

            /** 装配占位。 */
            @Override
            public boolean hasAnyRoles(Long userId, String... roles) {
                return true;
            }
        };
    }

    /** 保留显式配置类引用，确保自定义器 Bean 的注册方式与生产一致。 */
    @Configuration(proxyBeanMethods = false)
    static class UnusedConfiguration {

        /** 占位 Bean，避免测试类被误认为需要装配。 */
        @Bean
        List<DataPermissionRule> noRules() {
            return List.of();
        }
    }
}
