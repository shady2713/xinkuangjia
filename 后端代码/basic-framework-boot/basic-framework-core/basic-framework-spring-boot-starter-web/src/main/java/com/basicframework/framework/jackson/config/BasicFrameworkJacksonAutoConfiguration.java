package com.basicframework.framework.jackson.config;

import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.framework.common.util.json.databind.NumberSerializer;
import com.basicframework.framework.common.util.json.databind.TimestampLocalDateTimeDeserializer;
import com.basicframework.framework.common.util.json.databind.TimestampLocalDateTimeSerializer;
import com.fasterxml.jackson.databind.Module;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.module.SimpleModule;
import com.fasterxml.jackson.datatype.jsr310.deser.LocalDateDeserializer;
import com.fasterxml.jackson.datatype.jsr310.deser.LocalTimeDeserializer;
import com.fasterxml.jackson.datatype.jsr310.ser.LocalDateSerializer;
import com.fasterxml.jackson.datatype.jsr310.ser.LocalTimeSerializer;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.boot.autoconfigure.jackson.JacksonAutoConfiguration;
import org.springframework.context.annotation.Bean;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;

/**
 * Jackson 自动配置补充：为项目全局约定的序列化/反序列化场景提供统一行为
 *
 * 1. 统一 Long 精度处理，避免前后端数值精度丢失
 * 2. 统一 LocalDate / LocalTime / LocalDateTime 的时间格式策略
 * 3. 初始化 JsonUtils，复用工程内统一的对象映射能力
 *
 * @author 李杰
 */
@AutoConfiguration(after = JacksonAutoConfiguration.class)
@Slf4j
public class BasicFrameworkJacksonAutoConfiguration {

    /**
     * 构建 Jackson 对象映射器时的统一定制。
     * <p>
     * 这里通过 Builder 的 {@code serializerByType/deserializerByType} 下发序列化规则，
     * 相比直接处理 {@code handledType} 更易于组合，也更符合 Spring Boot 的扩展习惯。
     *
     * @return Jackson2ObjectMapperBuilderCustomizer
     */
    @Bean
    public Jackson2ObjectMapperBuilderCustomizer ldtEpochMillisCustomizer() {
        return builder -> builder
                // Long -> Number
                .serializerByType(Long.class, NumberSerializer.INSTANCE)
                .serializerByType(Long.TYPE, NumberSerializer.INSTANCE)
                // LocalDate / LocalTime
                .serializerByType(LocalDate.class, LocalDateSerializer.INSTANCE)
                .deserializerByType(LocalDate.class, LocalDateDeserializer.INSTANCE)
                .serializerByType(LocalTime.class, LocalTimeSerializer.INSTANCE)
                .deserializerByType(LocalTime.class, LocalTimeDeserializer.INSTANCE)
                // LocalDateTime < - > EpochMillis
                .serializerByType(LocalDateTime.class, TimestampLocalDateTimeSerializer.INSTANCE)
                .deserializerByType(LocalDateTime.class, TimestampLocalDateTimeDeserializer.INSTANCE);
    }

    /**
     * 以 Bean 形式暴露 Module（Boot 会自动注册到所有 ObjectMapper）
     *
     * @return 时间与数值序列化兼容的 Jackson 模块
     */
    @Bean
    public Module timestampSupportModuleBean() {
        SimpleModule m = new SimpleModule("TimestampSupportModule");
        // Long -> Number，避免前端精度丢失
        m.addSerializer(Long.class, NumberSerializer.INSTANCE);
        m.addSerializer(Long.TYPE, NumberSerializer.INSTANCE);
        // LocalDate / LocalTime
        m.addSerializer(LocalDate.class, LocalDateSerializer.INSTANCE);
        m.addDeserializer(LocalDate.class, LocalDateDeserializer.INSTANCE);
        m.addSerializer(LocalTime.class, LocalTimeSerializer.INSTANCE);
        m.addDeserializer(LocalTime.class, LocalTimeDeserializer.INSTANCE);
        // LocalDateTime < - > EpochMillis
        m.addSerializer(LocalDateTime.class, TimestampLocalDateTimeSerializer.INSTANCE);
        m.addDeserializer(LocalDateTime.class, TimestampLocalDateTimeDeserializer.INSTANCE);
        return m;
    }

    /**
     * 初始化全局 JsonUtils，直接使用主 ObjectMapper
     *
     * @param objectMapper 框架注入的主 ObjectMapper
     * @return 初始化后的 JsonUtils 实例
     */
    @Bean
    @SuppressWarnings("InstantiationOfUtilityClass")
    public JsonUtils jsonUtils(ObjectMapper objectMapper) {
        JsonUtils.init(objectMapper);
        log.debug("[init][初始化 JsonUtils 成功]");
        return new JsonUtils();
    }

}
