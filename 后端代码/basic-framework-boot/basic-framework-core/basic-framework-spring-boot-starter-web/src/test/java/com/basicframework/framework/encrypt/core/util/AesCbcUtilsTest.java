package com.basicframework.framework.encrypt.core.util;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * 验证 AES-CBC 共享载荷格式、随机 IV 与密钥校验边界。
 *
 * @author 李杰
 */
class AesCbcUtilsTest {

    private static final String KEY = "CHANGE_ME_KEY_16";
    private static final String PLAIN_TEXT =
            "{\"username\":\"admin\",\"password\":\"CHANGE_ME_PASSWORD\"}";
    private static final String KNOWN_AES_CBC_PAYLOAD =
            "AAAAAAAAAAAAAAAAAAAAAJK53R6JFZD06lutwGl1JYX1fk5EwcDU25SEX3tm4CD13fEAVUy5NuIiziSrad56n+/D/+Olfg2EZBLTJtWiOg4=";

    /**
     * 验证相同明文因随机 IV 产生不同密文，且均可正确解密。
     */
    @Test
    void encryptToBase64_shouldUseRandomIvAndDecrypt() {
        byte[] plainBytes = PLAIN_TEXT.getBytes(StandardCharsets.UTF_8);

        String encrypted = AesCbcUtils.encryptToBase64(plainBytes, KEY);
        String encryptedAgain = AesCbcUtils.encryptToBase64(plainBytes, KEY);

        assertNotEquals(PLAIN_TEXT, encrypted);
        assertNotEquals(encrypted, encryptedAgain);
        assertArrayEquals(plainBytes, AesCbcUtils.decryptFromBase64(encrypted, KEY));
    }

    /**
     * 验证固定零 IV 的共享载荷可以按约定格式解密。
     */
    @Test
    void decryptFromBase64_shouldSupportSharedPayloadFormat() {
        assertArrayEquals(PLAIN_TEXT.getBytes(StandardCharsets.UTF_8),
                AesCbcUtils.decryptFromBase64(KNOWN_AES_CBC_PAYLOAD, KEY));
    }

    /**
     * 验证非标准长度 AES 密钥会被拒绝。
     */
    @Test
    void validateKey_shouldRejectInvalidLength() {
        assertThrows(IllegalArgumentException.class, () -> AesCbcUtils.validateKey("short"));
    }
}
