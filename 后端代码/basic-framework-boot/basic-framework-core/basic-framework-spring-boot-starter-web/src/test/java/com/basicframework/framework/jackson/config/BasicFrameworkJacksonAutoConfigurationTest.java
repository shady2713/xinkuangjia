package com.basicframework.framework.jackson.config;

import com.basicframework.framework.common.util.json.JsonUtils;
import com.fasterxml.jackson.databind.Module;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 Jackson 自动配置下发的全局序列化规则。
 *
 * <p>这些规则决定前端看到的时间与长整型形态：Long 必须以字符串输出以避免 JavaScript 精度丢失，
 * LocalDateTime 默认输出毫秒时间戳、LocalDate/LocalTime 输出标准文本。规则同时通过
 * Builder 定制器与 Module 两个入口下发，任一处遗漏都会让部分 ObjectMapper 行为不一致，
 * 因此用例分别构造真实 ObjectMapper 并断言序列化文本。</p>
 *
 * @author shady2713
 */
class BasicFrameworkJacksonAutoConfigurationTest {

    /** 进入用例前的全局 ObjectMapper，结束后还原，避免污染同 JVM 的其它测试。 */
    private final ObjectMapper previousJsonUtilsMapper = JsonUtils.getObjectMapper();

    /** 还原 JsonUtils 的静态映射器。 */
    @AfterEach
    void restoreJsonUtils() {
        JsonUtils.init(previousJsonUtilsMapper);
    }

    /** Builder 定制器必须让 Long 以字符串输出，避免前端精度丢失。 */
    @Test
    void builderCustomizerWritesLongAsString() {
        Jackson2ObjectMapperBuilder builder = new Jackson2ObjectMapperBuilder();
        new BasicFrameworkJacksonAutoConfiguration().ldtEpochMillisCustomizer().customize(builder);

        ObjectMapper mapper = builder.build();

        assertThat(mapper.convertValue(9007199254740993L, Object.class)).as("超出安全整数范围的编号必须以文本保留精度")
                .isEqualTo("9007199254740993");
        assertThat(writeValue(mapper, 9007199254740993L)).as("Long 必须序列化为字符串").isEqualTo("\"9007199254740993\"");
    }

    /** Builder 定制器必须让三种时间类型按约定输出。 */
    @Test
    void builderCustomizerWritesJavaTimeTypes() {
        Jackson2ObjectMapperBuilder builder = new Jackson2ObjectMapperBuilder();
        new BasicFrameworkJacksonAutoConfiguration().ldtEpochMillisCustomizer().customize(builder);
        // Spring Boot 默认关闭时间戳数组形态，这里显式对齐该默认值后再核对文本格式
        builder.featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        ObjectMapper mapper = builder.build();

        long expectedMillis = LocalDateTime.of(2024, 1, 2, 3, 4, 5)
                .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        assertThat(writeValue(mapper, LocalDateTime.of(2024, 1, 2, 3, 4, 5)))
                .as("LocalDateTime 默认输出毫秒时间戳").isEqualTo(String.valueOf(expectedMillis));
        assertThat(writeValue(mapper, LocalDate.of(2024, 1, 2))).isEqualTo("\"2024-01-02\"");
        assertThat(writeValue(mapper, LocalTime.of(3, 4, 5))).isEqualTo("\"03:04:05\"");
    }

    /**
     * 以 Bean 形式暴露的 Module 必须与 Builder 定制器给出同一套时间与数值规则。
     *
     * <p>该 Module 会被 Spring Boot 注册到所有 ObjectMapper，缺少它时通过 Module 装配的
     * 映射器会退回默认行为（Long 输出数字、时间输出数组）。</p>
     */
    @Test
    void timestampSupportModuleMatchesBuilderRules() {
        Module module = new BasicFrameworkJacksonAutoConfiguration().timestampSupportModuleBean();
        ObjectMapper mapper = new ObjectMapper().registerModule(module)
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

        long expectedMillis = LocalDateTime.of(2024, 1, 2, 3, 4, 5)
                .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        assertThat(module.getModuleName()).isEqualTo("TimestampSupportModule");
        assertThat(writeValue(mapper, 9007199254740993L)).isEqualTo("\"9007199254740993\"");
        assertThat(writeValue(mapper, LocalDateTime.of(2024, 1, 2, 3, 4, 5))).isEqualTo(String.valueOf(expectedMillis));
        assertThat(writeValue(mapper, LocalDate.of(2024, 1, 2))).isEqualTo("\"2024-01-02\"");
        assertThat(writeValue(mapper, LocalTime.of(3, 4, 5))).isEqualTo("\"03:04:05\"");
    }

    /** Module 必须同时注册反序列化规则，保证时间与日期能从文本读回。 */
    @Test
    void timestampSupportModuleReadsJavaTimeTypes() throws Exception {
        Module module = new BasicFrameworkJacksonAutoConfiguration().timestampSupportModuleBean();
        ObjectMapper mapper = new ObjectMapper().registerModule(module)
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

        assertThat(mapper.readValue("\"2024-01-02\"", LocalDate.class)).isEqualTo(LocalDate.of(2024, 1, 2));
        assertThat(mapper.readValue("\"03:04:05\"", LocalTime.class)).isEqualTo(LocalTime.of(3, 4, 5));
        long millis = LocalDateTime.of(2024, 1, 2, 3, 4, 5)
                .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        assertThat(mapper.readValue(String.valueOf(millis), LocalDateTime.class))
                .as("毫秒时间戳必须能读回为本地时间").isEqualTo(LocalDateTime.of(2024, 1, 2, 3, 4, 5));
    }

    /** 初始化入口必须把容器提供的 ObjectMapper 交给全局 JsonUtils，使工具方法与容器规则一致。 */
    @Test
    void jsonUtilsBeanAdoptsContainerObjectMapper() {
        Jackson2ObjectMapperBuilder builder = new Jackson2ObjectMapperBuilder();
        new BasicFrameworkJacksonAutoConfiguration().ldtEpochMillisCustomizer().customize(builder);
        ObjectMapper containerMapper = builder.build();

        JsonUtils jsonUtils = new BasicFrameworkJacksonAutoConfiguration().jsonUtils(containerMapper);

        assertThat(jsonUtils).as("初始化入口必须返回实例以作为 Bean 注册").isNotNull();
        assertThat(JsonUtils.getObjectMapper()).as("JsonUtils 必须改用容器提供的映射器").isSameAs(containerMapper);
        assertThat(JsonUtils.toJsonString(9007199254740993L)).as("工具方法必须遵循容器规则")
                .isEqualTo("\"9007199254740993\"");
    }

    /** 用真实 ObjectMapper 序列化并返回 JSON 文本。 */
    private static String writeValue(ObjectMapper mapper, Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (Exception failure) {
            throw new IllegalStateException("序列化失败: " + value, failure);
        }
    }

}
