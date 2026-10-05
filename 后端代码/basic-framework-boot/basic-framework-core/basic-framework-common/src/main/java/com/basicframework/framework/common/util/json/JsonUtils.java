package com.basicframework.framework.common.util.json;

import cn.hutool.core.util.ArrayUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONUtil;
import com.basicframework.framework.common.util.json.databind.TimestampLocalDateTimeDeserializer;
import com.basicframework.framework.common.util.json.databind.TimestampLocalDateTimeSerializer;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.module.SimpleModule;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import lombok.Getter;
import lombok.SneakyThrows;
import lombok.extern.slf4j.Slf4j;

import java.io.IOException;
import java.lang.reflect.Type;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * JSON 工具类
 *
 * @author 李杰
 */
@Slf4j
public class JsonUtils {

    /** JSON 解析失败的日志模板：输入摘要 + 目标类型，不打印原文。 */
    private static final String LOG_PARSE_ERROR_TARGET = "json parse err,input:{} target:{}";

    @Getter
    private static ObjectMapper objectMapper = new ObjectMapper();

    static {
        objectMapper.configure(SerializationFeature.FAIL_ON_EMPTY_BEANS, false);
        objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        objectMapper.setSerializationInclusion(JsonInclude.Include.NON_NULL); // 忽略 null 值
        // 解决 LocalDateTime 的序列化
        SimpleModule simpleModule = new JavaTimeModule()
                .addSerializer(LocalDateTime.class, TimestampLocalDateTimeSerializer.INSTANCE)
                .addDeserializer(LocalDateTime.class, TimestampLocalDateTimeDeserializer.INSTANCE);
        objectMapper.registerModules(simpleModule);
    }

    /**
     * 初始化 objectMapper 属性
     * <p>
     * 通过这样的方式，使用 Spring 创建的 ObjectMapper Bean
     *
     * @param objectMapper ObjectMapper 对象
     */
    public static void init(ObjectMapper objectMapper) {
        JsonUtils.objectMapper = objectMapper;
    }

    /**
     * 将对象序列化为 JSON 字符串。
     *
     * @param object 待序列化对象
     * @return JSON 字符串
     */
    @SneakyThrows
    public static String toJsonString(Object object) {
        return objectMapper.writeValueAsString(object);
    }

    /**
     * 将对象序列化为 JSON 字节数组。
     *
     * @param object 待序列化对象
     * @return JSON 字节数组
     */
    @SneakyThrows
    public static byte[] toJsonByte(Object object) {
        return objectMapper.writeValueAsBytes(object);
    }

    /**
     * 将对象序列化为格式化后的 JSON 字符串。
     *
     * @param object 待序列化对象
     * @return 格式化后的 JSON 字符串
     */
    @SneakyThrows
    public static String toJsonPrettyString(Object object) {
        return objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(object);
    }

    /**
     * 将 JSON 字符串解析为指定类型对象。
     *
     * @param text JSON 字符串
     * @param clazz 目标类型
     * @return 目标类型对象；空字符串返回 null
     */
    public static <T> T parseObject(String text, Class<T> clazz) {
        if (StrUtil.isEmpty(text)) {
            return null;
        }
        try {
            return objectMapper.readValue(text, clazz);
        } catch (IOException e) {
            log.error(LOG_PARSE_ERROR_TARGET, summarizeInput(text), clazz.getName(), e);
            throw new RuntimeException(e);
        }
    }

    /**
     * 从 JSON 字符串指定一级节点解析为目标类型对象。
     *
     * @param text JSON 字符串
     * @param path 节点名称
     * @param clazz 目标类型
     * @return 目标类型对象；空字符串返回 null
     */
    public static <T> T parseObject(String text, String path, Class<T> clazz) {
        if (StrUtil.isEmpty(text)) {
            return null;
        }
        try {
            JsonNode treeNode = objectMapper.readTree(text);
            JsonNode pathNode = treeNode.path(path);
            return objectMapper.readValue(pathNode.toString(), clazz);
        } catch (IOException e) {
            log.error("json parse err,input:{} path:{} target:{}", summarizeInput(text), path, clazz.getName(), e);
            throw new RuntimeException(e);
        }
    }

    /**
     * 将 JSON 字符串解析为指定泛型类型对象。
     *
     * @param text JSON 字符串
     * @param type 目标类型
     * @return 目标类型对象；空字符串返回 null
     */
    public static <T> T parseObject(String text, Type type) {
        if (StrUtil.isEmpty(text)) {
            return null;
        }
        try {
            return objectMapper.readValue(text, objectMapper.getTypeFactory().constructType(type));
        } catch (IOException e) {
            log.error(LOG_PARSE_ERROR_TARGET, summarizeInput(text), type.getTypeName(), e);
            throw new RuntimeException(e);
        }
    }

    /**
     * 将 JSON 字节数组解析为指定泛型类型对象。
     *
     * @param text JSON 字节数组
     * @param type 目标类型
     * @return 目标类型对象；空数组返回 null
     */
    public static <T> T parseObject(byte[] text, Type type) {
        if (ArrayUtil.isEmpty(text)) {
            return null;
        }
        try {
            return objectMapper.readValue(text, objectMapper.getTypeFactory().constructType(type));
        } catch (IOException e) {
            log.error(LOG_PARSE_ERROR_TARGET, summarizeInput(text), type.getTypeName(), e);
            throw new RuntimeException(e);
        }
    }

    /**
     * 将字符串解析成指定类型的对象
     * 使用 {@link #parseObject(String, Class)} 时，在@JsonTypeInfo(use = JsonTypeInfo.Id.CLASS) 的场景下，
     * 如果 text 没有 class 属性，则会报错。此时，使用这个方法，可以解决。
     *
     * @param text 字符串
     * @param clazz 类型
     * @return 对象
     */
    public static <T> T parseObject2(String text, Class<T> clazz) {
        if (StrUtil.isEmpty(text)) {
            return null;
        }
        return JSONUtil.toBean(text, clazz);
    }

    /**
     * 将 JSON 字节数组解析为指定类型对象。
     *
     * @param bytes JSON 字节数组
     * @param clazz 目标类型
     * @return 目标类型对象；空数组返回 null
     */
    public static <T> T parseObject(byte[] bytes, Class<T> clazz) {
        if (ArrayUtil.isEmpty(bytes)) {
            return null;
        }
        try {
            return objectMapper.readValue(bytes, clazz);
        } catch (IOException e) {
            log.error(LOG_PARSE_ERROR_TARGET, summarizeInput(bytes), clazz.getName(), e);
            throw new RuntimeException(e);
        }
    }

    /**
     * 将 JSON 字符串解析为 TypeReference 指定的类型对象。
     *
     * @param text JSON 字符串
     * @param typeReference 目标类型引用
     * @return 目标类型对象
     */
    public static <T> T parseObject(String text, TypeReference<T> typeReference) {
        try {
            return objectMapper.readValue(text, typeReference);
        } catch (IOException e) {
            log.error("json parse err,input:{} typeReference:{}", summarizeInput(text), typeReference.getType(), e);
            throw new RuntimeException(e);
        }
    }

    /**
     * 解析 JSON 字符串成指定类型的对象，如果解析失败，则返回 null
     *
     * @param text 字符串
     * @param typeReference 类型引用
     * @return 指定类型的对象
     */
    public static <T> T parseObjectQuietly(String text, TypeReference<T> typeReference) {
        try {
            return objectMapper.readValue(text, typeReference);
        } catch (IOException e) {
            return null;
        }
    }

    /**
     * 将 JSON 字符串解析为指定元素类型列表。
     *
     * @param text JSON 字符串
     * @param clazz 目标元素类型
     * @return 目标元素类型列表；空字符串返回空列表
     */
    public static <T> List<T> parseArray(String text, Class<T> clazz) {
        if (StrUtil.isEmpty(text)) {
            return new ArrayList<>();
        }
        try {
            return objectMapper.readValue(text, objectMapper.getTypeFactory().constructCollectionType(List.class, clazz));
        } catch (IOException e) {
            log.error("json parse err,input:{} target:{}[]", summarizeInput(text), clazz.getName(), e);
            throw new RuntimeException(e);
        }
    }

    /**
     * 从 JSON 字符串指定一级节点解析为目标元素类型列表。
     *
     * @param text JSON 字符串
     * @param path 节点名称
     * @param clazz 目标元素类型
     * @return 目标元素类型列表；空字符串返回 null
     */
    public static <T> List<T> parseArray(String text, String path, Class<T> clazz) {
        if (StrUtil.isEmpty(text)) {
            return null;
        }
        try {
            JsonNode treeNode = objectMapper.readTree(text);
            JsonNode pathNode = treeNode.path(path);
            return objectMapper.readValue(pathNode.toString(), objectMapper.getTypeFactory().constructCollectionType(List.class, clazz));
        } catch (IOException e) {
            log.error("json parse err,input:{} path:{} target:{}[]", summarizeInput(text), path, clazz.getName(), e);
            throw new RuntimeException(e);
        }
    }

    /**
     * 将 JSON 字符串解析为 JsonNode 树。
     *
     * @param text JSON 字符串
     * @return JsonNode 树
     */
    public static JsonNode parseTree(String text) {
        try {
            return objectMapper.readTree(text);
        } catch (IOException e) {
            log.error("json parse err,input:{}", summarizeInput(text), e);
            throw new RuntimeException(e);
        }
    }

    /**
     * 将 JSON 字节数组解析为 JsonNode 树。
     *
     * @param text JSON 字节数组
     * @return JsonNode 树
     */
    public static JsonNode parseTree(byte[] text) {
        try {
            return objectMapper.readTree(text);
        } catch (IOException e) {
            log.error("json parse err,input:{}", summarizeInput(text), e);
            throw new RuntimeException(e);
        }
    }

    /**
     * 判断字符串是否为 JSON 对象或 JSON 数组。
     *
     * @param text 待判断字符串
     * @return 是否为 JSON 字符串
     */
    public static boolean isJson(String text) {
        return JSONUtil.isTypeJSON(text);
    }

    /**
     * 生成输入内容的安全摘要，仅保留类型或长度信息。
     */
    private static String summarizeInput(Object input) {
        if (input == null) {
            return "null";
        }
        if (input instanceof CharSequence sequence) {
            return "text(length=" + sequence.length() + ")";
        }
        if (input instanceof byte[] bytes) {
            return "bytes(length=" + bytes.length + ")";
        }
        return input.getClass().getName();
    }

    /**
     * 判断字符串是否为 JSON 类型的字符串
     *
     * @param str 字符串
     * @return 是否为 JSON 对象字符串
     */
    public static boolean isJsonObject(String str) {
        return JSONUtil.isTypeJSONObject(str);
    }

    /**
     * 将 Object 转换为目标类型
     * <p>
     * 避免先转 jsonString 再 parseObject 的性能损耗
     *
     * @param obj   源对象（可以是 Map、POJO 等）
     * @param clazz 目标类型
     * @return 转换后的对象
     */
    public static <T> T convertObject(Object obj, Class<T> clazz) {
        if (obj == null) {
            return null;
        }
        if (clazz.isInstance(obj)) {
            return clazz.cast(obj);
        }
        return objectMapper.convertValue(obj, clazz);
    }

    /**
     * 将 Object 转换为目标类型（支持泛型）
     *
     * @param obj           源对象
     * @param typeReference 目标类型引用
     * @return 转换后的对象
     */
    public static <T> T convertObject(Object obj, TypeReference<T> typeReference) {
        if (obj == null) {
            return null;
        }
        return objectMapper.convertValue(obj, typeReference);
    }

    /**
     * 将 Object 转换为 List 类型
     * <p>
     * 避免先转 jsonString 再 parseArray 的性能损耗
     *
     * @param obj   源对象（可以是 List、数组等）
     * @param clazz 目标元素类型
     * @return 转换后的 List
     */
    public static <T> List<T> convertList(Object obj, Class<T> clazz) {
        if (obj == null) {
            return new ArrayList<>();
        }
        return objectMapper.convertValue(obj, objectMapper.getTypeFactory().constructCollectionType(List.class, clazz));
    }

}
