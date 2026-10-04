package com.basicframework.framework.xss.core.json;

import com.basicframework.framework.xss.config.XssProperties;
import com.basicframework.framework.xss.core.clean.JsoupXssCleaner;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.exc.MismatchedInputException;
import com.fasterxml.jackson.databind.module.SimpleModule;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证 XSS 字符串反序列化器在各 JSON 取值形态下的真实过滤行为。
 *
 * <p>该反序列化器由 XSS 自动配置注册到全局 {@code String} 类型上，是请求体进入业务对象前
 * 的最后一道清洗，因此需要逐类取值锁定行为：普通字符串必须被清理；白名单 URL 必须原样放行
 * （回调、富文本等接口依赖该例外）；数值等标量按文本形态清理；数组与对象不是合法字符串形态，
 * 必须明确失败而不是静默返回未清理内容；二进制节点按 Base64 输出、其它内嵌对象按
 * {@code toString} 输出、内嵌对象为空时返回 null。</p>
 *
 * <p>这些分支同时覆盖 Jackson 对“非字符串取值”的兜底路径，避免未来替换父类实现时
 * 悄悄放宽为未清洗的原始文本。</p>
 *
 * @author shady2713
 */
class XssStringJsonDeserializerTest {

    /** 受测 XSS 配置，逐例重置排除 URL，避免用例间互相影响。 */
    private final XssProperties properties = new XssProperties();

    /** 注册了受测反序列化器的真实 ObjectMapper，驱动路径与自动配置一致。 */
    private ObjectMapper objectMapper;

    /** 建立受测反序列化器并清空请求上下文，避免上一例的请求残留影响白名单判断。 */
    @BeforeEach
    void setUp() {
        properties.setExcludeUrls(List.of());
        objectMapper = new ObjectMapper();
        SimpleModule module = new SimpleModule();
        module.addDeserializer(String.class, new XssStringJsonDeserializer(properties,
                new AntPathMatcher(), new JsoupXssCleaner()));
        objectMapper.registerModule(module);
        RequestContextHolder.resetRequestAttributes();
    }

    /** 清理请求上下文，避免线程复用把白名单请求带到其它用例。 */
    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    /** 普通字符串必须被清理，脚本标签与其内容整体移除。 */
    @Test
    void plainStringValueIsCleaned() throws Exception {
        assertThat(objectMapper.readValue("\"<script>alert(1)</script>\"", String.class)).isEmpty();
        assertThat(objectMapper.readValue("\"<img src=x onerror=alert(1)>abc\"", String.class))
                .as("事件属性必须被移除，文本内容保留").isEqualTo("<img>abc");
    }

    /** 命中排除 URL 的请求原样返回，便于回调与富文本接口保留原始内容。 */
    @Test
    void excludedUrlReturnsRawText() throws Exception {
        properties.setExcludeUrls(List.of("/app-api/notify/**"));
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/app-api/notify/callback");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        assertThat(objectMapper.readValue("\"<script>alert(1)</script>\"", String.class))
                .as("白名单 URL 必须原样返回，不得被清洗").isEqualTo("<script>alert(1)</script>");
    }

    /** 未命中排除 URL 的请求仍按普通规则清洗。 */
    @Test
    void nonExcludedUrlStillCleansText() throws Exception {
        properties.setExcludeUrls(List.of("/app-api/notify/**"));
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/app-api/order/create");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        assertThat(objectMapper.readValue("\"<script>alert(1)</script>\"", String.class)).isEmpty();
    }

    /** 数值等标量按文本形态清理，不因不是字符串而跳过清洗。 */
    @Test
    void scalarValueIsConvertedToTextAndCleaned() throws Exception {
        assertThat(objectMapper.readValue("123", String.class)).isEqualTo("123");
        assertThat(objectMapper.readValue("true", String.class)).isEqualTo("true");
    }

    /** 数组不是合法字符串形态，默认配置下必须明确失败而不是返回未清洗内容。 */
    @Test
    void arrayValueFailsByDefault() {
        assertThatThrownBy(() -> objectMapper.readValue("[\"a\"]", String.class))
                .isInstanceOf(MismatchedInputException.class);
    }

    /**
     * 开启单值数组解包后，元素仍会被清洗，不构成绕过。
     *
     * <p>该特性在生产配置中未开启（仓库内没有开启它的配置）。这里确认即使开启，
     * 解包由 {@code ObjectMapper} 在进入反序列化器前完成，清洗规则仍然生效，
     * 避免后续调整 Jackson 特性时误以为该路径已失去保护。</p>
     */
    @Test
    void arrayValueIsStillCleanedWhenSingleValueUnwrappingEnabled() throws Exception {
        ObjectMapper unwrappingMapper = objectMapper.copy()
                .enable(DeserializationFeature.UNWRAP_SINGLE_VALUE_ARRAYS);

        assertThat(unwrappingMapper.readValue("[\"<script>alert(1)</script>\"]", String.class))
                .as("解包后仍必须经过清洗").isEmpty();
    }

    /**
     * 对象取值当前静默变为 null，不报错。
     *
     * <p>该分支委托 {@code DeserializationContext#extractScalarFromObject}，当前实现对普通
     * JSON 输入返回 null，因此客户端把对象塞进字符串字段时不会收到参数错误，字段直接变空。
     * 这里锁定真实可观察结果；若后续改为拒绝该形态，本用例会失败并提示同步更新契约。</p>
     */
    @Test
    void objectValueYieldsNullInsteadOfFailing() throws Exception {
        assertThat(objectMapper.readValue("{\"a\":1}", String.class)).isNull();
    }

    /** 二进制节点按 Base64 输出，保证图片等二进制字段仍可读取。 */
    @Test
    void embeddedBinaryObjectIsEncodedAsBase64() throws Exception {
        JsonNode binaryNode = objectMapper.getNodeFactory().binaryNode(new byte[] {1, 2, 3});

        assertThat(objectMapper.treeToValue(binaryNode, String.class)).isEqualTo("AQID");
    }

    /** 其它内嵌对象按 toString 输出，保持父类既有兜底语义。 */
    @Test
    void embeddedPlainObjectFallsBackToToString() throws Exception {
        JsonNode pojoNode = objectMapper.getNodeFactory().pojoNode(new StringBuilder("abc"));

        assertThat(objectMapper.treeToValue(pojoNode, String.class)).isEqualTo("abc");
    }

    /** 内嵌对象为空时返回 null，不得抛异常。 */
    @Test
    void embeddedNullObjectYieldsNull() throws Exception {
        JsonNode pojoNode = objectMapper.getNodeFactory().pojoNode(null);

        assertThat(objectMapper.treeToValue(pojoNode, String.class)).isNull();
    }

    /**
     * 内嵌对象为空时必须返回 null，不得继续走类型转换。
     *
     * <p>JSON 文本无法产生“内嵌对象为 null”的取值，Jackson 的节点树转换又会在进入反序列化器前
     * 短路，因此这里用解析器替身提供该 token 组合，断言反序列化器自身的返回值语义。</p>
     */
    @Test
    void nullEmbeddedObjectReturnsNull() throws Exception {
        JsonParser parser = mock(JsonParser.class);
        when(parser.hasToken(JsonToken.VALUE_STRING)).thenReturn(false);
        when(parser.currentToken()).thenReturn(JsonToken.VALUE_EMBEDDED_OBJECT);
        when(parser.getEmbeddedObject()).thenReturn(null);

        assertThat(deserializer().deserialize(parser, mock(DeserializationContext.class))).isNull();
    }

    /**
     * 非取值 token 的兜底交给容器决定，并返回容器给出的结果。
     *
     * <p>真实容器对这类 token 一律抛出输入不匹配异常，返回路径无法在真实路径上完成；
     * 这里用容器替身确认反序列化器确实把目标类型与解析器交给容器裁决，并原样返回其结论，
     * 而不是自行吞掉或改写错误。</p>
     */
    @Test
    void unexpectedTokenDelegatesDecisionToContext() throws Exception {
        JsonParser parser = mock(JsonParser.class);
        when(parser.hasToken(JsonToken.VALUE_STRING)).thenReturn(false);
        when(parser.currentToken()).thenReturn(JsonToken.END_ARRAY);
        DeserializationContext context = mock(DeserializationContext.class);
        when(context.handleUnexpectedToken(String.class, parser)).thenReturn("容器兜底值");

        assertThat(deserializer().deserialize(parser, context)).isEqualTo("容器兜底值");
        verify(context).handleUnexpectedToken(String.class, parser);
    }

    /** 构造独立的反序列化器实例，用于直接驱动边界 token。 */
    private XssStringJsonDeserializer deserializer() {
        return new XssStringJsonDeserializer(properties, new AntPathMatcher(), new JsoupXssCleaner());
    }

    /** 当前 token 既非字符串也非标量取值时必须明确失败，不能返回未清洗内容。 */
    @Test
    void unexpectedTokenFails() throws Exception {
        JsonParser parser = objectMapper.getFactory().createParser("{\"name\":\"x\"}");
        parser.nextToken();
        parser.nextToken();
        assertThat(parser.currentToken()).as("解析器需停在字段名 token 上").isEqualTo(JsonToken.FIELD_NAME);

        assertThatThrownBy(() -> objectMapper.readValue(parser, String.class))
                .isInstanceOf(MismatchedInputException.class);
    }

}
