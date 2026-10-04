package com.basicframework.framework.encrypt.core.filter;

import cn.hutool.crypto.SecureUtil;
import cn.hutool.crypto.asymmetric.KeyType;
import cn.hutool.crypto.asymmetric.RSA;
import com.basicframework.framework.common.biz.infra.logger.ApiErrorLogCommonApi;
import com.basicframework.framework.encrypt.config.ApiEncryptProperties;
import com.basicframework.framework.encrypt.core.annotation.ApiEncrypt;
import com.basicframework.framework.encrypt.core.util.AesCbcUtils;
import com.basicframework.framework.web.config.WebProperties;
import com.basicframework.framework.web.core.handler.GlobalExceptionHandler;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerExecutionChain;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 验证 API 加解密过滤器在真实过滤器链上的注解识别、报文解密、响应加密与失败上报契约。
 *
 * <p>该过滤器是前后端密文约定的唯一执行点：注解识别错误会让明文接口被要求加密、或密文接口被
 * 当成明文解析；解密失败没有转成业务错误会让请求带着密文进入控制器；响应未加密会让前端拿到
 * 无法解析的明文。因此用例使用真实 {@link MockHttpServletRequest}／{@link MockHttpServletResponse}
 * 与真实过滤器链驱动 {@code doFilter}，断言可观察结果：</p>
 * <ul>
 *   <li>无注解且无加密标头的请求必须原样透传，控制器收到的仍是原始请求对象；</li>
 *   <li>声明需要解密的接口缺少加密标头时必须返回业务错误且不得进入过滤器链；</li>
 *   <li>带标头的 POST／PUT／DELETE 请求体必须解密成明文供后续链读取；</li>
 *   <li>声明需要加密的响应必须在链执行完成后整体加密，并补齐标识头；</li>
 *   <li>RSA 配置走非对称分支，请求用私钥解密、响应用公钥加密；</li>
 *   <li>不支持的算法与无法解析的报文必须显式失败，不得静默放行。</li>
 * </ul>
 *
 * <p>处理器映射使用替身只决定"返回哪个 handler"，handler 本身是真实 {@link HandlerMethod}，
 * 因此注解读取逻辑（方法优先、类级兜底）走真实实现；异常上报协作者同样只作替身。</p>
 *
 * @author shady2713
 */
class ApiEncryptFilterTest {

    /** 合法的 16 字节 AES 密钥。 */
    private static final String AES_KEY = "CHANGE_ME_KEY_16";
    /** 请求体明文。 */
    private static final String PLAIN_BODY = "{\"name\":\"张三\"}";
    /** 响应正文明文。 */
    private static final String PLAIN_RESPONSE = "{\"code\":0,\"data\":\"ok\"}";
    /** 被测接口路径，必须落在管理端 API 前缀内才会被过滤器处理。 */
    private static final String API_URI = "/admin-api/probe/encrypted";

    /** 无注解且无加密标头时必须原样透传，链上收到的仍是原始请求对象。 */
    @Test
    void plainRequestWithoutAnnotationPassesThroughUnchanged() throws Exception {
        ApiEncryptFilter filter = filter(aesProperties(), handlerFor("plain"));
        MockHttpServletRequest request = new MockHttpServletRequest("POST", API_URI);
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertThat(chain.getRequest()).as("必须进入后续过滤器链").isSameAs(request);
        assertThat(chain.getResponse()).isSameAs(response);
        assertThat(response.getContentAsString()).as("透传时不得写入任何响应体").isEmpty();
    }

    /** 声明需要解密的接口缺少加密标头时必须返回业务错误，且不得进入过滤器链。 */
    @Test
    void requestOnlyAnnotationRejectsMissingEncryptHeader() throws Exception {
        ApiEncryptFilter filter = filter(aesProperties(), handlerFor("requestOnly"));
        MockHttpServletRequest request = new MockHttpServletRequest("POST", API_URI);
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertThat(chain.getRequest()).as("参数不合法时不得继续过滤器链").isNull();
        assertThat(response.getContentAsString())
                .contains("\"code\":400")
                .contains("请求未包含加密标头，请检查是否正确配置了加密标头");
    }

    /** 带标头的 POST 请求体必须解密成明文，后续链读到的是解密包装对象。 */
    @Test
    void aesEncryptedPostBodyIsDecryptedBeforeChain() throws Exception {
        ApiEncryptFilter filter = filter(aesProperties(), handlerFor("requestOnly"));
        MockHttpServletRequest request = encryptedRequest("POST",
                AesCbcUtils.encryptToBase64(PLAIN_BODY.getBytes(StandardCharsets.UTF_8), AES_KEY));
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertThat(chain.getRequest()).isInstanceOf(ApiDecryptRequestWrapper.class);
        HttpServletRequest chained = (HttpServletRequest) chain.getRequest();
        assertThat(new String(chained.getInputStream().readAllBytes(), StandardCharsets.UTF_8))
                .as("链上必须读到明文").isEqualTo(PLAIN_BODY);
    }

    /** PUT 与 DELETE 同样属于需要解密的请求方法，不能只处理 POST。 */
    @Test
    void aesEncryptedPutAndDeleteBodiesAreDecrypted() throws Exception {
        for (String method : List.of("PUT", "DELETE")) {
            ApiEncryptFilter filter = filter(aesProperties(), handlerFor("requestOnly"));
            MockHttpServletRequest request = encryptedRequest(method,
                    AesCbcUtils.encryptToBase64(PLAIN_BODY.getBytes(StandardCharsets.UTF_8), AES_KEY));
            MockFilterChain chain = new MockFilterChain();

            filter.doFilter(request, new MockHttpServletResponse(), chain);

            assertThat(chain.getRequest()).as("%s 请求必须被解密包装", method)
                    .isInstanceOf(ApiDecryptRequestWrapper.class);
            assertThat(new String(((HttpServletRequest) chain.getRequest()).getInputStream().readAllBytes(),
                    StandardCharsets.UTF_8)).isEqualTo(PLAIN_BODY);
        }
    }

    /**
     * GET 请求即使声明需要解密也不会因缺少标头报错。
     *
     * <p>解密分支只覆盖 POST／PUT／DELETE：GET 没有请求体，当前实现不会触发"缺少标头"的校验，
     * 用例锁定该真实边界，避免调用方以为 GET 也会被拒绝。</p>
     */
    @Test
    void getRequestSkipsDecryptionEvenWhenHeaderMissing() throws Exception {
        ApiEncryptFilter filter = filter(aesProperties(), handlerFor("requestOnly"));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", API_URI);
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertThat(chain.getRequest()).as("GET 直接进入链，不产生错误响应").isSameAs(request);
        assertThat(response.getContentAsString()).isEmpty();
    }

    /** 标头存在但报文无法解密时必须返回系统异常，且不得让密文进入控制器。 */
    @Test
    void undecryptableBodyIsReportedAndChainNotInvoked() throws Exception {
        ApiEncryptFilter filter = filter(aesProperties(), handlerFor("requestOnly"));
        MockHttpServletRequest request = encryptedRequest("POST", "DUMMY-NOT-BASE64-CIPHERTEXT");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertThat(chain.getRequest()).as("解密失败必须中断过滤器链").isNull();
        assertThat(response.getContentAsString()).contains("\"code\":500").contains("系统异常");
    }

    /** 声明需要加密的响应必须在链执行完成后整体加密，并补齐加密标识头。 */
    @Test
    void responseAnnotationEncryptsWrittenBody() throws Exception {
        ApiEncryptFilter filter = filter(aesProperties(), handlerFor("responseOnly"));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", API_URI);
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain(plainTextServlet());

        filter.doFilter(request, response, chain);

        assertThat(chain.getRequest()).as("响应加密不阻止请求进入链").isSameAs(request);
        assertThat(response.getHeader("X-Api-Encrypt")).as("必须标记响应已加密").isEqualTo("true");
        assertThat(response.getHeader("Access-Control-Expose-Headers")).isEqualTo("X-Api-Encrypt");
        assertThat(AesCbcUtils.decryptFromBase64(response.getContentAsString(), AES_KEY))
                .as("解密结果必须等于控制器写出的明文")
                .isEqualTo(PLAIN_RESPONSE.getBytes(StandardCharsets.UTF_8));
    }

    /** RSA 配置下请求用私钥解密、响应用公钥加密，两个方向都必须真实生效。 */
    @Test
    void rsaFilterDecryptsRequestAndEncryptsResponse() throws Exception {
        KeyPair keyPair = SecureUtil.generateKeyPair("RSA");
        RSA rsa = new RSA(keyPair.getPrivate(), keyPair.getPublic());
        ApiEncryptProperties properties = new ApiEncryptProperties();
        properties.setEnable(true);
        properties.setAlgorithm("RSA");
        properties.setRequestKey(rsa.getPrivateKeyBase64());
        properties.setResponseKey(rsa.getPublicKeyBase64());
        ApiEncryptFilter filter = filter(properties, handlerFor("both"));
        MockHttpServletRequest request = encryptedRequest("POST",
                rsa.encryptBase64(PLAIN_BODY.getBytes(StandardCharsets.UTF_8), KeyType.PublicKey));
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain(plainTextServlet());

        filter.doFilter(request, response, chain);

        assertThat(new String(((HttpServletRequest) chain.getRequest()).getInputStream().readAllBytes(),
                StandardCharsets.UTF_8)).as("RSA 请求体必须用私钥解密").isEqualTo(PLAIN_BODY);
        byte[] decrypted = rsa.decrypt(response.getContentAsString(), KeyType.PrivateKey);
        assertThat(new String(decrypted, StandardCharsets.UTF_8)).as("RSA 响应必须能用私钥还原")
                .isEqualTo(PLAIN_RESPONSE);
    }

    /** 不支持的算法必须在构造期显式拒绝，避免运行期静默不加密。 */
    @Test
    void unsupportedAlgorithmIsRejectedOnConstruction() {
        ApiEncryptProperties properties = new ApiEncryptProperties();
        properties.setEnable(true);
        properties.setAlgorithm("SM4");
        properties.setRequestKey(AES_KEY);
        properties.setResponseKey(AES_KEY);

        assertThatThrownBy(() -> filter(properties, handlerFor("plain")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("不支持的加密算法：SM4");
    }

    /** 处理器映射查询失败必须按"无注解"处理并放行，不得让文档接口不可用。 */
    @Test
    void handlerLookupFailureIsTreatedAsNoAnnotation() throws Exception {
        RequestMappingHandlerMapping mapping = mock(RequestMappingHandlerMapping.class);
        when(mapping.getHandler(any())).thenThrow(new IllegalStateException("DUMMY-MAPPING-FAILURE"));
        ApiEncryptFilter filter = new ApiEncryptFilter(new WebProperties(), aesProperties(), mapping,
                globalExceptionHandler());
        MockHttpServletRequest request = new MockHttpServletRequest("POST", API_URI);
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, new MockHttpServletResponse(), chain);

        assertThat(chain.getRequest()).as("映射异常时按无注解透传").isSameAs(request);
    }

    /** 未匹配到处理器或处理器不是控制器方法时都按"无注解"处理。 */
    @Test
    void missingOrNonHandlerMethodIsTreatedAsNoAnnotation() throws Exception {
        RequestMappingHandlerMapping noHandlerMapping = mock(RequestMappingHandlerMapping.class);
        when(noHandlerMapping.getHandler(any())).thenReturn(null);
        ApiEncryptFilter noHandlerFilter = new ApiEncryptFilter(new WebProperties(), aesProperties(),
                noHandlerMapping, globalExceptionHandler());
        MockHttpServletRequest firstRequest = new MockHttpServletRequest("POST", API_URI);
        MockFilterChain firstChain = new MockFilterChain();

        noHandlerFilter.doFilter(firstRequest, new MockHttpServletResponse(), firstChain);

        assertThat(firstChain.getRequest()).as("未匹配处理器时透传").isSameAs(firstRequest);

        RequestMappingHandlerMapping staticResourceMapping = mock(RequestMappingHandlerMapping.class);
        when(staticResourceMapping.getHandler(any()))
                .thenReturn(new HandlerExecutionChain("DUMMY-STATIC-RESOURCE-HANDLER"));
        ApiEncryptFilter staticResourceFilter = new ApiEncryptFilter(new WebProperties(), aesProperties(),
                staticResourceMapping, globalExceptionHandler());
        MockHttpServletRequest secondRequest = new MockHttpServletRequest("POST", API_URI);
        MockFilterChain secondChain = new MockFilterChain();

        staticResourceFilter.doFilter(secondRequest, new MockHttpServletResponse(), secondChain);

        assertThat(secondChain.getRequest()).as("非控制器方法处理器透传").isSameAs(secondRequest);
    }

    /** 类级注解必须对其未单独声明注解的方法生效。 */
    @Test
    void annotationOnControllerTypeAppliesToItsMethods() throws Exception {
        ApiEncryptFilter filter = filter(aesProperties(), handlerFor("inherited"));
        MockHttpServletRequest request = new MockHttpServletRequest("POST", API_URI);
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertThat(chain.getRequest()).as("类级注解声明需要解密，缺少标头必须拒绝").isNull();
        assertThat(response.getContentAsString()).contains("请求未包含加密标头");
    }

    /**
     * 构造被测过滤器。
     *
     * @param properties 加解密配置
     * @param handlerChain 处理器映射固定返回的链
     * @return 装配完成的过滤器
     */
    private static ApiEncryptFilter filter(ApiEncryptProperties properties, HandlerExecutionChain handlerChain) {
        RequestMappingHandlerMapping mapping = mock(RequestMappingHandlerMapping.class);
        try {
            when(mapping.getHandler(any())).thenReturn(handlerChain);
        } catch (Exception failure) {
            throw new IllegalStateException("替身桩设置失败", failure);
        }
        return new ApiEncryptFilter(new WebProperties(), properties, mapping, globalExceptionHandler());
    }

    /**
     * 构造固定返回指定控制器方法的处理器链。
     *
     * @param methodName 探针控制器的方法名
     * @return 含真实 {@link HandlerMethod} 的处理器链
     */
    private static HandlerExecutionChain handlerFor(String methodName) {
        try {
            if ("inherited".equals(methodName)) {
                AnnotatedProbeController controller = new AnnotatedProbeController();
                return new HandlerExecutionChain(
                        new HandlerMethod(controller, AnnotatedProbeController.class.getMethod(methodName)));
            }
            ProbeController controller = new ProbeController();
            return new HandlerExecutionChain(new HandlerMethod(controller, ProbeController.class.getMethod(methodName)));
        } catch (NoSuchMethodException failure) {
            throw new IllegalStateException("探针控制器方法不存在", failure);
        }
    }

    /** 构造带加密标头与密文正文的请求。 */
    private static MockHttpServletRequest encryptedRequest(String method, String body) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, API_URI);
        request.addHeader("X-Api-Encrypt", "true");
        request.setContentType("application/json");
        request.setContent(body.getBytes(StandardCharsets.UTF_8));
        return request;
    }

    /** 构造向响应写出固定明文的 Servlet，用于观察响应加密结果。 */
    private static HttpServlet plainTextServlet() {
        return new HttpServlet() {

            /** 把固定明文写入响应，模拟控制器输出。 */
            @Override
            protected void service(HttpServletRequest request, HttpServletResponse response) throws java.io.IOException {
                response.setContentType("application/json");
                response.getWriter().write(PLAIN_RESPONSE);
            }
        };
    }

    /** 构造满足 AES 分支校验的加解密配置。 */
    private static ApiEncryptProperties aesProperties() {
        ApiEncryptProperties properties = new ApiEncryptProperties();
        properties.setEnable(true);
        properties.setAlgorithm("AES");
        properties.setRequestKey(AES_KEY);
        properties.setResponseKey(AES_KEY);
        return properties;
    }

    /** 构造全局异常处理器，异常日志上报协作者按进程外边界替换为替身。 */
    private static GlobalExceptionHandler globalExceptionHandler() {
        return new GlobalExceptionHandler("basic-framework-test", mock(ApiErrorLogCommonApi.class));
    }

    /**
     * 探针控制器，覆盖方法级注解的三种取值。
     *
     * @author shady2713
     */
    public static class ProbeController {

        /** 无注解方法，用于验证透传。 */
        public void plain() {
        }

        /** 只要求解密的方法，默认注解即 request=true、response=false 的等价形态。 */
        @ApiEncrypt(response = false)
        public void requestOnly() {
        }

        /** 只要求加密响应的方法。 */
        @ApiEncrypt(request = false)
        public void responseOnly() {
        }

        /** 请求与响应都加解密的方法。 */
        @ApiEncrypt
        public void both() {
        }
    }

    /**
     * 类级注解探针控制器，方法自身不声明注解。
     *
     * @author shady2713
     */
    @ApiEncrypt(response = false)
    public static class AnnotatedProbeController {

        /** 未声明注解的方法，注解必须来自类级配置。 */
        public void inherited() {
        }
    }

}
