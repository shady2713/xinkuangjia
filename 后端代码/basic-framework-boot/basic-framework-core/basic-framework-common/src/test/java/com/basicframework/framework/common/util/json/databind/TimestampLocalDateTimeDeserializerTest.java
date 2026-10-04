package com.basicframework.framework.common.util.json.databind;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.module.SimpleModule;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证基于时间戳的 LocalDateTime 反序列化器对各种入参形态的真实解析结果。
 *
 * <p>前端提交的时间形态并不统一：可能是毫秒时间戳、{@code yyyy-MM-dd HH:mm:ss} 文本、
 * ISO 文本、带时区的 ISO 文本或纯日期。逐个兼容是刻意的设计；解析错误的时间会直接写库，
 * 因此用例对每种形态断言解析出的真实时间，并锁定失败方式（非法文本必须显式报错，
 * 不能被当成 0 而写入 1970）。</p>
 *
 * @author shady2713
 */
class TimestampLocalDateTimeDeserializerTest {

    /** 时间戳数字必须按系统时区转换为本地时间。 */
    @Test
    void numericTimestampIsParsedBySystemZone() throws Exception {
        long millis = LocalDateTime.of(2024, 1, 2, 3, 4, 5)
                .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();

        TimeHolder holder = read("{\"time\":" + millis + "}");

        assertThat(holder.getTime()).isEqualTo(LocalDateTime.of(2024, 1, 2, 3, 4, 5));
    }

    /** 空白字符串必须解析为 null，不得落到 1970 纪元时间。 */
    @Test
    void blankStringIsParsedAsNull() throws Exception {
        assertThat(read("{\"time\":\"\"}").getTime()).isNull();
        assertThat(read("{\"time\":\"   \"}").getTime()).isNull();
    }

    /** 数字文本与时间戳数字等价，兼容前端把时间戳放在字符串里传输。 */
    @Test
    void numericTextIsParsedAsTimestamp() throws Exception {
        long millis = LocalDateTime.of(2023, 12, 31, 23, 59, 58)
                .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();

        assertThat(read("{\"time\":\"" + millis + "\"}").getTime())
                .isEqualTo(LocalDateTime.of(2023, 12, 31, 23, 59, 58));
    }

    /** 日期控件常用的文本格式必须被解析。 */
    @Test
    void commonTextFormatsAreParsed() throws Exception {
        assertThat(read("{\"time\":\"2024-01-02 03:04:05\"}").getTime())
                .isEqualTo(LocalDateTime.of(2024, 1, 2, 3, 4, 5));
        assertThat(read("{\"time\":\"2024-01-02T03:04:05\"}").getTime())
                .as("ISO 本地时间格式必须被解析").isEqualTo(LocalDateTime.of(2024, 1, 2, 3, 4, 5));
        assertThat(read("{\"time\":\"2024-01-02T03:04:05+08:00\"}").getTime())
                .as("带时区的时间必须换算到系统时区")
                .isEqualTo(LocalDateTime.ofInstant(Instant.parse("2024-01-01T19:04:05Z"), ZoneId.systemDefault()));
        assertThat(read("{\"time\":\"2024-01-02\"}").getTime())
                .as("纯日期按当天零点解析").isEqualTo(LocalDateTime.of(2024, 1, 2, 0, 0));
    }

    /** 非法文本必须显式报错，避免被静默当成 0 写入 1970。 */
    @Test
    void invalidTextFailsInsteadOfWritingEpoch() {
        assertThatThrownBy(() -> read("{\"time\":\"DUMMY-NOT-A-DATE\"}"))
                .isInstanceOf(IOException.class).hasMessageContaining("无法解析日期时间");
        assertThatThrownBy(() -> read("{\"time\":\"2024-13-45 99:99:99\"}"))
                .isInstanceOf(IOException.class).hasMessageContaining("无法解析日期时间");
    }

    /**
     * 既非数字也非字符串的 token 被当成毫秒时间戳解析，得到纪元附近的时间。
     *
     * <p>这是可观察的真实行为：布尔入参不会报错，{@code true} 被当成 1 毫秒、{@code false}
     * 被当成 0 毫秒，结果是 1970-01-01 而不是失败。用例按真实行为断言并作为待处理发现记录，
     * 提醒调用方在接口模型上限定时间字段类型或在反序列化层拒绝该 token。</p>
     */
    @Test
    void nonNumericNonTextTokenFallsBackToEpochMillis() throws Exception {
        assertThat(read("{\"time\":true}").getTime())
                .isEqualTo(LocalDateTime.ofInstant(Instant.ofEpochMilli(1), ZoneId.systemDefault()));
        assertThat(read("{\"time\":false}").getTime())
                .as("false 被当成 0 毫秒").isEqualTo(LocalDateTime.ofInstant(Instant.ofEpochMilli(0), ZoneId.systemDefault()));
    }

    /** 用只注册被测反序列化器的真实 ObjectMapper 读取时间字段。 */
    private static TimeHolder read(String json) throws Exception {
        SimpleModule module = new SimpleModule();
        module.addDeserializer(LocalDateTime.class, TimestampLocalDateTimeDeserializer.INSTANCE);
        ObjectMapper mapper = new ObjectMapper().registerModule(module);
        return mapper.readValue(json, TimeHolder.class);
    }

    /**
     * 时间字段夹具，用于承载反序列化结果。
     *
     * @author shady2713
     */
    public static class TimeHolder {

        /** 待解析的时间字段。 */
        private LocalDateTime time;

        /**
         * 获取时间。
         *
         * @return 时间
         */
        public LocalDateTime getTime() {
            return time;
        }

        /**
         * 设置时间。
         *
         * @param time 时间
         */
        public void setTime(LocalDateTime time) {
            this.time = time;
        }
    }

}
