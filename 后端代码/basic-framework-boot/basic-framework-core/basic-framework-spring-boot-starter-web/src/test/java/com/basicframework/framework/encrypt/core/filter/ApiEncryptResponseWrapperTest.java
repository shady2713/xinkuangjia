package com.basicframework.framework.encrypt.core.filter;

import cn.hutool.crypto.SecureUtil;
import cn.hutool.crypto.asymmetric.KeyType;
import cn.hutool.crypto.asymmetric.RSA;
import com.basicframework.framework.encrypt.config.ApiEncryptProperties;
import com.basicframework.framework.encrypt.core.util.AesCbcUtils;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;

import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证加密响应包装类把应用写出的明文替换为密文并补齐响应头的契约。
 *
 * <p>该包装类位于加密过滤器输出侧：应用与框架都以为自己在写普通响应，实际字节先落在内存缓冲，
 * 由 {@code encrypt} 统一加密后交给真实响应。若缓冲、刷新或重置语义出错，前端会拿到明文、
 * 截断密文或上一轮响应内容。用例用真实 AES 与真实 RSA 驱动，断言解密回来的正文与响应头，
 * 并覆盖 Servlet 输出流的逐个写入接口。</p>
 *
 * @author shady2713
 */
class ApiEncryptResponseWrapperTest {

    /** 合法的 16 字节 AES 密钥。 */
    private static final String AES_KEY = "CHANGE_ME_KEY_16";
    /** 响应正文明文。 */
    private static final String PLAIN_BODY = "{\"code\":0,\"data\":\"张三\"}";

    /**
     * 通过输出流写入的正文必须被 AES 加密，且加密标识头与跨域暴露头同时补齐。
     */
    @Test
    void outputStreamBodyIsEncryptedWithAes() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        ApiEncryptResponseWrapper wrapper = new ApiEncryptResponseWrapper(response);
        byte[] plain = PLAIN_BODY.getBytes(StandardCharsets.UTF_8);
        wrapper.getOutputStream().write(plain);

        wrapper.encrypt(properties("X-Probe-Encrypt"), AES_KEY, null);

        assertThat(response.getHeader("X-Probe-Encrypt")).isEqualTo("true");
        assertThat(response.getHeader("Access-Control-Expose-Headers")).isEqualTo("X-Probe-Encrypt");
        assertThat(AesCbcUtils.decryptFromBase64(response.getContentAsString(), AES_KEY))
                .as("解密结果必须等于应用写出的明文").isEqualTo(plain);
    }

    /**
     * 通过 Writer 写入的正文即使未显式刷新，也必须在加密前被刷新进缓冲。
     */
    @Test
    void writerBodyIsFlushedBeforeEncryption() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        ApiEncryptResponseWrapper wrapper = new ApiEncryptResponseWrapper(response);
        PrintWriter writer = wrapper.getWriter();
        writer.write(PLAIN_BODY);

        wrapper.encrypt(properties("X-Api-Encrypt"), AES_KEY, null);

        assertThat(wrapper.getWriter()).as("Writer 必须复用同一实例").isSameAs(writer);
        assertThat(AesCbcUtils.decryptFromBase64(response.getContentAsString(), AES_KEY))
                .isEqualTo(PLAIN_BODY.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 重置必须丢弃已写入内容，只加密重置之后写入的字节。
     */
    @Test
    void resetDropsBufferedBody() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        ApiEncryptResponseWrapper wrapper = new ApiEncryptResponseWrapper(response);
        wrapper.getWriter().write("应被丢弃的正文");
        wrapper.flushBuffer();

        wrapper.reset();
        wrapper.getOutputStream().write("保留".getBytes(StandardCharsets.UTF_8));
        wrapper.encrypt(properties("X-Api-Encrypt"), AES_KEY, null);

        assertThat(AesCbcUtils.decryptFromBase64(response.getContentAsString(), AES_KEY))
                .isEqualTo("保留".getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 未提供对称密钥时使用非对称公钥加密，私钥必须能解出原文。
     */
    @Test
    void bodyIsEncryptedWithPublicKeyWhenNoAesKey() throws Exception {
        KeyPair keyPair = SecureUtil.generateKeyPair("RSA");
        RSA rsa = new RSA(keyPair.getPrivate(), keyPair.getPublic());
        MockHttpServletResponse response = new MockHttpServletResponse();
        ApiEncryptResponseWrapper wrapper = new ApiEncryptResponseWrapper(response);
        wrapper.getOutputStream().write(PLAIN_BODY.getBytes(StandardCharsets.UTF_8));

        wrapper.encrypt(properties("X-Api-Encrypt"), null, rsa);

        assertThat(rsa.decryptStr(response.getContentAsString(), KeyType.PrivateKey)).isEqualTo(PLAIN_BODY);
    }

    /**
     * Servlet 输出流的逐个写入接口必须落到同一缓冲，异步就绪状态按实现恒为 false。
     */
    @Test
    void servletOutputStreamExposesAllWriteOverloads() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        ApiEncryptResponseWrapper wrapper = new ApiEncryptResponseWrapper(response);
        var outputStream = wrapper.getOutputStream();
        byte[] expected = {(byte) 'A', (byte) 'B', (byte) 'C', (byte) 'D'};

        outputStream.write('A');
        outputStream.write(new byte[]{(byte) 'B'});
        outputStream.write(new byte[]{(byte) 'X', (byte) 'C', (byte) 'Y'}, 1, 1);
        outputStream.write(new byte[]{(byte) 'D'}, 0, 1);
        assertThat(outputStream.isReady()).as("同步输出流恒为不就绪").isFalse();
        outputStream.setWriteListener(null);

        wrapper.encrypt(properties("X-Api-Encrypt"), AES_KEY, null);

        assertThat(Arrays.equals(AesCbcUtils.decryptFromBase64(response.getContentAsString(), AES_KEY), expected))
                .as("按写入顺序恢复的正文必须为 %s", Arrays.toString(expected)).isTrue();
    }

    /**
     * 构造响应头配置对象。
     *
     * @param header 加密标识响应头名称
     * @return 仅填充被测字段的配置对象
     */
    private static ApiEncryptProperties properties(String header) {
        ApiEncryptProperties properties = new ApiEncryptProperties();
        properties.setHeader(header);
        return properties;
    }

}
