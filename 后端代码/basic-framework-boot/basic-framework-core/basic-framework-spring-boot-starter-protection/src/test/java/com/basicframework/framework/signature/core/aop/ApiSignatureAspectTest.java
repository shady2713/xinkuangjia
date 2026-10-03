package com.basicframework.framework.signature.core.aop;

import cn.hutool.core.util.StrUtil;
import cn.hutool.crypto.digest.DigestUtil;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants;
import com.basicframework.framework.protection.support.ProtectionRedisTestSupport;
import com.basicframework.framework.signature.core.annotation.ApiSignature;
import com.basicframework.framework.signature.core.redis.ApiSignatureRedisDAO;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.aop.aspectj.annotation.AspectJProxyFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.SortedMap;
import java.util.TreeMap;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 用真实 Spring AOP 代理与真实 Redis 验证 API 签名切面的完整验签链路。
 *
 * <p>签名切面要在业务方法执行之前判定“请求是否可信”，判错的后果是不对称的：放过一次伪造请求可能
 * 直接造成越权写入，误拒一次则让正常客户端不可用。因此这里覆盖链路上每一环——请求头非空、随机数长度、
 * 时间戳窗口、随机数唯一性、appId 是否登记、签名比对、随机数落库——并用“正确签名能过、任一要素被改动
 * 都不能过”来证明签名确实覆盖了参数、请求体与加签请求头，而不是只做了一次存在性判断。</p>
 *
 * <p>签名文本按注解声明的格式独立计算（排序后的查询参数 + 请求体 + 排序后的加签请求头 + 应用密钥），
 * 这份计算与生产实现相互独立：若切面漏掉其中任一段，用例构造的正确签名就会与服务端算法不一致而失败，
 * 因此它不会因为“照抄实现”而失去意义。</p>
 *
 * @author shady2713
 */
class ApiSignatureAspectTest extends ProtectionRedisTestSupport {

    /** 生产代码使用的固定 HASH 键名，存放 appId 与 appSecret 的映射。 */
    private static final String SIGNATURE_APPID_KEY = "api_signature_app";

    /** 测试应用的应用密钥。 */
    private static final String APP_SECRET = "protect-test-app-secret";

    /** 签名允许的时间窗口（秒），与注解默认值一致。 */
    private static final int TIMEOUT_SECONDS = 60;

    /** 验签随机数，至少 10 位。 */
    private static final String NONCE = "nonce-1234567890";

    /** 目标方法成功时的标记。 */
    private static final String SUCCEED_MARKER = "verified";

    /** 注解默认的签名失败提示。 */
    private static final String DEFAULT_MESSAGE = "签名不正确";

    /** 被测 DAO，全部用例走真实 Redis。 */
    private ApiSignatureRedisDAO signatureRedisDAO;

    /** 本测试类的应用编号，带随机前缀，使其产生的随机数 Key 可被前缀清理命中。 */
    private String appId;

    /** 被切面代理的目标，切点能否命中注解方法由它直接体现。 */
    private SignatureBiz target;

    /**
     * 预加载应用密钥，并用真实切面组装被代理目标。
     */
    @BeforeEach
    void setUp() {
        signatureRedisDAO = new ApiSignatureRedisDAO(stringRedisTemplate);
        appId = nextKey("app");
        stringRedisTemplate.opsForHash().put(SIGNATURE_APPID_KEY, appId, APP_SECRET);
        trackHashField(SIGNATURE_APPID_KEY, appId);
        AspectJProxyFactory factory = new AspectJProxyFactory(new SignatureBizImpl());
        factory.addAspect(new ApiSignatureAspect(signatureRedisDAO));
        target = factory.getProxy();
    }

    /**
     * 清空请求上下文，避免影响后续用例。
     */
    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    /**
     * 验证按约定签名的请求通过验签，并按“两倍时间窗口”把随机数记入 Redis。
     *
     * <p>随机数的存活期必须覆盖两倍窗口，才能把跨窗口边界的重放也挡住；这里直接读 Redis 上的 TTL 验证。</p>
     */
    @Test
    @DisplayName("签名正确的请求通过验签，并按两倍时间窗口记录随机数")
    void shouldAcceptCorrectlySignedRequestAndRecordNonce() {
        signedRequest(annotationOf("verified"), currentTimestamp(), Map.of("orderId", "1001"), null, appId, APP_SECRET);

        assertThat(target.verified()).isEqualTo(SUCCEED_MARKER);

        String nonceKey = String.format("api_signature_nonce:%s:%s", appId, NONCE);
        assertThat(stringRedisTemplate.hasKey(nonceKey))
                .as("验签通过后必须记录随机数，否则同一请求可以无限重放")
                .isTrue();
        assertThat(stringRedisTemplate.getExpire(nonceKey, TimeUnit.SECONDS))
                .as("随机数存活期应为签名窗口的两倍")
                .isBetween((long) TIMEOUT_SECONDS, (long) TIMEOUT_SECONDS * 2);
    }

    /**
     * 验证同一个请求原样重放时被拒绝。
     *
     * <p>重放会在请求头校验阶段被判定为随机数已使用，因此对外表现为“签名不正确”的通用错误，
     * 而不是“重复请求”——对外不暴露随机数是否已被使用。</p>
     */
    @Test
    @DisplayName("同一请求原样重放被拒绝")
    void shouldRejectReplayedRequest() {
        ApiSignature signature = annotationOf("verified");
        signedRequest(signature, currentTimestamp(), Map.of("orderId", "1001"), null, appId, APP_SECRET);
        assertThat(target.verified()).isEqualTo(SUCCEED_MARKER);

        // 重新绑定一个内容完全相同的新请求，模拟客户端原样重发。
        signedRequest(signature, currentTimestamp(), Map.of("orderId", "1001"), null, appId, APP_SECRET);

        assertThatThrownBy(() -> target.verified())
                .isInstanceOf(ServiceException.class)
                .satisfies(exception -> {
                    ServiceException serviceException = (ServiceException) exception;
                    assertThat(serviceException.getCode())
                            .isEqualTo(GlobalErrorCodeConstants.BAD_REQUEST.getCode());
                    assertThat(serviceException.getMessage()).isEqualTo(DEFAULT_MESSAGE);
                });
    }

    /**
     * 验证查询参数被改动后签名失效，证明参数确实被签名覆盖。
     */
    @Test
    @DisplayName("查询参数被改动后签名失效")
    void shouldRejectTamperedQueryParameter() {
        // 先按 1001 算出签名，再把参数改成 1002 而不重新签名。
        MockHttpServletRequest tampered = signedRequest(annotationOf("verified"), currentTimestamp(),
                Map.of("orderId", "1001"), null, appId, APP_SECRET);
        tampered.setParameter("orderId", "1002");

        assertThatThrownBy(() -> target.verified())
                .as("参数被改写后原签名不再匹配")
                .isInstanceOf(ServiceException.class)
                .satisfies(exception -> assertThat(((ServiceException) exception).getCode())
                        .isEqualTo(GlobalErrorCodeConstants.BAD_REQUEST.getCode()));
    }

    /**
     * 验证 JSON 请求体被改动后签名失效，证明请求体确实被签名覆盖。
     */
    @Test
    @DisplayName("JSON 请求体被改动后签名失效")
    void shouldRejectTamperedJsonBody() {
        String originalBody = "{\"amount\":100}";
        MockHttpServletRequest tampered = signedRequest(annotationOf("verified"), currentTimestamp(),
                Map.of("orderId", "1001"), originalBody, appId, APP_SECRET);
        // 替换请求体但保留原签名，模拟中间人改写金额。
        tampered.setContent("{\"amount\":1}".getBytes(StandardCharsets.UTF_8));

        assertThatThrownBy(() -> target.verified())
                .as("请求体被改写后原签名不再匹配")
                .isInstanceOf(ServiceException.class)
                .satisfies(exception -> assertThat(((ServiceException) exception).getCode())
                        .isEqualTo(GlobalErrorCodeConstants.BAD_REQUEST.getCode()));
    }

    /**
     * 验证加签请求头被改动后签名失效，证明请求头也参与了签名。
     */
    @Test
    @DisplayName("加签请求头被改动后签名失效")
    void shouldRejectTamperedSignedHeader() {
        ApiSignature signature = annotationOf("verified");
        MockHttpServletRequest tampered = signedRequest(signature, currentTimestamp(),
                Map.of("orderId", "1001"), null, appId, APP_SECRET);
        // Mock 请求的 addHeader 是追加而不是覆盖，必须先移除原值才能真正改写请求头。
        tampered.removeHeader(signature.nonce());
        tampered.addHeader(signature.nonce(), "nonce-0987654321");

        assertThatThrownBy(() -> target.verified())
                .as("加签请求头被改写后原签名不再匹配")
                .isInstanceOf(ServiceException.class)
                .satisfies(exception -> assertThat(((ServiceException) exception).getCode())
                        .isEqualTo(GlobalErrorCodeConstants.BAD_REQUEST.getCode()));
    }

    /**
     * 验证使用错误密钥算出的签名无法通过，证明签名确实与应用密钥绑定。
     */
    @Test
    @DisplayName("使用错误密钥算出的签名无法通过")
    void shouldRejectSignatureBuiltWithWrongSecret() {
        signedRequest(annotationOf("verified"), currentTimestamp(), Map.of("orderId", "1001"), null,
                appId, APP_SECRET + "-wrong");

        assertThatThrownBy(() -> target.verified())
                .as("换一把密钥重算的签名必须失效")
                .isInstanceOf(ServiceException.class)
                .satisfies(exception -> assertThat(((ServiceException) exception).getCode())
                        .isEqualTo(GlobalErrorCodeConstants.BAD_REQUEST.getCode()));
    }

    /**
     * 验证时间戳落在窗口之前被拒绝，避免历史签名被长期盗用重放。
     */
    @Test
    @DisplayName("时间戳早于允许窗口被拒绝")
    void shouldRejectExpiredTimestamp() {
        long expired = System.currentTimeMillis() - TimeUnit.SECONDS.toMillis(TIMEOUT_SECONDS) - 5_000L;
        signedRequest(annotationOf("verified"), String.valueOf(expired), Map.of("orderId", "1001"), null,
                appId, APP_SECRET);

        assertThatThrownBy(() -> target.verified())
                .as("超出窗口的历史请求应被拒绝")
                .isInstanceOf(ServiceException.class)
                .satisfies(exception -> assertThat(((ServiceException) exception).getCode())
                        .isEqualTo(GlobalErrorCodeConstants.BAD_REQUEST.getCode()));
    }

    /**
     * 验证时间戳落在窗口之后同样被拒绝。
     *
     * <p>偏差按绝对值计算，因此伪造一个“未来时间戳”不能绕过窗口限制。</p>
     */
    @Test
    @DisplayName("时间戳晚于允许窗口同样被拒绝")
    void shouldRejectFutureTimestamp() {
        long future = System.currentTimeMillis() + TimeUnit.SECONDS.toMillis(TIMEOUT_SECONDS) + 5_000L;
        signedRequest(annotationOf("verified"), String.valueOf(future), Map.of("orderId", "1001"), null,
                appId, APP_SECRET);

        assertThatThrownBy(() -> target.verified())
                .as("未来时间戳同样超出窗口，不能用来绕过有效期")
                .isInstanceOf(ServiceException.class)
                .satisfies(exception -> assertThat(((ServiceException) exception).getCode())
                        .isEqualTo(GlobalErrorCodeConstants.BAD_REQUEST.getCode()));
    }

    /**
     * 验证缺少 appId 时被拒绝。
     */
    @Test
    @DisplayName("缺少 appId 时被拒绝")
    void shouldRejectMissingAppId() {
        bindRequest(new MockHttpServletRequest());

        assertThatThrownBy(() -> target.verified())
                .isInstanceOf(ServiceException.class)
                .satisfies(exception -> assertThat(((ServiceException) exception).getCode())
                        .isEqualTo(GlobalErrorCodeConstants.BAD_REQUEST.getCode()));
    }

    /**
     * 验证缺少 timestamp 时被拒绝。
     */
    @Test
    @DisplayName("缺少 timestamp 时被拒绝")
    void shouldRejectMissingTimestamp() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("appId", appId);
        request.addHeader("nonce", NONCE);
        request.addHeader("sign", "whatever");
        bindRequest(request);

        assertThatThrownBy(() -> target.verified())
                .isInstanceOf(ServiceException.class)
                .satisfies(exception -> assertThat(((ServiceException) exception).getCode())
                        .isEqualTo(GlobalErrorCodeConstants.BAD_REQUEST.getCode()));
    }

    /**
     * 验证随机数不足 10 位时被拒绝，避免弱随机数被轻易枚举重放。
     */
    @Test
    @DisplayName("随机数不足 10 位时被拒绝")
    void shouldRejectTooShortNonce() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("appId", appId);
        request.addHeader("timestamp", currentTimestamp());
        request.addHeader("nonce", "123456789");
        request.addHeader("sign", "whatever");
        bindRequest(request);

        assertThatThrownBy(() -> target.verified())
                .isInstanceOf(ServiceException.class)
                .satisfies(exception -> assertThat(((ServiceException) exception).getCode())
                        .isEqualTo(GlobalErrorCodeConstants.BAD_REQUEST.getCode()));
    }

    /**
     * 验证缺少 sign 时被拒绝。
     */
    @Test
    @DisplayName("缺少 sign 时被拒绝")
    void shouldRejectMissingSign() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("appId", appId);
        request.addHeader("timestamp", currentTimestamp());
        request.addHeader("nonce", NONCE);
        bindRequest(request);

        assertThatThrownBy(() -> target.verified())
                .isInstanceOf(ServiceException.class)
                .satisfies(exception -> assertThat(((ServiceException) exception).getCode())
                        .isEqualTo(GlobalErrorCodeConstants.BAD_REQUEST.getCode()));
    }

    /**
     * 验证未登记的 appId 无法通过验签。
     *
     * <p>找不到密钥说明该应用未接入，签名无从谈起，必须以明确异常暴露而不是静默通过。</p>
     */
    @Test
    @DisplayName("未登记的 appId 无法通过验签")
    void shouldRejectUnregisteredAppId() {
        signedRequest(annotationOf("verified"), currentTimestamp(), Map.of("orderId", "1001"), null,
                nextKey("app-not-registered"), APP_SECRET);

        assertThatThrownBy(() -> target.verified())
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("找不到对应的 appSecret");
    }

    /**
     * 验证注解提示为空时回落到统一的请求参数错误提示。
     *
     * <p>没有可读的提示会让接入方无法定位问题，因此必须给出统一文案。</p>
     */
    @Test
    @DisplayName("注解提示为空时回落到统一的请求参数错误提示")
    void shouldFallbackToGlobalMessageWhenAnnotationMessageIsBlank() {
        bindRequest(new MockHttpServletRequest());

        assertThatThrownBy(() -> target.blankMessage())
                .isInstanceOf(ServiceException.class)
                .satisfies(exception -> {
                    ServiceException serviceException = (ServiceException) exception;
                    assertThat(serviceException.getCode())
                            .isEqualTo(GlobalErrorCodeConstants.BAD_REQUEST.getCode());
                    assertThat(serviceException.getMessage())
                            .isEqualTo(GlobalErrorCodeConstants.BAD_REQUEST.getMsg());
                });
    }

    /**
     * 验证注解自定义加签字段名后仍能按同一套算法验签通过。
     *
     * <p>接入方通常有自己的 Header 命名规范，切面必须真正按注解配置读写，而不是写死默认字段名；
     * 断言字段名本身也是为了防止这条用例悄悄退化成默认字段名的路径。</p>
     */
    @Test
    @DisplayName("注解自定义加签字段名后仍能验签通过")
    void shouldVerifyRequestWithCustomHeaderNames() {
        ApiSignature signature = annotationOf("customHeaderNames");
        assertThat(signature.appId()).isEqualTo("x-app");
        signedRequest(signature, currentTimestamp(), Map.of("orderId", "1001"), null, appId, APP_SECRET);

        assertThatCode(() -> target.customHeaderNames()).doesNotThrowAnyException();
        assertThat(stringRedisTemplate.hasKey(
                String.format("api_signature_nonce:%s:%s", appId, NONCE)))
                .as("自定义字段名下随机数同样必须落库")
                .isTrue();
    }

    /**
     * 验证两个并发请求抢同一个随机数时，后写入的一方得到“重复请求”错误码。
     *
     * <p>这条分支对应“请求头校验通过之后、随机数落库之前被另一个请求抢先写入”的竞态窗口。真实 Redis
     * 下该窗口只能靠并发复现且结果不确定，因此这里用一个只改写随机数读写行为的受控 DAO 稳定复现该状态，
     * 验证切面的兜底语义；随机数本身的原子占用能力由针对真实 Redis 的 DAO 测试负责。</p>
     */
    @Test
    @DisplayName("并发抢占同一个随机数时后写入方得到重复请求错误码")
    void shouldRejectConcurrentNonceRaceWithRepeatedRequestsError() {
        signedRequest(annotationOf("verified"), currentTimestamp(), Map.of("orderId", "1001"), null,
                appId, APP_SECRET);
        AspectJProxyFactory factory = new AspectJProxyFactory(new SignatureBizImpl());
        factory.addAspect(new ApiSignatureAspect(new RaceWinningApiSignatureRedisDAO(stringRedisTemplate)));
        SignatureBiz racingTarget = factory.getProxy();

        assertThatThrownBy(() -> racingTarget.verified())
                .isInstanceOf(ServiceException.class)
                .satisfies(exception -> {
                    ServiceException serviceException = (ServiceException) exception;
                    assertThat(serviceException.getCode())
                            .isEqualTo(GlobalErrorCodeConstants.REPEATED_REQUESTS.getCode());
                    assertThat(serviceException.getMessage()).isEqualTo("存在重复请求");
                });
    }

    /**
     * 读取目标接口方法上的签名注解，按注解声明的字段名与超时参与构造与验签。
     *
     * @param methodName 方法名
     * @return 方法上的签名注解
     */
    private static ApiSignature annotationOf(String methodName) {
        try {
            return SignatureBiz.class.getMethod(methodName).getAnnotation(ApiSignature.class);
        } catch (NoSuchMethodException exception) {
            throw new IllegalStateException("目标接口上不存在方法: " + methodName, exception);
        }
    }

    /**
     * 取得当前时刻的毫秒时间戳，作为签名中的时间戳。
     *
     * @return 毫秒时间戳文本
     */
    private static String currentTimestamp() {
        return String.valueOf(System.currentTimeMillis());
    }

    /**
     * 构造一个带加签请求头的请求并绑定到当前线程，使切面能取到它。
     *
     * @param signature 签名注解
     * @param timestamp 时间戳文本
     * @param params    查询参数
     * @param body      JSON 请求体，可为 null 表示非 JSON 请求
     * @param appId     应用编号
     * @param appSecret 用于计算签名的应用密钥
     * @return 已绑定到当前线程的请求
     */
    private MockHttpServletRequest signedRequest(ApiSignature signature, String timestamp,
            Map<String, String> params, String body, String appId, String appSecret) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        params.forEach(request::setParameter);
        if (body != null) {
            request.setContent(body.getBytes(StandardCharsets.UTF_8));
            request.setContentType("application/json");
        }
        request.addHeader(signature.appId(), appId);
        request.addHeader(signature.timestamp(), timestamp);
        request.addHeader(signature.nonce(), NONCE);
        request.addHeader(signature.sign(), sign(signature, request, params, body, appSecret));
        return bindRequest(request);
    }

    /**
     * 按注解声明的签名格式独立计算服务端签名。
     *
     * <p>顺序固定为“按参数名排序的查询参数 + 请求体 + 按字段名排序的加签请求头 + 应用密钥”，再取 SHA-256
     * 十六进制。这份实现与切面独立，漏掉任一段都会让正确签名与服务端算法不一致。</p>
     *
     * @param signature 签名注解
     * @param request   已写入加签请求头的请求
     * @param params    查询参数
     * @param body      JSON 请求体，可为 null
     * @param appSecret 应用密钥
     * @return 十六进制签名
     */
    private static String sign(ApiSignature signature, MockHttpServletRequest request,
            Map<String, String> params, String body, String appSecret) {
        SortedMap<String, String> parameterMap = new TreeMap<>(params);
        SortedMap<String, String> headerMap = new TreeMap<>();
        headerMap.put(signature.appId(), request.getHeader(signature.appId()));
        headerMap.put(signature.timestamp(), request.getHeader(signature.timestamp()));
        headerMap.put(signature.nonce(), request.getHeader(signature.nonce()));
        String signatureText = join(parameterMap) + StrUtil.nullToDefault(body, "") + join(headerMap) + appSecret;
        return DigestUtil.sha256Hex(signatureText);
    }

    /**
     * 按排序后的键值顺序拼接签名片段。
     *
     * @param entries 已按键名排序的片段
     * @return 以 {@code &} 连接的签名片段
     */
    private static String join(SortedMap<String, String> entries) {
        return entries.entrySet().stream()
                .map(entry -> entry.getKey() + "=" + entry.getValue())
                .collect(Collectors.joining("&"));
    }

    /**
     * 把请求绑定到当前线程，使 {@code ServletUtils.getRequest()} 能取到它。
     *
     * @param request 待绑定的请求
     * @return 同一个请求，便于调用方继续改写
     */
    private static MockHttpServletRequest bindRequest(MockHttpServletRequest request) {
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        return request;
    }

    /**
     * 签名注解的调用目标，覆盖默认字段名、空提示与自定义字段名三种配置。
     */
    interface SignatureBiz {

        /**
         * 使用默认加签字段名的受保护方法。
         *
         * @return 固定标记
         */
        @ApiSignature(timeout = TIMEOUT_SECONDS)
        String verified();

        /**
         * 提示为空白的受保护方法，用于验证统一提示回落。
         *
         * @return 不会正常返回
         */
        @ApiSignature(timeout = TIMEOUT_SECONDS, message = " ")
        String blankMessage();

        /**
         * 使用自定义加签字段名的受保护方法。
         *
         * @return 固定标记
         */
        @ApiSignature(timeout = TIMEOUT_SECONDS, appId = "x-app", timestamp = "x-ts",
                nonce = "x-nonce", sign = "x-sign")
        String customHeaderNames();
    }

    /**
     * 签名目标接口的实现。
     */
    static class SignatureBizImpl implements SignatureBiz {

        /**
         * 返回固定标记，确认确实通过了验签并进入业务逻辑。
         *
         * @return 固定标记
         */
        @Override
        @ApiSignature(timeout = TIMEOUT_SECONDS)
        public String verified() {
            return SUCCEED_MARKER;
        }

        /**
         * 不应被执行到，验证空提示场景下切面在业务方法之前就失败。
         *
         * @return 不会正常返回
         */
        @Override
        @ApiSignature(timeout = TIMEOUT_SECONDS, message = " ")
        public String blankMessage() {
            throw new AssertionError("验签失败时不应执行到目标方法");
        }

        /**
         * 返回固定标记，确认确实通过了验签并进入业务逻辑。
         *
         * @return 固定标记
         */
        @Override
        @ApiSignature(timeout = TIMEOUT_SECONDS, appId = "x-app", timestamp = "x-ts",
                nonce = "x-nonce", sign = "x-sign")
        public String customHeaderNames() {
            return SUCCEED_MARKER;
        }
    }

    /**
     * 只改写随机数读写行为的受控 DAO，用于稳定复现并发抢占随机数的竞态窗口。
     *
     * <p>只覆盖“读到的随机数始终为空、写入始终失败”这两个观测点，其余行为仍走真实 Redis；
     * 随机数本身的原子占用能力由针对真实 Redis 的 DAO 测试负责。</p>
     */
    static class RaceWinningApiSignatureRedisDAO extends ApiSignatureRedisDAO {

        /**
         * 使用真实字符串模板创建受控 DAO。
         *
         * @param stringRedisTemplate 真实字符串模板
         */
        RaceWinningApiSignatureRedisDAO(StringRedisTemplate stringRedisTemplate) {
            super(stringRedisTemplate);
        }

        /**
         * 始终报告随机数未被使用，模拟校验与落库之间被并发请求抢先的窗口。
         *
         * @param appId 应用编号
         * @param nonce 随机数
         * @return 固定返回 null
         */
        @Override
        public String getNonce(String appId, String nonce) {
            return null;
        }

        /**
         * 始终报告写入失败，模拟另一个并发请求已经占用了同一随机数。
         *
         * @param appId    应用编号
         * @param nonce    随机数
         * @param time     过期时间
         * @param timeUnit 过期时间单位
         * @return 固定返回 false
         */
        @Override
        public Boolean setNonce(String appId, String nonce, int time, TimeUnit timeUnit) {
            return Boolean.FALSE;
        }
    }
}
