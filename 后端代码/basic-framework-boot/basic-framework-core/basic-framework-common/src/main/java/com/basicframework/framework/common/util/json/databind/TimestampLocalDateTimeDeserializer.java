package com.basicframework.framework.common.util.json.databind;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;

import java.io.IOException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;

/**
 * 基于时间戳的 LocalDateTime 反序列化器
 *
 * @author 李杰
 */
public class TimestampLocalDateTimeDeserializer extends JsonDeserializer<LocalDateTime> {

    public static final TimestampLocalDateTimeDeserializer INSTANCE = new TimestampLocalDateTimeDeserializer();

    /**
     * 将 JSON 输入反序列化为目标 Java 对象。
     *
     * @param p p 参数
     * @param ctxt ctxt 参数
     * @return 方法处理结果
     * @throws IOException 底层处理失败时抛出
     */
    @Override
    public LocalDateTime deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
        if (p.currentToken() == JsonToken.VALUE_NUMBER_INT) {
            // 将 Long 时间戳转换为 LocalDateTime，兼容后端既有接口约定。
            return parseTimestamp(p.getLongValue());
        }
        if (p.currentToken() == JsonToken.VALUE_STRING) {
            String value = p.getText();
            if (value == null || value.trim().isEmpty()) {
                return null;
            }
            // 兼容前端日期控件常见的字符串格式，避免字符串被 getValueAsLong() 误读为 0 后写入 1970。
            return parseText(value.trim());
        }
        return parseTimestamp(p.getValueAsLong());
    }

    /**
     * 解析Timestamp。
     */
    private LocalDateTime parseTimestamp(long timestamp) {
        return LocalDateTime.ofInstant(Instant.ofEpochMilli(timestamp), ZoneId.systemDefault());
    }

    /**
     * 按「yyyy-MM-dd HH:mm:ss → ISO → 带时区 ISO → 纯日期」顺序试探解析。
     *
     * @param value 待解析文本
     * @return 解析出的本地日期时间
     * @throws IOException 全部格式都解析失败时抛出，并保留最后一次失败原因
     */
    @SuppressWarnings("PMD.GenericExceptionSwallowed") // 多格式试探链：前几种格式不被接受属预期分支，最后一次失败会抛出 IOException，不是静默吞噬。
    private LocalDateTime parseText(String value) throws IOException {
        if (value.matches("^-?\\d+$")) {
            return parseTimestamp(Long.parseLong(value));
        }
        try {
            return LocalDateTime.parse(value, DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        } catch (DateTimeParseException ignored) {
            // 继续尝试 ISO 格式，兼容 2026-06-17T12:00:00 这类值。
        }
        try {
            return LocalDateTime.parse(value, DateTimeFormatter.ISO_LOCAL_DATE_TIME);
        } catch (DateTimeParseException ignored) {
            // 继续尝试带时区 ISO 格式，兼容浏览器 Date 序列化后的值。
        }
        try {
            return OffsetDateTime.parse(value, DateTimeFormatter.ISO_OFFSET_DATE_TIME)
                    .atZoneSameInstant(ZoneId.systemDefault())
                    .toLocalDateTime();
        } catch (DateTimeParseException ignored) {
            // 继续尝试纯日期格式。
        }
        try {
            return LocalDate.parse(value, DateTimeFormatter.ISO_LOCAL_DATE).atStartOfDay();
        } catch (Exception ex) {
            throw new IOException("无法解析日期时间: " + value, ex);
        }
    }

}
