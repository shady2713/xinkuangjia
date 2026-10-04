package com.basicframework.framework.common.util.json.databind;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.StringWriter;
import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 校验超长整数的 JSON 序列化口径：安全范围内输出数字，超过 JavaScript 安全整数范围输出字符串。
 *
 * <p>前端 JavaScript 的 {@code Number} 只能精确表示 ±(2^53-1)，超出后接收大整数会静默丢精度，
 * 因此长整型主键必须序列化为字符串。这里的边界是刻意保守的：绝对值等于 2^53-1 时已经输出
 * 字符串，只有严格位于安全范围内部的取值才输出 JSON 数字，测试同时锁定“字符串可原样还原
 * 为 Long”这一关键性质，避免换算或截断造成主键错位。</p>
 *
 * @author shady2713
 */
class NumberSerializerTest {

    /** JavaScript 可精确表示的最大整数 2^53-1，按当前口径序列化为字符串。 */
    private static final long MAX_SAFE_INTEGER = 9007199254740991L;

    /** JavaScript 可精确表示的最小整数 -(2^53-1)，按当前口径序列化为字符串。 */
    private static final long MIN_SAFE_INTEGER = -9007199254740991L;

    /** 安全范围内的整数必须输出 JSON 数字，保持与前端数值比较一致的语义。 */
    @Test
    void valuesInsideSafeRangeAreWrittenAsJsonNumbers() throws IOException {
        assertThat(serialize(NumberSerializer.INSTANCE, 123L)).isEqualTo("123");
        assertThat(serialize(NumberSerializer.INSTANCE, -1L)).isEqualTo("-1");
        assertThat(serialize(NumberSerializer.INSTANCE, 0L)).isEqualTo("0");
        assertThat(serialize(NumberSerializer.INSTANCE, 1)).isEqualTo("1");
        assertThat(serialize(NumberSerializer.INSTANCE, new BigDecimal("123"))).isEqualTo("123");
        assertThat(serialize(NumberSerializer.INSTANCE, 1.5D)).as("范围内的小数仍输出数字").isEqualTo("1.5");
    }

    /** 安全范围边界必须输出字符串：等于 ±(2^53-1) 已不在内部区间。 */
    @Test
    void safeRangeBoundariesAreWrittenAsJsonStrings() throws IOException {
        assertThat(serialize(NumberSerializer.INSTANCE, MAX_SAFE_INTEGER))
                .as("等于 2^53-1 时按保守口径输出字符串").isEqualTo("\"" + MAX_SAFE_INTEGER + "\"");
        assertThat(serialize(NumberSerializer.INSTANCE, MIN_SAFE_INTEGER))
                .as("等于 -(2^53-1) 时按保守口径输出字符串").isEqualTo("\"" + MIN_SAFE_INTEGER + "\"");
        assertThat(serialize(NumberSerializer.INSTANCE, MAX_SAFE_INTEGER - 1))
                .as("严格位于安全范围内则输出数字").isEqualTo(String.valueOf(MAX_SAFE_INTEGER - 1));
        assertThat(serialize(NumberSerializer.INSTANCE, MIN_SAFE_INTEGER + 1))
                .isEqualTo(String.valueOf(MIN_SAFE_INTEGER + 1));
    }

    /** 超出 Long 范围之外的长整型取值必须输出字符串，且字符串能原样还原，不丢精度。 */
    @Test
    void longExtremesAreWrittenAsLosslessJsonStrings() throws IOException {
        String maxJson = serialize(NumberSerializer.INSTANCE, Long.MAX_VALUE);
        String minJson = serialize(NumberSerializer.INSTANCE, Long.MIN_VALUE);

        assertThat(maxJson).isEqualTo("\"" + Long.MAX_VALUE + "\"");
        assertThat(minJson).isEqualTo("\"" + Long.MIN_VALUE + "\"");
        assertThat(Long.parseLong(unquote(maxJson))).as("字符串必须可无损还原").isEqualTo(Long.MAX_VALUE);
        assertThat(Long.parseLong(unquote(minJson))).isEqualTo(Long.MIN_VALUE);
    }

    /** 共享实例与按原始类型构造的实例必须给出完全一致的序列化结果。 */
    @Test
    void sharedInstanceAgreesWithConstructedInstance() throws IOException {
        NumberSerializer constructed = new NumberSerializer(Number.class);

        for (Number value : new Number[]{0L, 1, -1L, 1.5D, MAX_SAFE_INTEGER, Long.MIN_VALUE}) {
            assertThat(serialize(constructed, value))
                    .as("取值 %s 的输出必须与 INSTANCE 一致", value)
                    .isEqualTo(serialize(NumberSerializer.INSTANCE, value));
        }
    }

    /** 去除 JSON 字符串外围引号，便于把结果还原为真实数值。 */
    private static String unquote(String json) {
        return json.substring(1, json.length() - 1);
    }

    /**
     * 用真实 JSON 生成器执行序列化并返回生成的 JSON 文本。
     *
     * @param serializer 待验证的数字序列化器
     * @param value 待序列化的数字
     * @return 生成的 JSON 片段
     * @throws IOException JSON 生成器创建或写入失败时抛出
     */
    private static String serialize(NumberSerializer serializer, Number value) throws IOException {
        ObjectMapper mapper = new ObjectMapper();
        StringWriter writer = new StringWriter();
        try (JsonGenerator generator = mapper.getFactory().createGenerator(writer)) {
            serializer.serialize(value, generator, mapper.getSerializerProviderInstance());
        }
        return writer.toString();
    }
}
