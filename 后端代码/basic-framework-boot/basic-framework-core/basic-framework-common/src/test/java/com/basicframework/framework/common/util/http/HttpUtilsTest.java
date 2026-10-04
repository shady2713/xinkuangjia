package com.basicframework.framework.common.util.http;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 验证 HTTP 工具类的编码、URL 改写、OAuth2 回调拼接、Basic 凭据解析与带请求头的收发契约。
 *
 * <p>这些方法服务于授权码回调、开放接口调用与代理转发：URL 参数被覆盖或丢失会让回调带错状态值，
 * Basic 凭据解析错误会让客户端认证失败或读到残缺口令，封装收发时请求头丢失会让下游鉴权拒绝。
 * 因此除纯字符串变换外，收发部分使用本机环回的真实 HTTP 服务端观察实际到达的请求头与请求体，
 * 并断言真实响应体（含非 2xx 响应）被原样返回。</p>
 *
 * <p>环回服务端只绑定 {@code 127.0.0.1} 的临时端口，不访问外网；每个用例结束都会停止服务端，
 * 避免残留端口与线程。{@code obtainBasicAuthorization} 的替身边界只有 Servlet 请求本身，
 * 其余解析逻辑走真实实现。</p>
 *
 * @author shady2713
 */
class HttpUtilsTest {

    /** 环回测试服务端。 */
    private HttpServer server;
    /** 服务端记录到的最近一次请求头取值。 */
    private final AtomicReference<String> receivedHeader = new AtomicReference<>();
    /** 服务端记录到的最近一次请求体。 */
    private final AtomicReference<String> receivedBody = new AtomicReference<>();
    /** 服务端基础地址，形如 {@code http://127.0.0.1:<port>}。 */
    private String baseUrl;

    /** 启动只监听环回地址的临时 HTTP 服务端。 */
    @BeforeEach
    void setUp() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/echo", exchange -> {
            receivedHeader.set(headerOf(exchange, "X-Probe"));
            receivedBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            respond(exchange, 200, "ECHO:" + receivedBody.get());
        });
        server.createContext("/failure", exchange -> {
            receivedHeader.set(headerOf(exchange, "X-Probe"));
            respond(exchange, 500, "ERROR-BODY");
        });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    /** 停止服务端，释放端口与处理线程。 */
    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
            server = null;
        }
    }

    /** UTF-8 编码必须按表单规则处理中文、空格与保留字符，解码必须还原原文。 */
    @Test
    void encodeAndDecodeUtf8RoundTripReservedCharacters() {
        String encoded = HttpUtils.encodeUtf8("中文 A&B");

        assertThat(encoded).as("空格按表单编码为加号，中文按 UTF-8 百分号编码").isEqualTo("%E4%B8%AD%E6%96%87+A%26B");
        assertThat(HttpUtils.decodeUtf8(encoded)).isEqualTo("中文 A&B");
    }

    /** 替换已存在的查询参数必须移除旧值并追加新值，参数顺序随之变化。 */
    @Test
    void replaceUrlQueryReplacesExistingValue() {
        assertThat(HttpUtils.replaceUrlQuery("https://example.com/path?a=1&b=2", "a", "DUMMY-VALUE"))
                .isEqualTo("https://example.com/path?b=2&a=DUMMY-VALUE");
    }

    /** 参数不存在时必须追加，地址本来没有查询串时也要能追加而不是抛错。 */
    @Test
    void replaceUrlQueryAppendsMissingKeyAndHandlesEmptyQuery() {
        assertThat(HttpUtils.replaceUrlQuery("https://example.com/path?a=1", "c", "DUMMY-VALUE"))
                .isEqualTo("https://example.com/path?a=1&c=DUMMY-VALUE");
        assertThat(HttpUtils.replaceUrlQuery("https://example.com/path", "a", "DUMMY-VALUE"))
                .isEqualTo("https://example.com/path?a=DUMMY-VALUE");
    }

    /** 需要转义的值必须被百分号编码，不得把空格或保留字符原样写进 URL。 */
    @Test
    void replaceUrlQueryEncodesValue() {
        assertThat(HttpUtils.replaceUrlQuery("https://example.com/path?a=1", "a", "DUMMY VALUE"))
                .isEqualTo("https://example.com/path?a=DUMMY%20VALUE");
    }

    /** 存在查询串时同时移除查询串与 fragment，返回干净的地址。 */
    @Test
    void removeUrlQueryStripsQueryAndFragment() {
        assertThat(HttpUtils.removeUrlQuery("https://example.com/path?a=1#frag"))
                .isEqualTo("https://example.com/path");
    }

    /**
     * 没有查询串时原样返回，连 fragment 也不处理。
     *
     * <p>这是当前实现的真实边界：短路条件只看是否存在 {@code ?}，
     * 因此只带 fragment 的地址不会被清理。用例锁定该行为，避免调用方误以为 fragment 一定被移除。</p>
     */
    @Test
    void removeUrlQueryKeepsUrlWithoutQueryUnchanged() {
        assertThat(HttpUtils.removeUrlQuery("https://example.com/path#frag"))
                .isEqualTo("https://example.com/path#frag");
        assertThat(HttpUtils.removeUrlQuery("https://example.com/path")).isEqualTo("https://example.com/path");
    }

    /** 无 fragment 模式把参数拼成查询串，并保留原地址上已有的查询参数。 */
    @Test
    void appendBuildsQueryAndKeepsExistingQuery() {
        Map<String, Object> query = orderedQuery();

        assertThat(HttpUtils.append("https://example.com/callback", query, null, false))
                .isEqualTo("https://example.com/callback?a=1&b=2");
        assertThat(HttpUtils.append("https://example.com/callback?old=1", query, null, false))
                .as("原查询串保留，新参数追加在后").isEqualTo("https://example.com/callback?old=1&a=1&b=2");
    }

    /** fragment 模式把参数拼进 # 之后，并保留已有 fragment 内容。 */
    @Test
    void appendBuildsFragmentAndKeepsExistingFragment() {
        Map<String, Object> query = orderedQuery();

        assertThat(HttpUtils.append("https://example.com/callback", query, null, true))
                .isEqualTo("https://example.com/callback#a=1&b=2");
        assertThat(HttpUtils.append("https://example.com/callback#existing", query, null, true))
                .isEqualTo("https://example.com/callback#existing&a=1&b=2");
    }

    /** 键映射必须把外部参数名换成内部名，未映射的键保持原名。 */
    @Test
    void appendRenamesKeysByMapping() {
        Map<String, Object> query = orderedQuery();
        Map<String, String> keys = new LinkedHashMap<>();
        keys.put("a", "extra_a");

        assertThat(HttpUtils.append("https://example.com/callback", query, keys, false))
                .isEqualTo("https://example.com/callback?extra_a=1&b=2");
        assertThat(HttpUtils.append("https://example.com/callback", query, keys, true))
                .isEqualTo("https://example.com/callback#extra_a=1&b=2");
    }

    /** 基础地址中的端口与用户信息必须保留到拼接结果。 */
    @Test
    void appendKeepsPortAndUserInfo() {
        assertThat(HttpUtils.append("https://CHANGE_ME_USER:CHANGE_ME_PASSWORD@example.com:8443/cb", orderedQuery(), null, false))
                .isEqualTo("https://CHANGE_ME_USER:CHANGE_ME_PASSWORD@example.com:8443/cb?a=1&b=2");
    }

    /**
     * 基础地址含未编码字符时必须退化为非编码解析并成功产出编码后的地址。
     *
     * <p>客户端注册信息可能保存硬编码的未编码值（如查询串里的空格）；直接按已编码解析会失败，
     * 该回退路径保证这类注册仍能生成可用的回调地址。</p>
     */
    @Test
    void appendFallsBackForUnencodedBaseUrl() {
        assertThat(HttpUtils.append("https://example.com/cb?q=a b", orderedQuery(), null, false))
                .isEqualTo("https://example.com/cb?q=a%20b&a=1&b=2");
        assertThat(HttpUtils.append("https://example.com/cb?q=a{b", orderedQuery(), null, false))
                .isEqualTo("https://example.com/cb?q=a%7Bb&a=1&b=2");
    }

    /** 参数为空时 fragment 模式保持原 fragment 不变，不追加空片段分隔符。 */
    @Test
    void appendWithEmptyQueryKeepsOriginalUrl() {
        assertThat(HttpUtils.append("https://example.com/callback#frag", new LinkedHashMap<>(), null, true))
                .isEqualTo("https://example.com/callback#frag");
    }

    /** Authorization 头中的 Basic 凭据必须按首个冒号拆分，口令中的冒号保留在口令里。 */
    @Test
    void obtainBasicAuthorizationReadsHeaderCredentials() {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getHeader("Authorization")).thenReturn("Basic " + java.util.Base64.getEncoder()
                .encodeToString("DUMMY-CLIENT:DUMMY-PASSWORD-WITH-COLON".getBytes(StandardCharsets.UTF_8)));

        assertThat(HttpUtils.obtainBasicAuthorization(request))
                .containsExactly("DUMMY-CLIENT", "DUMMY-PASSWORD-WITH-COLON");
    }

    /** 没有 Basic 头时回退到表单参数，两个参数都非空才返回凭据。 */
    @Test
    void obtainBasicAuthorizationFallsBackToParameters() {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getHeader("Authorization")).thenReturn(null);
        when(request.getParameter("client_id")).thenReturn("DUMMY-CLIENT");
        when(request.getParameter("client_secret")).thenReturn("CHANGE_ME_SECRET");

        assertThat(HttpUtils.obtainBasicAuthorization(request))
                .containsExactly("DUMMY-CLIENT", "CHANGE_ME_SECRET");
    }

    /** 头部与参数都不完整时必须返回 null，不得返回半截凭据。 */
    @Test
    void obtainBasicAuthorizationReturnsNullForIncompleteCredentials() {
        HttpServletRequest missingSecret = mock(HttpServletRequest.class);
        when(missingSecret.getHeader("Authorization")).thenReturn(null);
        when(missingSecret.getParameter("client_id")).thenReturn("DUMMY-CLIENT");
        when(missingSecret.getParameter("client_secret")).thenReturn(null);
        assertThat(HttpUtils.obtainBasicAuthorization(missingSecret)).isNull();

        HttpServletRequest blankAuthorization = mock(HttpServletRequest.class);
        when(blankAuthorization.getHeader("Authorization")).thenReturn("Basic ");
        when(blankAuthorization.getParameter("client_id")).thenReturn(null);
        when(blankAuthorization.getParameter("client_secret")).thenReturn(null);
        assertThat(HttpUtils.obtainBasicAuthorization(blankAuthorization)).isNull();
    }

    /** 非 Basic 前缀的 Authorization 头不得被当成 Basic 凭据解析。 */
    @Test
    void obtainBasicAuthorizationIgnoresNonBasicScheme() {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getHeader("Authorization")).thenReturn("Bearer DUMMY-ACCESS-TOKEN");
        when(request.getParameter("client_id")).thenReturn("DUMMY-CLIENT");
        when(request.getParameter("client_secret")).thenReturn("CHANGE_ME_SECRET");

        assertThat(HttpUtils.obtainBasicAuthorization(request))
                .as("Bearer 头不参与 Basic 解析，回退到参数").containsExactly("DUMMY-CLIENT", "CHANGE_ME_SECRET");
    }

    /** post 必须把自定义请求头与请求体真实发到服务端，并返回响应体。 */
    @Test
    void postSendsHeadersAndBodyAndReturnsResponse() {
        String result = HttpUtils.post(baseUrl + "/echo", Map.of("X-Probe", "DUMMY-POST-HEADER"), "DUMMY-REQUEST-BODY");

        assertThat(receivedHeader.get()).as("服务端必须收到自定义请求头").isEqualTo("DUMMY-POST-HEADER");
        assertThat(receivedBody.get()).as("服务端必须收到完整请求体").isEqualTo("DUMMY-REQUEST-BODY");
        assertThat(result).isEqualTo("ECHO:DUMMY-REQUEST-BODY");
    }

    /** get 必须把自定义请求头真实发到服务端，并返回响应体。 */
    @Test
    void getSendsHeadersAndReturnsResponse() {
        String result = HttpUtils.get(baseUrl + "/echo", Map.of("X-Probe", "DUMMY-GET-HEADER"));

        assertThat(receivedHeader.get()).isEqualTo("DUMMY-GET-HEADER");
        assertThat(receivedBody.get()).as("GET 不携带请求体").isEmpty();
        assertThat(result).isEqualTo("ECHO:");
    }

    /** 非 2xx 响应不得抛错，响应体必须原样返回给调用方判断。 */
    @Test
    void postReturnsFailureBodyWithoutThrowing() {
        String result = HttpUtils.post(baseUrl + "/failure", Map.of("X-Probe", "DUMMY-FAILURE-HEADER"), "DUMMY-BODY");

        assertThat(receivedHeader.get()).isEqualTo("DUMMY-FAILURE-HEADER");
        assertThat(result).as("失败响应体必须返回，由调用方按业务码判断").isEqualTo("ERROR-BODY");
    }

    /**
     * 工具类未声明私有构造，实例化不得改变静态入口行为。
     *
     * <p>该类没有实例状态，构造方法属于真实可调用面；断言实例化后静态入口仍按同一规则工作，
     * 防止未来把共享状态放进实例，导致按实例使用与静态入口读到不同结果。</p>
     */
    @Test
    void instantiationKeepsStaticEntryBehaviour() {
        new HttpUtils();

        assertThat(HttpUtils.encodeUtf8("中文")).isEqualTo("%E4%B8%AD%E6%96%87");
        assertThat(HttpUtils.removeUrlQuery("https://example.com/path?a=1")).isEqualTo("https://example.com/path");
    }

    /** 构造按插入顺序排列的查询参数，保证断言不受 Map 实现顺序影响。 */
    private static Map<String, Object> orderedQuery() {
        Map<String, Object> query = new LinkedHashMap<>();
        query.put("a", "1");
        query.put("b", "2");
        return query;
    }

    /** 读取指定请求头的值，缺失时返回 null。 */
    private static String headerOf(HttpExchange exchange, String name) {
        return exchange.getRequestHeaders().getFirst(name);
    }

    /** 按 UTF-8 返回固定响应体。 */
    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] content = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, content.length);
        exchange.getResponseBody().write(content);
        exchange.close();
    }

}
