package com.basicframework.framework.xss.core.json;

import com.basicframework.framework.common.util.servlet.ServletUtils;
import com.basicframework.framework.xss.config.XssProperties;
import com.basicframework.framework.xss.core.clean.XssCleaner;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.deser.std.StringDeserializer;
import jakarta.servlet.http.HttpServletRequest;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.util.PathMatcher;

import java.io.IOException;

/**
 * XSS 过滤 jackson 反序列化器。
 * 在反序列化的过程中，会对字符串进行 XSS 过滤。
 *
 * @author shady
 */
@Slf4j
@AllArgsConstructor
public class XssStringJsonDeserializer extends StringDeserializer {

    /**
     * 属性
     */
    private final XssProperties properties;
    /**
     * 路径匹配器
     */
    private final PathMatcher pathMatcher;

    private final XssCleaner xssCleaner;

    /**
     * 将 JSON 输入反序列化为目标 Java 对象。
     *
     * @param p p 参数
     * @param ctxt ctxt 参数
     * @return 方法处理结果
     * @throws IOException 底层处理失败时抛出
     */
    @Override
    public String deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
        // 1. 非 HTTP 请求上下文（如 Redis、异步任务或单元测试直接反序列化）不执行 XSS 清洗，避免破坏内部数据。
        HttpServletRequest request = ServletUtils.getRequest();
        if (request == null) {
            return super.deserialize(p, ctxt);
        }
        String uri = request.getRequestURI();
        if (properties.getExcludeUrls().stream().anyMatch(excludeUrl -> pathMatcher.match(excludeUrl, uri))) {
            return super.deserialize(p, ctxt);
        }

        // 2. 真正使用 xssCleaner 进行过滤
        if (p.hasToken(JsonToken.VALUE_STRING)) {
            return xssCleaner.clean(p.getText());
        }
        JsonToken t = p.currentToken();
        // [databind#381]
        if (t == JsonToken.START_ARRAY) {
            return _deserializeFromArray(p, ctxt);
        }
        // need to gracefully handle byte[] data, as base64
        if (t == JsonToken.VALUE_EMBEDDED_OBJECT) {
            Object ob = p.getEmbeddedObject();
            if (ob == null) {
                return null;
            }
            if (ob instanceof byte[]) {
                return ctxt.getBase64Variant().encode((byte[]) ob, false);
            }
            // otherwise, try conversion using toString()...
            return ob.toString();
        }
        // 29-Jun-2020, tatu: New! "Scalar from Object" (mostly for XML)
        if (t == JsonToken.START_OBJECT) {
            return ctxt.extractScalarFromObject(p, this, _valueClass);
        }

        if (t.isScalarValue()) {
            String text = p.getValueAsString();
            return xssCleaner.clean(text);
        }
        return (String) ctxt.handleUnexpectedToken(_valueClass, p);
    }
}

