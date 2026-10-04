package com.basicframework.framework.common.util.servlet;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.nio.charset.StandardCharsets;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 Servlet 工具类的响应写出、请求读取与请求信息提取契约。
 *
 * <p>这些方法是过滤器、拦截器与异常处理链的公共入口：JSON 写出编码错误会让前端解析失败，
 * 请求体读取与 Content-Type 判定不一致会让日志与验签拿到空内容，请求头/参数收集遗漏会影响
 * 网关与审计。因此用例断言响应字节、读取到的字符串与集合内容，而不是只断言方法被调用。</p>
 *
 * @author shady2713
 */
class ServletUtilsTest {

    /** 清理线程绑定的请求上下文，避免污染同 JVM 的其它测试。 */
    @AfterEach
    void clearRequestContext() {
        RequestContextHolder.resetRequestAttributes();
    }

    /**
     * 工具类未声明私有构造，实例化不得改变静态入口的行为。
     *
     * <p>该类没有实例状态，构造方法属于真实可调用面；断言实例化后静态读取仍按同一规则工作。</p>
     */
    @Test
    void instantiationKeepsStaticEntryBehaviour() {
        new ServletUtils();
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("User-Agent", "DUMMY-UA");

        assertThat(ServletUtils.getUserAgent(request)).isEqualTo("DUMMY-UA");
    }

    /**
     * 当前线程绑定真实请求上下文时，无参入口必须读取该请求的信息。
     *
     * <p>过滤器与拦截器依赖线程绑定的请求做日志与审计；上下文存在却读不到请求会让日志缺少
     * User-Agent 与客户端地址，也会掩盖真实调用来源。</p>
     */
    @Test
    void contextBoundRequestIsUsedByNoArgEntries() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("User-Agent", "DUMMY-CONTEXT-UA");
        request.setRemoteAddr("192.0.2.20");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        assertThat(ServletUtils.getUserAgent()).isEqualTo("DUMMY-CONTEXT-UA");
        assertThat(ServletUtils.getClientIP()).isEqualTo("192.0.2.20");
    }

    /** JSON 写出必须带 UTF-8 内容类型，响应体是可被前端直接解析的 JSON 文本。 */
    @Test
    void writeJSONWritesUtf8JsonBody() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        ServletUtils.writeJSON(response, Map.of("name", "张三"));

        assertThat(response.getContentType()).isEqualTo(MediaType.APPLICATION_JSON_UTF8_VALUE);
        assertThat(response.getContentAsString()).as("中文不得乱码").contains("张三");
        assertThat(response.getContentAsByteArray()).isEqualTo(response.getContentAsString().getBytes(StandardCharsets.UTF_8));
    }

    /** 请求头缺少 User-Agent 时返回空串，存在时原样返回。 */
    @Test
    void getUserAgentFallsBackToEmptyString() {
        MockHttpServletRequest withoutHeader = new MockHttpServletRequest();
        MockHttpServletRequest withHeader = new MockHttpServletRequest();
        withHeader.addHeader("User-Agent", "DUMMY-UA");

        assertThat(ServletUtils.getUserAgent(withoutHeader)).as("缺失请求头必须返回空串而不是 null").isEmpty();
        assertThat(ServletUtils.getUserAgent(withHeader)).isEqualTo("DUMMY-UA");
    }

    /** 无请求上下文时从当前线程读取的请求信息必须为 null，而不是沿用上一请求的值。 */
    @Test
    void contextEntriesReturnNullWithoutRequest() {
        assertThat(ServletUtils.getUserAgent()).as("无请求上下文时不得返回残留的 User-Agent").isNull();
        assertThat(ServletUtils.getClientIP()).as("无请求上下文时不得返回残留的客户端地址").isNull();
    }

    /** Content-Type 判定必须忽略大小写并识别 JSON 后缀类型。 */
    @Test
    void isJsonRequestMatchesJsonContentTypes() {
        MockHttpServletRequest json = new MockHttpServletRequest();
        json.setContentType("application/json;charset=UTF-8");
        MockHttpServletRequest upperCase = new MockHttpServletRequest();
        upperCase.setContentType("Application/JSON");
        MockHttpServletRequest form = new MockHttpServletRequest();
        form.setContentType(MediaType.APPLICATION_FORM_URLENCODED_VALUE);
        MockHttpServletRequest absent = new MockHttpServletRequest();

        assertThat(ServletUtils.isJsonRequest(json)).isTrue();
        assertThat(ServletUtils.isJsonRequest(upperCase)).as("大小写不得影响判定").isTrue();
        assertThat(ServletUtils.isJsonRequest(form)).isFalse();
        assertThat(ServletUtils.isJsonRequest(absent)).as("缺失 Content-Type 不得判定为 JSON").isFalse();
    }

    /** 只有 JSON 请求才读取请求体，避免对已消费的流做二次读取。 */
    @Test
    void getBodyAndBodyBytesOnlyReadJsonRequests() {
        byte[] payload = "{\"name\":\"张三\"}".getBytes(StandardCharsets.UTF_8);

        assertThat(ServletUtils.getBody(jsonRequest(payload))).isEqualTo("{\"name\":\"张三\"}");
        assertThat(ServletUtils.getBodyBytes(jsonRequest(payload))).isEqualTo(payload);
        assertThat(ServletUtils.getBody(textRequest())).as("非 JSON 请求不得读取请求体").isNull();
        assertThat(ServletUtils.getBodyBytes(textRequest())).as("非 JSON 请求不得读取请求体").isNull();
    }

    /**
     * 构造带 JSON 内容类型与指定报文的请求。
     *
     * <p>每个断言使用独立请求：请求体读取入口会消费输入流，复用同一请求会得到
     * "getInputStream 已在 getReader 之后调用"的非法状态，掩盖被测行为。</p>
     *
     * @param payload 请求体字节
     * @return JSON 请求
     */
    private static MockHttpServletRequest jsonRequest(byte[] payload) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setContentType(MediaType.APPLICATION_JSON_VALUE);
        request.setContent(payload);
        return request;
    }

    /**
     * 构造纯文本内容类型的请求，用于验证非 JSON 请求不读取请求体。
     *
     * @return 纯文本请求
     */
    private static MockHttpServletRequest textRequest() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setContentType(MediaType.TEXT_PLAIN_VALUE);
        request.setContent("DUMMY-TEXT".getBytes(StandardCharsets.UTF_8));
        return request;
    }

    /** 客户端地址与请求头、参数收集必须来自真实请求对象。 */
    @Test
    void requestInformationIsCollectedFromRealRequest() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("192.0.2.10");
        request.addHeader("X-Trace-Id", "DUMMY-TRACE");
        request.setParameter("pageNo", "1");

        assertThat(ServletUtils.getClientIP(request)).isEqualTo("192.0.2.10");
        assertThat(ServletUtils.getHeaderMap(request)).containsEntry("X-Trace-Id", "DUMMY-TRACE");
        assertThat(ServletUtils.getParamMap(request)).containsEntry("pageNo", "1");
    }

}
