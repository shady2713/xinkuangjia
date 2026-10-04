package com.basicframework.framework.common.util.json.databind;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.module.SimpleModule;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证基于时间戳的 LocalDateTime 序列化器的真实输出。
 *
 * <p>接口时间字段的默认形态是毫秒时间戳（前端按数字处理），只有显式声明
 * {@link JsonFormat} 的字段才输出格式化文本；字段名与 JSON 名不一致时还必须能按 JSON 名找回字段。
 * 这些规则一旦失效，前端会收到无法解析的时间格式，或让声明了格式的字段退回时间戳。
 * 用例用真实 {@link ObjectMapper} 序列化，断言最终 JSON 文本。</p>
 *
 * @author shady2713
 */
class TimestampLocalDateTimeSerializerTest {

    /** 未声明 JsonFormat 的字段必须输出毫秒时间戳。 */
    @Test
    void defaultFieldIsWrittenAsEpochMillis() throws Exception {
        ObjectMapper mapper = mapperWithSerializer();
        TimeHolder holder = new TimeHolder();
        holder.setCreatedAt(LocalDateTime.of(2024, 1, 2, 3, 4, 5));

        String json = mapper.writeValueAsString(holder);

        long expected = LocalDateTime.of(2024, 1, 2, 3, 4, 5)
                .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        assertThat(json).as("未声明格式的字段必须输出毫秒时间戳").contains("\"createdAt\":" + expected);
    }

    /** 声明了 JsonFormat 的字段必须按 pattern 输出文本，而不是时间戳。 */
    @Test
    void annotatedFieldIsWrittenWithConfiguredPattern() throws Exception {
        ObjectMapper mapper = mapperWithSerializer();
        TimeHolder holder = new TimeHolder();
        holder.setFormattedAt(LocalDateTime.of(2024, 1, 2, 3, 4, 5));

        String json = mapper.writeValueAsString(holder);

        assertThat(json).contains("\"formattedAt\":\"2024-01-02 03:04:05\"");
    }

    /**
     * JsonFormat 的 pattern 非法时必须回退到时间戳，而不是让序列化整体失败。
     *
     * <p>非法 pattern 来自配置错误；回退保证接口仍能返回可解析的时间，异常只记录告警。</p>
     */
    @Test
    void invalidPatternFallsBackToEpochMillis() throws Exception {
        ObjectMapper mapper = mapperWithSerializer();
        TimeHolder holder = new TimeHolder();
        holder.setInvalidPatternAt(LocalDateTime.of(2024, 1, 2, 3, 4, 5));

        String json = mapper.writeValueAsString(holder);

        long expected = LocalDateTime.of(2024, 1, 2, 3, 4, 5)
                .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        assertThat(json).contains("\"invalidPatternAt\":" + expected);
    }

    /** 字段名与 JSON 名不一致时，必须按 JSON 名找回字段并应用其 JsonFormat 声明。 */
    @Test
    void renamedFieldIsResolvedByJsonPropertyName() throws Exception {
        ObjectMapper mapper = mapperWithSerializer();
        TimeHolder holder = new TimeHolder();
        holder.setRenamedAt(LocalDateTime.of(2024, 5, 6, 7, 8, 9));

        String json = mapper.writeValueAsString(holder);

        assertThat(json).contains("\"renamed_at\":\"2024-05-06 07:08:09\"");
    }

    /** 顶层时间值的序列化必须输出秒级时间戳，证明序列化器本身可独立工作。 */
    @Test
    void topLevelValueIsWrittenAsEpochMillis() throws Exception {
        ObjectMapper mapper = mapperWithSerializer();

        String json = mapper.writeValueAsString(LocalDateTime.of(2024, 1, 2, 3, 4, 5));

        long expected = LocalDateTime.of(2024, 1, 2, 3, 4, 5)
                .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        assertThat(json).isEqualTo(String.valueOf(expected));
    }

    /** 构造只注册被测序列化器的真实 ObjectMapper。 */
    private static ObjectMapper mapperWithSerializer() {
        SimpleModule module = new SimpleModule();
        module.addSerializer(LocalDateTime.class, TimestampLocalDateTimeSerializer.INSTANCE);
        return new ObjectMapper().registerModule(module);
    }

    /**
     * 时间字段夹具，覆盖默认、格式化、非法格式与重命名四种声明。
     *
     * @author shady2713
     */
    public static class TimeHolder {

        /** 未声明格式的时间字段。 */
        private LocalDateTime createdAt;
        /** 声明了合法格式的时间字段。 */
        @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
        private LocalDateTime formattedAt;
        /** 声明了非法格式的时间字段。 */
        @JsonFormat(pattern = "DUMMY-INVALID-PATTERN")
        private LocalDateTime invalidPatternAt;
        /** 使用 JSON 属性名重命名的时间字段。 */
        @JsonProperty("renamed_at")
        @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
        private LocalDateTime renamedAt;

        /**
         * 获取默认时间字段。
         *
         * @return 时间
         */
        public LocalDateTime getCreatedAt() {
            return createdAt;
        }

        /**
         * 设置默认时间字段。
         *
         * @param createdAt 时间
         */
        public void setCreatedAt(LocalDateTime createdAt) {
            this.createdAt = createdAt;
        }

        /**
         * 获取格式化时间字段。
         *
         * @return 时间
         */
        public LocalDateTime getFormattedAt() {
            return formattedAt;
        }

        /**
         * 设置格式化时间字段。
         *
         * @param formattedAt 时间
         */
        public void setFormattedAt(LocalDateTime formattedAt) {
            this.formattedAt = formattedAt;
        }

        /**
         * 获取非法格式时间字段。
         *
         * @return 时间
         */
        public LocalDateTime getInvalidPatternAt() {
            return invalidPatternAt;
        }

        /**
         * 设置非法格式时间字段。
         *
         * @param invalidPatternAt 时间
         */
        public void setInvalidPatternAt(LocalDateTime invalidPatternAt) {
            this.invalidPatternAt = invalidPatternAt;
        }

        /**
         * 获取重命名时间字段。
         *
         * @return 时间
         */
        public LocalDateTime getRenamedAt() {
            return renamedAt;
        }

        /**
         * 设置重命名时间字段。
         *
         * @param renamedAt 时间
         */
        public void setRenamedAt(LocalDateTime renamedAt) {
            this.renamedAt = renamedAt;
        }
    }

}
