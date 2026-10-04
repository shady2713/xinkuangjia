package com.basicframework.framework.encrypt.core.filter;

import cn.hutool.crypto.SecureUtil;
import cn.hutool.crypto.asymmetric.KeyType;
import cn.hutool.crypto.asymmetric.RSA;
import com.basicframework.framework.encrypt.core.util.AesCbcUtils;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import java.io.BufferedReader;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证解密请求包装类把加密请求体替换为明文后的可读契约。
 *
 * <p>该包装类让后续过滤器与控制器像读取普通请求一样读取解密后的报文：内容长度、输入流与
 * 读取器都必须指向解密后的字节，否则业务会读到密文或截断内容。用例用真实 AES 与真实 RSA
 * 加密报文驱动，断言可观察的读取结果与长度，并覆盖 Servlet 输入流的异步读取接口。</p>
 *
 * @author shady2713
 */
class ApiDecryptRequestWrapperTest {

    /** 合法的 16 字节 AES 密钥。 */
    private static final String AES_KEY = "CHANGE_ME_KEY_16";
    /** 请求体明文。 */
    private static final String PLAIN_BODY = "{\"name\":\"张三\",\"amount\":100}";

    /** AES 加密的请求体必须被解密，且长度、读取器与输入流都指向明文。 */
    @Test
    void aesEncryptedBodyIsDecryptedForEveryReadEntry() throws Exception {
        MockHttpServletRequest request = requestWithBody(
                AesCbcUtils.encryptToBase64(PLAIN_BODY.getBytes(StandardCharsets.UTF_8), AES_KEY));

        ApiDecryptRequestWrapper wrapper = new ApiDecryptRequestWrapper(request, AES_KEY, null);

        byte[] expected = PLAIN_BODY.getBytes(StandardCharsets.UTF_8);
        assertThat(wrapper.getContentLength()).as("内容长度必须是明文字节数").isEqualTo(expected.length);
        assertThat(wrapper.getContentLengthLong()).isEqualTo((long) expected.length);
        assertThat(wrapper.getInputStream().readAllBytes()).as("输入流必须给出明文").isEqualTo(expected);
        try (BufferedReader reader = wrapper.getReader()) {
            assertThat(reader.readLine()).as("读取器必须给出明文").isEqualTo(PLAIN_BODY);
        }
    }

    /** 非对称加密的请求体必须用私钥解密，两种密钥形态互不干扰。 */
    @Test
    void rsaEncryptedBodyIsDecryptedWithPrivateKey() throws Exception {
        KeyPair keyPair = SecureUtil.generateKeyPair("RSA");
        RSA rsa = new RSA(keyPair.getPrivate(), keyPair.getPublic());
        String encrypted = rsa.encryptBase64(PLAIN_BODY.getBytes(StandardCharsets.UTF_8), KeyType.PublicKey);

        ApiDecryptRequestWrapper wrapper = new ApiDecryptRequestWrapper(requestWithBody(encrypted), null, rsa);

        assertThat(new String(wrapper.getInputStream().readAllBytes(), StandardCharsets.UTF_8)).isEqualTo(PLAIN_BODY);
    }

    /**
     * Servlet 输入流的读取与状态接口必须按实现返回，异步监听注册不得抛错。
     *
     * <p>{@code available} 返回整体长度而非剩余长度、{@code isFinished}/{@code isReady} 恒为 false，
     * 都是当前实现的真实行为；调用方据此不能在同步链路上依赖就绪状态。</p>
     */
    @Test
    void servletInputStreamExposesImplementationBehaviour() throws Exception {
        ApiDecryptRequestWrapper wrapper = new ApiDecryptRequestWrapper(
                requestWithBody(AesCbcUtils.encryptToBase64(PLAIN_BODY.getBytes(StandardCharsets.UTF_8), AES_KEY)),
                AES_KEY, null);
        byte[] expected = PLAIN_BODY.getBytes(StandardCharsets.UTF_8);

        var inputStream = wrapper.getInputStream();
        assertThat(inputStream.available()).as("可用字节数按实现返回整体长度").isEqualTo(expected.length);
        assertThat(inputStream.isFinished()).as("同步读取流恒为未完成").isFalse();
        assertThat(inputStream.isReady()).as("同步读取流恒为不就绪").isFalse();
        assertThat(inputStream.read()).as("逐字节读取必须返回首个明文字节").isEqualTo(expected[0] & 0xFF);
        assertThat(inputStream.readAllBytes()).as("剩余内容必须可继续读取")
                .isEqualTo(java.util.Arrays.copyOfRange(expected, 1, expected.length));
        assertThat(inputStream.read()).as("读到末尾必须返回 -1").isEqualTo(-1);
        inputStream.setReadListener(null);
    }

    /** 构造带真实请求体字节的请求对象。 */
    private static MockHttpServletRequest requestWithBody(String body) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setContent(body.getBytes(StandardCharsets.UTF_8));
        return request;
    }

}
