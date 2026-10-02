package com.basicframework.framework.mybatis.config;

import java.util.List;
import java.util.concurrent.TimeUnit;

import org.apache.ibatis.annotations.Mapper;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.core.env.ConfigurableEnvironment;

import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.autoconfigure.MybatisPlusAutoConfiguration;
import com.baomidou.mybatisplus.core.handlers.MetaObjectHandler;
import com.baomidou.mybatisplus.core.incrementer.IKeyGenerator;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import com.baomidou.mybatisplus.extension.incrementer.DmKeyGenerator;
import com.baomidou.mybatisplus.extension.incrementer.H2KeyGenerator;
import com.baomidou.mybatisplus.extension.incrementer.KingbaseKeyGenerator;
import com.baomidou.mybatisplus.extension.incrementer.OracleKeyGenerator;
import com.baomidou.mybatisplus.extension.incrementer.PostgreKeyGenerator;
import com.baomidou.mybatisplus.extension.parser.JsqlParserGlobal;
import com.baomidou.mybatisplus.extension.parser.cache.JdkSerialCaffeineJsqlParseCache;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.fasterxml.jackson.databind.ObjectMapper;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.StrUtil;

/**
 * MyBaits 配置类
 *
 * @author 李杰
 */
@AutoConfiguration(before = MybatisPlusAutoConfiguration.class) // 目的：先于 MyBatis Plus 自动配置，避免 @MapperScan 可能扫描不到 Mapper 打印 warn 日志
@MapperScan(value = "${basic-framework.info.base-package}", annotationClass = Mapper.class, lazyInitialization = "${mybatis.lazy-initialization:false}") // Mapper 懒加载，目前仅用于单元测试
public class BasicFrameworkMybatisAutoConfiguration {

    static {
        // 动态 SQL 智能优化支持本地缓存加速解析，更完善的租户复杂 XML 动态 SQL 支持，静态注入缓存
        JsqlParserGlobal.setJsqlParseCache(new JdkSerialCaffeineJsqlParseCache(
                (cache) -> cache.maximumSize(1024)
                        .expireAfterWrite(5, TimeUnit.SECONDS)));
    }

    /**
     * 完成 mybatisPlusInterceptor 对应的业务处理。
     *
     * @return 方法处理结果
     */
    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor mybatisPlusInterceptor = new MybatisPlusInterceptor();
        mybatisPlusInterceptor.addInnerInterceptor(new PaginationInnerInterceptor()); // 分页插件
        return mybatisPlusInterceptor;
    }

    /**
     * 完成 defaultMetaObjectHandler 对应的业务处理。
     *
     * @return 方法处理结果
     */
    @Bean
    public MetaObjectHandler defaultMetaObjectHandler() {
        return new DefaultDBFieldHandler(); // 自动填充参数类
    }

    /**
     * 完成 keyGenerator 对应的业务处理。
     *
     * @param environment 运行环境配置
     * @return 方法处理结果
     */
    @Bean
    @ConditionalOnProperty(prefix = "mybatis-plus.global-config.db-config", name = "id-type", havingValue = "INPUT")
    public IKeyGenerator keyGenerator(ConfigurableEnvironment environment) {
        DbType dbType = IdTypeEnvironmentPostProcessor.getDbType(environment);
        if (dbType != null) {
            switch (dbType) {
                case POSTGRE_SQL:
                    return new PostgreKeyGenerator();
                case ORACLE:
                case ORACLE_12C:
                    return new OracleKeyGenerator();
                case H2:
                    return new H2KeyGenerator();
                case KINGBASE_ES:
                    return new KingbaseKeyGenerator();
                case DM:
                    return new DmKeyGenerator();
                default:
                    break;
            }
        }
        // 找不到合适的 IKeyGenerator 实现类
        throw new IllegalArgumentException(StrUtil.format("DbType{} 找不到合适的 IKeyGenerator 实现类", dbType));
    }

    /**
     * 完成 jacksonTypeHandler 对应的业务处理。
     *
     * @param objectMappers objectMappers参数
     * @return 方法处理结果
     */
    @Bean // 特殊：返回结果使用 Object 而不用 JacksonTypeHandler 的原因，避免因为 JacksonTypeHandler 被 mybatis 全局使用！
    public Object jacksonTypeHandler(List<ObjectMapper> objectMappers) {
        // 特殊：设置 JacksonTypeHandler 的 ObjectMapper！
        ObjectMapper objectMapper = CollUtil.getFirst(objectMappers);
        if (objectMapper == null) {
            objectMapper = JsonUtils.getObjectMapper();
        }
        JacksonTypeHandler.setObjectMapper(objectMapper);
        return new JacksonTypeHandler(Object.class);
    }

}
