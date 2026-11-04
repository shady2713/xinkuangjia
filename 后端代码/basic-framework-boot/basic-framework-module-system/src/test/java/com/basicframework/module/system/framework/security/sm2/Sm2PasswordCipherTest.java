package com.basicframework.module.system.framework.security.sm2;

import com.basicframework.framework.security.config.SecurityProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证 SM2 前后端格式兼容和失败输入拒绝。
 *
 * <p>固定密钥和密文只用于测试，不得用于任何部署环境。</p>
 *
 * @author shady2713
 */
class Sm2PasswordCipherTest {

    /** 仅用于测试的 SM2 私钥。 */
    private static final String TEST_PRIVATE_KEY =
            "fab85826985d339820dc4b9914487069e2b67ff67275b67ca00fc1d682d810f6";

    /** 仅用于测试的 SM2 公钥，与私钥配对。 */
    private static final String TEST_PUBLIC_KEY =
            "041a42fd4f982db82edeb82998d0580207d3e0b8d761c2870ddccc0f5244b026"
                    + "05533dcb1753c1a07c12eb088118d3ccf1bdf97f01543cfe6ae9f24b14f3cf9c2a";

    /** 由前端 sm-crypto 生成并补齐 04 前缀的 C1C3C2 样例密文（仅测试）。 */
    private static final String SM_CRYPTO_SAMPLE_CIPHERTEXT =
            "041028dc66cc44069f35939f2305b83254c9944c74b1ef15dd300ebceaf9c4d5"
                    + "823e016a913d01a8d2b0d2388558800be5c66edb4fa1b55e99d61e7eb7a569a8"
                    + "5db50d35bebf011fa7390cd8034d9f1c99f5110a52b1c7324c9fc08b1561873f"
                    + "21594303fcf51b419add112f8ea97def69e722a100a6b762228d3b34caf9e899"
                    + "653e5b591795f0444a4aec303a98d518d290d0ed53c3f214a654bfb4d494b52b"
                    + "331044ed238c981ddc5ad3";

    private Sm2PasswordCipher cipher;

    /**
     * 构造使用测试密钥的加解密组件。
     */
    @BeforeEach
    void setUp() {
        SecurityProperties properties = new SecurityProperties();
        properties.getSm2().setPrivateKey(TEST_PRIVATE_KEY);
        cipher = new Sm2PasswordCipher(properties);
    }

    /** 验证服务端公钥与前端示例公钥一致。 */
    @Test
    void derivesSamePublicKey() {
        assertThat(cipher.getPublicKeyHex()).isEqualTo(TEST_PUBLIC_KEY);
    }

    /** 验证能解密前端 sm-crypto 生成的 04 前缀样例密文。 */
    @Test
    void decryptsSmCryptoCiphertextWith04Prefix() {
        String plaintext = cipher.decrypt(SM_CRYPTO_SAMPLE_CIPHERTEXT);

        assertThat(plaintext).contains("\"p\":\"Test#1234\"");
        assertThat(plaintext).contains("\"t\":1700000000000");
        assertThat(plaintext).contains("\"n\":\"0123456789abcdef0123456789abcdef\"");
    }

    /** 验证不带 04 前缀的 sm-crypto 原始输出也可被兼容解析。 */
    @Test
    void decryptsSmCryptoRawCiphertext() {
        String plaintext = cipher.decrypt(SM_CRYPTO_SAMPLE_CIPHERTEXT.substring(2));

        assertThat(plaintext).contains("\"p\":\"Test#1234\"");
    }

    /** 验证服务端加密后可以还原原始明文。 */
    @Test
    void encryptsAndDecryptsRoundTrip() {
        String plaintext = "{\"p\":\"Another#1\",\"t\":1700000000000,\"n\":\"abcdef0123456789\"}";

        String ciphertext = cipher.encrypt(plaintext);

        assertThat(ciphertext).matches("^[0-9a-f]+$");
        assertThat(cipher.decrypt(ciphertext)).isEqualTo(plaintext);
    }

    /** 验证非法十六进制和非法曲线点都会被拒绝。 */
    @Test
    void rejectsInvalidCiphertext() {
        assertThatThrownBy(() -> cipher.decrypt("not-hex"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> cipher.decrypt("04" + "00".repeat(100)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> cipher.decrypt(""))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
