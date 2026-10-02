package com.basicframework.framework.common.util.json.databind;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.SerializerProvider;
import com.fasterxml.jackson.databind.annotation.JacksonStdImpl;

import java.io.IOException;

/**
 * Long 序列化规则
 *
 * 会将超长 long 值转换为 string，解决前端 JavaScript 最大安全整数是 2^53-1 的问题
 *
 * @author 李杰
 */
@JacksonStdImpl
public class NumberSerializer extends com.fasterxml.jackson.databind.ser.std.NumberSerializer {

    private static final long MAX_SAFE_INTEGER = 9007199254740991L;
    private static final long MIN_SAFE_INTEGER = -9007199254740991L;

    public static final NumberSerializer INSTANCE = new NumberSerializer(Number.class);

    /**
     * 创建数字序列化器。
     *
     * @param rawType 数字原始类型
     */
    public NumberSerializer(Class<? extends Number> rawType) {
        super(rawType);
    }

    /**
     * 序列化数字，超过 JavaScript 安全整数范围时输出字符串。
     *
     * @param value 数字值
     * @param gen JSON 生成器
     * @param serializers 序列化上下文
     * @throws IOException JSON 写入失败时抛出
     */
    @Override
    public void serialize(Number value, JsonGenerator gen, SerializerProvider serializers) throws IOException {
        // 超出安全整数范围时序列化为字符串，避免前端精度丢失。
        if (value.longValue() > MIN_SAFE_INTEGER && value.longValue() < MAX_SAFE_INTEGER) {
            super.serialize(value, gen, serializers);
        } else {
            gen.writeString(value.toString());
        }
    }
}
