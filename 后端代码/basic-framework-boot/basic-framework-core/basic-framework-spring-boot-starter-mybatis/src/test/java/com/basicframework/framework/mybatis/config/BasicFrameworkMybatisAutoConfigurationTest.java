package com.basicframework.framework.mybatis.config;

import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import com.baomidou.mybatisplus.extension.incrementer.DmKeyGenerator;
import com.baomidou.mybatisplus.extension.incrementer.H2KeyGenerator;
import com.baomidou.mybatisplus.extension.incrementer.KingbaseKeyGenerator;
import com.baomidou.mybatisplus.extension.incrementer.OracleKeyGenerator;
import com.baomidou.mybatisplus.extension.incrementer.PostgreKeyGenerator;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证 MyBatis 自动配置注册的拦截器、填充器、主键生成器与 JSON 类型处理器。
 *
 * <p>这些 Bean 是 MyBatis Plus 与项目约定之间的适配层：缺失分页拦截器会让分页查询不执行 count、
 * 总数恒为假；填充器缺失会让审计字段为空；主键生成器选错会让 Oracle/PostgreSQL 这类
 * 非自增数据库插入失败；Jackson 类型处理器绑定错 ObjectMapper 会让数据库里的 JSON 字段
 * 与接口返回的时间、数值格式不一致。因此这里逐项断言真实类型与真实解析结果。</p>
 *
 * @author shady2713
 */
class BasicFrameworkMybatisAutoConfigurationTest {

    /** 进入用例前的全局 ObjectMapper，结束后还原，避免污染同 JVM 的其它测试。 */
    private final ObjectMapper previousJsonUtilsMapper = JsonUtils.getObjectMapper();

    /** 还原全局 ObjectMapper 与类型处理器的静态绑定。 */
    @AfterEach
    void restoreStaticBindings() {
        JsonUtils.init(previousJsonUtilsMapper);
        JacksonTypeHandler.setObjectMapper(previousJsonUtilsMapper);
    }

    /** 分页拦截器必须真实注册，否则所有分页查询的总数都不可信。 */
    @Test
    void mybatisPlusInterceptorRegistersPagination() {
        MybatisPlusInterceptor interceptor = new BasicFrameworkMybatisAutoConfiguration().mybatisPlusInterceptor();

        assertThat(interceptor.getInterceptors()).hasSize(1);
        assertThat(interceptor.getInterceptors().get(0)).isInstanceOf(PaginationInnerInterceptor.class);
    }

    /** 默认填充器必须是项目实现，缺失会让审计字段与时间字段全部为空。 */
    @Test
    void defaultMetaObjectHandlerIsProjectHandler() {
        assertThat(new BasicFrameworkMybatisAutoConfiguration().defaultMetaObjectHandler())
                .isInstanceOf(DefaultDBFieldHandler.class);
    }

    /** 非自增数据库必须按真实 URL 方言选择对应的主键生成器。 */
    @Test
    void keyGeneratorFollowsDataSourceDialect() {
        BasicFrameworkMybatisAutoConfiguration configuration = new BasicFrameworkMybatisAutoConfiguration();

        assertThat(configuration.keyGenerator(environment("jdbc:h2:mem:basic_framework")))
                .isInstanceOf(H2KeyGenerator.class);
        assertThat(configuration.keyGenerator(environment("jdbc:postgresql://127.0.0.1:5432/basic_framework")))
                .isInstanceOf(PostgreKeyGenerator.class);
        assertThat(configuration.keyGenerator(environment("jdbc:oracle:thin:@127.0.0.1:1521:xe")))
                .isInstanceOf(OracleKeyGenerator.class);
        assertThat(configuration.keyGenerator(environment("jdbc:kingbase8://127.0.0.1:54321/basic_framework")))
                .isInstanceOf(KingbaseKeyGenerator.class);
        assertThat(configuration.keyGenerator(environment("jdbc:dm://127.0.0.1:5236")))
                .isInstanceOf(DmKeyGenerator.class);
    }

    /**
     * 自增数据库或未配置主数据源时必须显式失败。
     *
     * <p>MySQL 等自增数据库使用 INPUT 主键策略会插入失败；返回空生成器或默认生成器都会掩盖配置错误，
     * 因此在启动期直接抛错，让问题在装配阶段暴露。</p>
     */
    @Test
    void keyGeneratorRejectsDialectsWithoutGenerator() {
        BasicFrameworkMybatisAutoConfiguration configuration = new BasicFrameworkMybatisAutoConfiguration();

        assertThatThrownBy(() -> configuration.keyGenerator(environment("jdbc:mysql://127.0.0.1:3306/basic_framework")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("找不到合适的 IKeyGenerator 实现类").hasMessageContaining("MYSQL");
        MockEnvironment withoutPrimary = new MockEnvironment();
        assertThatThrownBy(() -> configuration.keyGenerator(withoutPrimary))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("找不到合适的 IKeyGenerator 实现类");
    }

    /** 容器提供 ObjectMapper 时必须绑定它，并用它真实解析 JSON 列。 */
    @Test
    void jacksonTypeHandlerBindsContainerObjectMapper() {
        ObjectMapper containerMapper = new ObjectMapper();

        Object handler = new BasicFrameworkMybatisAutoConfiguration().jacksonTypeHandler(List.of(containerMapper));

        assertThat(handler).isInstanceOf(JacksonTypeHandler.class);
        assertThat(JacksonTypeHandler.getObjectMapper()).as("必须绑定容器里的 ObjectMapper")
                .isSameAs(containerMapper);
        assertThat(((JacksonTypeHandler) handler).parse("{\"name\":\"张三\",\"age\":30}"))
                .isEqualTo(java.util.Map.of("name", "张三", "age", 30));
    }

    /** 容器没有 ObjectMapper 时必须回退到全局 JsonUtils 的映射器，不能留空导致解析失败。 */
    @Test
    void jacksonTypeHandlerFallsBackToJsonUtils() {
        ObjectMapper globalMapper = new ObjectMapper();
        JsonUtils.init(globalMapper);

        Object handler = new BasicFrameworkMybatisAutoConfiguration().jacksonTypeHandler(List.of());

        assertThat(handler).isInstanceOf(JacksonTypeHandler.class);
        assertThat(JacksonTypeHandler.getObjectMapper()).as("必须回退到全局 JsonUtils 的映射器")
                .isSameAs(globalMapper);
        assertThat(((JacksonTypeHandler) handler).parse("{\"enabled\":true}"))
                .isEqualTo(java.util.Map.of("enabled", true));
    }

    /**
     * 构造带主数据源 URL 的运行环境，模拟生产动态数据源配置。
     *
     * @param url 主数据源连接串
     * @return 可供主键生成器读取的运行环境
     */
    private static MockEnvironment environment(String url) {
        return new MockEnvironment()
                .withProperty("spring.datasource.dynamic.primary", "master")
                .withProperty("spring.datasource.dynamic.datasource.master.url", url);
    }

}
