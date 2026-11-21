package com.basicframework.server.contract;

import com.basicframework.server.BasicFrameworkServerApplication;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodyHandlers;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import org.bouncycastle.asn1.gm.GMNamedCurves;
import org.bouncycastle.asn1.x9.X9ECParameters;
import org.bouncycastle.crypto.engines.SM2Engine;
import org.bouncycastle.crypto.params.ECDomainParameters;
import org.bouncycastle.crypto.params.ECPublicKeyParameters;
import org.bouncycastle.crypto.params.ParametersWithRandom;
import org.bouncycastle.util.encoders.Hex;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 使用环回 MySQL、Redis、MinIO 和 Nginx 验证私有附件完整链路。
 *
 * @author Claude Code
 */
@ActiveProfiles({"local", "real-attachment-it"})
@EnabledIfEnvironmentVariable(named = "RUN_REAL_ATTACHMENT_IT", matches = "true")
@SpringBootTest(classes = BasicFrameworkServerApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"basic-framework.captcha.enable=false", "basic-framework.access-log.enable=false"})
class RealAttachmentServiceIT {

    private static final String API = "/admin-api";
    private static final String FIXTURE_TEXT = "synthetic attachment fixture";
    private static final byte[] FIXTURE = FIXTURE_TEXT.getBytes(StandardCharsets.UTF_8);
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(15);

    private final ObjectMapper mapper = new ObjectMapper().configure(JsonParser.Feature.INCLUDE_SOURCE_IN_LOCATION, false);
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(REQUEST_TIMEOUT)
            .followRedirects(HttpClient.Redirect.NEVER).build();

    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private PasswordEncoder passwordEncoder;
    @LocalServerPort
    private int port;

    /** 启动 Spring 前核对环回服务及专用测试数据库。 */
    @DynamicPropertySource
    static void requireLoopbackFixture(DynamicPropertyRegistry registry) {
        if (!"issue103_fixture".equals(env("DB_NAME"))) {
            throw new IllegalStateException("DB_NAME must be issue103_fixture");
        }
        requireLoopback("DB_HOST", env("DB_HOST"));
        requireLoopback("REDIS_HOST", env("REDIS_HOST"));
        requireLoopback("MINIO_ENDPOINT", URI.create(env("MINIO_ENDPOINT")).getHost());
        requireLoopback("MINIO_SIGNING_ENDPOINT", URI.create(env("MINIO_SIGNING_ENDPOINT")).getHost());
        String slaveHost = System.getenv("DB_SLAVE_HOST");
        if (slaveHost != null) {
            requireLoopback("DB_SLAVE_HOST", slaveHost);
        }
        String slaveName = System.getenv("DB_SLAVE_NAME");
        if (slaveName != null && !"issue103_fixture".equals(slaveName)) {
            throw new IllegalStateException("DB_SLAVE_NAME must be issue103_fixture");
        }
    }

    /** 验证成功上传、所有者下载、私有访问拒绝、公开兼容及签名到期。 */
    @Test
    @Timeout(105)
    void privateAttachmentIsOwnerOnlyAndSignedUrlExpires() throws Exception {
        String owner = login(createUser("owner"));
        String other = login(createUser("other"));

        JsonNode privateFile = uploadAndRegister(owner, "private");
        String query = "?id=" + privateFile.path("id").asLong();
        String content = API + "/infra/file/private/content" + query;
        String signer = API + "/infra/file/private/presigned-get-url" + query + "&expirationSeconds=60";
        assertFixture(send("GET", content, owner, null));
        URI signed = gateway(data(send("GET", signer, owner, null)).asText());
        assertFixture(get(signed));

        assertDenied(send("GET", content, other, null));
        assertDenied(send("GET", signer, other, null));
        assertUnauthorized(send("GET", content, null, null));

        String gatewayPrefix = trimSlash(URI.create(env("MINIO_SIGNING_ENDPOINT")).getRawPath());
        assertTrue(signed.getRawPath().startsWith(gatewayPrefix), "signed URL keeps gateway path prefix");
        String objectPath = signed.getRawPath().substring(gatewayPrefix.length());
        String gatewayOrigin = signed.getScheme() + "://" + signed.getRawAuthority();
        URI legacyPrivate = URI.create(gatewayOrigin + "/files" + objectPath);
        assertEquals(404, get(legacyPrivate).statusCode(), "legacy private read status");
        URI unsigned = URI.create(gatewayOrigin + signed.getRawPath());
        assertEquals(403, get(unsigned).statusCode(), "unsigned gateway status");
        assertEquals(403, get(URI.create(trimSlash(env("MINIO_ENDPOINT")) + objectPath)).statusCode(), "unsigned direct status");

        JsonNode publicFile = uploadAndRegister(owner, "public");
        assertFixture(get(legacy(publicFile.path("url").asText())));

        Thread.sleep(61_000);
        assertEquals(403, get(signed).statusCode(), "expired signed URL status");
    }

    /** 写入一次性 business_admin 账号并返回登录输入。 */
    private String[] createUser(String role) {
        String username = "it" + role + UUID.randomUUID().toString().substring(0, 8);
        String password = UUID.randomUUID().toString();
        jdbcTemplate.update("INSERT INTO system_users (username, password, user_type, nickname) VALUES (?, ?, ?, ?)",
                username, passwordEncoder.encode(password), "business_admin", "Fixture " + role);
        return new String[] {username, password};
    }

    /** 通过网关签名直传并登记测试文件，返回链接信息和记录 ID。 */
    private JsonNode uploadAndRegister(String token, String directory) throws Exception {
        ObjectNode presign = (ObjectNode) data(send("GET",
                API + "/infra/file/presigned-url?name=fixture.txt&directory=" + directory, token, null));
        String type = presign.path("contentType").asText();
        assertTrue(!type.isEmpty(), "presigned content type present");
        HttpRequest put = HttpRequest.newBuilder(gateway(presign.path("uploadUrl").asText())).timeout(REQUEST_TIMEOUT)
                .header("Content-Type", type).PUT(BodyPublishers.ofByteArray(FIXTURE)).build();
        assertEquals(200, http.send(put, BodyHandlers.discarding()).statusCode(), "upload status");
        long id = data(send("POST", API + "/infra/file/create", token, Map.of("path", presign.path("path").asText(),
                "name", "fixture.txt", "type", type, "size", FIXTURE.length, "url", presign.path("url").asText()))).asLong();
        assertTrue(id > 0, "registered file id");
        return presign.put("id", id);
    }

    /** 使用 SM2 认证合成账号，返回用于调用附件接口的令牌。 */
    private String login(String[] user) throws Exception {
        String publicKey = data(send("GET", API + "/system/auth/sm2-public-key", null, null)).path("publicKey").asText();
        byte[] nonce = new byte[16];
        new SecureRandom().nextBytes(nonce);
        String envelope = mapper.writeValueAsString(
                Map.of("p", user[1], "t", System.currentTimeMillis(), "n", Hex.toHexString(nonce)));
        Map<String, String> body = Map.of("username", user[0], "password", sm2Encrypt(publicKey, envelope));
        String token = data(send("POST", API + "/system/auth/login", null, body)).path("accessToken").asText();
        assertTrue(!token.isEmpty(), "access token present");
        return token;
    }

    /** 按登录契约用 SM2 C1C3C2 加密并返回十六进制密文。 */
    private static String sm2Encrypt(String publicKeyHex, String plain) throws Exception {
        X9ECParameters curve = GMNamedCurves.getByName("sm2p256v1");
        ECDomainParameters domain = new ECDomainParameters(curve.getCurve(), curve.getG(), curve.getN(), curve.getH());
        String hex = publicKeyHex.length() == 128 ? "04" + publicKeyHex : publicKeyHex;
        ECPublicKeyParameters key = new ECPublicKeyParameters(curve.getCurve().decodePoint(Hex.decode(hex)), domain);
        SM2Engine engine = new SM2Engine(SM2Engine.Mode.C1C3C2);
        engine.init(true, new ParametersWithRandom(key, new SecureRandom()));
        byte[] input = plain.getBytes(StandardCharsets.UTF_8);
        return Hex.toHexString(engine.processBlock(input, 0, input.length));
    }

    /** 向环回 Spring 服务发送 API 请求，按需附加认证和 JSON。 */
    private HttpResponse<byte[]> send(String method, String path, String token, Object body) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .timeout(REQUEST_TIMEOUT);
        if (token != null) {
            builder.header("Authorization", "Bearer " + token);
        }
        if (body == null) {
            builder.method(method, BodyPublishers.noBody());
        } else {
            builder.header("Content-Type", "application/json")
                    .method(method, BodyPublishers.ofByteArray(mapper.writeValueAsBytes(body)));
        }
        return http.send(builder.build(), BodyHandlers.ofByteArray());
    }

    /** 用 GET 读取已校验的环回地址。 */
    private HttpResponse<byte[]> get(URI uri) throws Exception {
        return http.send(HttpRequest.newBuilder(uri).timeout(REQUEST_TIMEOUT).GET().build(), BodyHandlers.ofByteArray());
    }

    /** 确认 HTTP 和业务状态成功后返回 data 节点。 */
    private JsonNode data(HttpResponse<byte[]> response) {
        assertEquals(200, response.statusCode(), "HTTP status");
        assertEquals(0, code(response), "application code");
        return json(response).path("data");
    }

    /** 确认响应为成功下载且与测试文件字节完全相同。 */
    private static void assertFixture(HttpResponse<byte[]> response) {
        assertEquals(200, response.statusCode(), "download status");
        assertArrayEquals(FIXTURE, response.body(), "fixture bytes");
    }

    /** 确认其他用户收到权限拒绝。 */
    private void assertDenied(HttpResponse<byte[]> response) {
        if (response.statusCode() != 403) {
            assertEquals(200, response.statusCode(), "denied HTTP status");
            assertEquals(1001003008, code(response), "denied application code");
        }
    }

    /** 确认匿名调用收到认证要求。 */
    private void assertUnauthorized(HttpResponse<byte[]> response) {
        if (response.statusCode() != 401) {
            assertEquals(200, response.statusCode(), "unauthenticated HTTP status");
            assertEquals(401, code(response), "unauthenticated application code");
        }
    }

    /** 读取 JSON 响应的业务状态码。 */
    private int code(HttpResponse<byte[]> response) {
        return json(response).path("code").asInt(-1);
    }

    /** 解析 JSON，失败时仅输出固定断言消息。 */
    private JsonNode json(HttpResponse<byte[]> response) {
        try {
            return mapper.readTree(response.body());
        } catch (Exception e) {
            throw new AssertionError("response body is not JSON");
        }
    }

    /** 检查响应链接指向配置的环回网关并保留其签名原文。 */
    private static URI gateway(String url) {
        URI uri;
        try {
            uri = URI.create(url);
        } catch (IllegalArgumentException e) {
            throw new AssertionError("returned URL is malformed");
        }
        URI expected = URI.create(env("MINIO_SIGNING_ENDPOINT"));
        assertTrue(expected.getScheme().equalsIgnoreCase(String.valueOf(uri.getScheme()))
                && expected.getHost().equalsIgnoreCase(String.valueOf(uri.getHost()))
                && expected.getPort() == uri.getPort(), "returned URL targets configured gateway");
        return uri;
    }

    /** 检查历史公开 URL 仍使用环回网关的 /files 路径。 */
    private static URI legacy(String url) {
        URI uri = gateway(url);
        assertTrue(String.valueOf(uri.getRawPath()).startsWith("/files/"), "returned URL uses legacy /files path");
        return uri;
    }

    /** 只允许环回 IP 或 localhost 主机。 */
    private static void requireLoopback(String name, String host) {
        boolean loopback = host != null && (host.equals("localhost") || host.equals("::1") || host.equals("[::1]")
                || host.matches("127(\\.\\d{1,3}){3}"));
        if (!loopback) {
            throw new IllegalStateException(name + " must be a loopback host");
        }
    }

    /** 读取测试运行器提供的必需环境变量。 */
    private static String env(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " is required");
        }
        return value;
    }

    /** 移除尾部斜线以拼接后续路径。 */
    private static String trimSlash(String value) {
        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }
}
