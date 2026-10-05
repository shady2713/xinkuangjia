package com.basicframework.framework.encrypt.core.util;

import org.junit.jupiter.api.Test;

import javax.crypto.BadPaddingException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * 验证 AES-CBC 共享载荷格式、随机 IV、密钥校验与失败收敛边界。
 *
 * <p>加解密是前端与后端之间的共享协议：载荷格式（前 16 字节 IV + 密文）一旦变化，
 * 旧版本前端立刻无法解密；失败路径若不收敛为明确的 {@link IllegalArgumentException}，
 * 调用方会把“数据不完整”“密钥不匹配”“实现故障”混为一类，排查成本很高。
 * 因此这里同时锁定正常往返、固定载荷兼容、密钥边界与四类失败提示。</p>
 *
 * @author 李杰
 */
class AesCbcUtilsTest {

    private static final String KEY = "CHANGE_ME_KEY_16";

    /** 与 {@link #KEY} 等长但内容不同的错误密钥，两条固定夹具共用它，使路径差异只来自载荷本身。 */
    private static final String WRONG_KEY = "OTHER_KEY_16BYTE";

    private static final String PLAIN_TEXT =
            "{\"username\":\"admin\",\"password\":\"CHANGE_ME_PASSWORD\"}";

    /**
     * 固定夹具 1：错误密钥下必然解密失败的共享格式载荷。
     *
     * <p>零 IV 载荷，正确密钥解出的正是 {@link #PLAIN_TEXT}；换成 {@link #WRONG_KEY} 后末块明文被打乱，
     * 其末字节不是合法的 PKCS5 填充长度，因此解密必然失败，而不是“可能失败”。</p>
     */
    private static final String KNOWN_AES_CBC_PAYLOAD =
            "AAAAAAAAAAAAAAAAAAAAAJK53R6JFZD06lutwGl1JYX1fk5EwcDU25SEX3tm4CD13fEAVUy5NuIiziSrad56n+/D/+Olfg2EZBLTJtWiOg4=";

    /**
     * 固定夹具 2：错误密钥下必然解密成功但结果与原明文不同的共享格式载荷。
     *
     * <p>与夹具 1 共用同一明文、同一正确密钥、同一错误密钥，只有 IV 不同：
     * {@code 00000000000000000000000000000238}。该 IV 使错误密钥解出的填充块末字节恰好为 {@code 0x01}，
     * 即 PKCS5 填充合法，因此“解密成功”这条路径每次都确定命中。夹具按如下方式离线构造：固定明文与两个
     * 密钥，令 IV 从 0 递增枚举，对每个 IV 生成合法载荷并用错误密钥试解，取第一个填充合法者（本例为第
     * 569 个），把载荷与解出结果固化成常量；AES-CBC 的解密结果是（密文，密钥）的确定函数，所以固化后
     * 永远走同一条路径，不依赖随机 IV 去碰约 0.4% 的合法填充概率。</p>
     */
    private static final String WRONG_KEY_DECRYPTABLE_PAYLOAD =
            "AAAAAAAAAAAAAAAAAAACON0yzYzUqXXF4NXr9mXixzf/dOqMV8WbGDUsMV5Hb2Fv7xVHG7WtD7/h2loHLTl2KRmlqeqeMlHXWiJObDeay/w=";

    /** 夹具 2 在错误密钥下解出的确切字节（Base64），用于把“解密成功但结果不同”的路径逐字节锁死。 */
    private static final String WRONG_KEY_DECRYPTED_BASE64 =
            "9njVt3JiU3uF2VPfK6iAmYQ56ZX0w0FDmWIPSP1Bbzn6wWxnr3VtW7D3rRUe88ascz6Rxlk0rC8wAVlYcEMe";

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
        assertThrows(IllegalArgumentException.class, () -> AesCbcUtils.validateKey("CHANGE_ME_KEY_16" + "X"));
    }

    /**
     * 验证 16、24、32 字节三种合法密钥长度都能通过校验。
     *
     * <p>校验器在合法长度下必须正常返回：只在非法分支返回而不走完正常路径时，
     * 启动装配会误判为失败，且覆盖不到真实放行分支。</p>
     */
    @Test
    void validateKey_shouldAcceptStandardKeyLengths() {
        AesCbcUtils.validateKey("DUMMY-KEY-16BYTE");
        AesCbcUtils.validateKey("DUMMY-KEY-24BYTES-LENGTH");
        AesCbcUtils.validateKey("DUMMY-KEY-32-BYTES-LENGTH-VALUE!");
    }

    /** 验证空白密钥在加解密与校验入口都被拒绝，且提示指向密钥本身而不是通用失败。 */
    @Test
    void blankKey_shouldBeRejectedWithKeyMessage() {
        for (String blank : new String[] {null, "", "   "}) {
            IllegalArgumentException failure = assertThrows(IllegalArgumentException.class,
                    () -> AesCbcUtils.validateKey(blank));
            assertEquals("AES 密钥不能为空", failure.getMessage());

            IllegalArgumentException encryptFailure = assertThrows(IllegalArgumentException.class,
                    () -> AesCbcUtils.encryptToBase64(PLAIN_TEXT.getBytes(StandardCharsets.UTF_8), blank));
            assertEquals("AES 加密失败", encryptFailure.getMessage());
        }
    }

    /**
     * 验证加密阶段的失败统一收敛为带原因的 IllegalArgumentException。
     *
     * <p>明文为空时底层 {@code Cipher.doFinal} 抛出的空指针若直接外泄，调用方无法区分
     * “参数缺失”和“加密实现故障”，因此统一包装并保留原始异常作为 cause。</p>
     */
    @Test
    void encryptToBase64_shouldWrapFailureWithCause() {
        IllegalArgumentException failure = assertThrows(IllegalArgumentException.class,
                () -> AesCbcUtils.encryptToBase64(null, KEY));

        assertEquals("AES 加密失败", failure.getMessage());
        assertNotNull(failure.getCause());
    }

    /** 验证密钥长度非法时加密同样失败，不得生成任何密文。 */
    @Test
    void encryptToBase64_shouldRejectInvalidKeyLength() {
        IllegalArgumentException failure = assertThrows(IllegalArgumentException.class,
                () -> AesCbcUtils.encryptToBase64(PLAIN_TEXT.getBytes(StandardCharsets.UTF_8), "short"));

        assertEquals("AES 加密失败", failure.getMessage());
    }

    /**
     * 验证长度不足一个 IV 的载荷按解密失败对外报告，原始原因保留在 cause 中。
     *
     * <p>实现内部先抛出“AES 解密数据格式不正确”，但该异常位于同一个 try 块内，
     * 会被兜底的 catch 重新包装成“AES 解密失败”，因此调用方实际观察到的是后者。
     * 本用例锁定真实可观察结果，并把内部提示固定在 cause 上，避免断言一个不可达文案。</p>
     */
    @Test
    void decryptFromBase64_shouldRejectPayloadWithoutCipherBytes() {
        String tooShort = Base64.getEncoder().encodeToString(new byte[16]);

        IllegalArgumentException failure = assertThrows(IllegalArgumentException.class,
                () -> AesCbcUtils.decryptFromBase64(tooShort, KEY));

        assertEquals("AES 解密失败", failure.getMessage());
        assertNotNull(failure.getCause());
        assertEquals("AES 解密数据格式不正确", failure.getCause().getMessage());
    }

    /**
     * 验证仅比一个 IV 多一字节的载荷（不足一个分组）在解密阶段失败并收敛为解密失败。
     *
     * <p>该长度已通过“大于 IV 长度”的格式检查，失败来自底层分组解密，说明格式检查只负责
     * 挡住明显不完整的载荷，真正的完整性仍由解密本身保证。</p>
     */
    @Test
    void decryptFromBase64_shouldRejectPayloadAtBoundaryLength() {
        String boundary = Base64.getEncoder().encodeToString(new byte[17]);

        IllegalArgumentException failure = assertThrows(IllegalArgumentException.class,
                () -> AesCbcUtils.decryptFromBase64(boundary, KEY));

        assertEquals("AES 解密失败", failure.getMessage());
        assertNotNull(failure.getCause());
    }

    /** 验证非法 Base64 文本被收敛为解密失败，且错误提示不回显原始密文内容。 */
    @Test
    void decryptFromBase64_shouldWrapMalformedBase64() {
        String malformed = "!!!not-base64!!!";

        IllegalArgumentException failure = assertThrows(IllegalArgumentException.class,
                () -> AesCbcUtils.decryptFromBase64(malformed, KEY));

        assertEquals("AES 解密失败", failure.getMessage());
        assertNotNull(failure.getCause());
        assertThat(failure.getMessage()).as("错误提示不得回显原始密文").doesNotContain(malformed);
    }

    /** 验证密文被篡改或密钥不匹配时解密失败，不能返回部分明文。 */
    @Test
    void decryptFromBase64_shouldFailWhenCipherTextIsTampered() {
        byte[] plainBytes = PLAIN_TEXT.getBytes(StandardCharsets.UTF_8);
        byte[] payload = Base64.getDecoder().decode(AesCbcUtils.encryptToBase64(plainBytes, KEY));
        // 必须翻转"最后一个密文块之前"的那一块的末字节：CBC 下它确定性地翻转末块明文的
        // 最后一个字节，也就是 PKCS5 填充长度字节，因此填充必然非法、解密必然失败。
        // 若翻转最后一个密文块自身的字节，雪崩效应会把整块明文随机化，填充恰好合法的
        // 概率约为 1/256（实测 20000 次有 93 次未抛错），断言会偶发失败。
        payload[payload.length - 17] ^= 0x01;
        String tampered = Base64.getEncoder().encodeToString(payload);

        IllegalArgumentException failure = assertThrows(IllegalArgumentException.class,
                () -> AesCbcUtils.decryptFromBase64(tampered, KEY));
        assertEquals("AES 解密失败", failure.getMessage());
    }

    /**
     * 验证固定夹具 1 在错误密钥下必然走“解密失败”路径。
     *
     * <p>夹具本身先用正确密钥自证：同一份载荷必须还原出确切明文，否则它就不是共享格式的合法载荷，
     * 错误密钥下的失败也就没有意义。错误密钥下的失败还必须落在 PKCS5 填充校验上（cause 为
     * {@link BadPaddingException}），才能排除“失败其实来自格式或 Base64”的误判。</p>
     */
    @Test
    void decryptFromBase64_shouldFailOnFixedPayloadWithWrongKey() {
        assertArrayEquals(PLAIN_TEXT.getBytes(StandardCharsets.UTF_8),
                AesCbcUtils.decryptFromBase64(KNOWN_AES_CBC_PAYLOAD, KEY));

        IllegalArgumentException failure = assertThrows(IllegalArgumentException.class,
                () -> AesCbcUtils.decryptFromBase64(KNOWN_AES_CBC_PAYLOAD, WRONG_KEY));

        assertEquals("AES 解密失败", failure.getMessage());
        assertThat(failure.getCause())
                .as("错误密钥下必须因 PKCS5 填充非法而失败")
                .isInstanceOf(BadPaddingException.class);
    }

    /**
     * 验证固定夹具 2 在错误密钥下必然走“解密成功但结果与原明文不同”路径。
     *
     * <p>夹具同样先用正确密钥自证可还原确切明文；再用错误密钥解密时必须成功返回，且结果既不能等于原
     * 明文，也不能是别的随机值——固定载荷下解出结果逐字节唯一，因此直接锁定其确切字节，把这条路径从
     * “0.4% 概率偶发命中”变成每次都命中的确定性覆盖。</p>
     */
    @Test
    void decryptFromBase64_shouldReturnDifferentPlainTextOnFixedPayloadWithWrongKey() {
        byte[] plainBytes = PLAIN_TEXT.getBytes(StandardCharsets.UTF_8);
        assertArrayEquals(plainBytes, AesCbcUtils.decryptFromBase64(WRONG_KEY_DECRYPTABLE_PAYLOAD, KEY));

        byte[] recovered = AesCbcUtils.decryptFromBase64(WRONG_KEY_DECRYPTABLE_PAYLOAD, WRONG_KEY);

        assertThat(recovered)
                .as("错误密钥绝不能还原出原明文")
                .isNotEqualTo(plainBytes);
        assertThat(Base64.getEncoder().encodeToString(recovered))
                .as("错误密钥下的解出结果由固定载荷唯一确定，必须逐字节等于该值")
                .isEqualTo(WRONG_KEY_DECRYPTED_BASE64);
    }

    /**
     * 验证固定夹具 2 确实是“错误密钥必然解密失败”这一朴素断言的反例。
     *
     * <p>偶发通过不能当契约：只有把反例固化下来，“错误密钥”用例才不会退化成每次都会抛错的假覆盖。
     * 夹具 2 一旦因实现或常量变化退回失败路径，本用例立即失败，提示维护者重新构造命中成功路径的夹具。</p>
     */
    @Test
    void wrongKeyFixture_shouldDisproveNeverRecoveredAssertion() {
        assertThatThrownBy(() -> assertThrows(IllegalArgumentException.class,
                () -> AesCbcUtils.decryptFromBase64(WRONG_KEY_DECRYPTABLE_PAYLOAD, WRONG_KEY)))
                .as("夹具 2 必须让“错误密钥必然解密失败”的断言失败，否则它没有覆盖成功路径")
                .isInstanceOf(AssertionError.class);
    }

    /**
     * 验证随机载荷下错误密钥不能还原出原明文。
     *
     * <p>AES-CBC 只保证机密性，不保证错误密钥一定解密失败：错误密钥下明文块是随机的，
     * PKCS5 填充恰好合法的概率实测约 0.4%（两次 20000 次随机 IV 分别成功 84 次与 74 次）。
     * 因此这里断言真正成立的密码学性质——要么解密失败，要么结果与原明文不同，绝不会还原出原明文；
     * 断言“必然抛错”会把随机通过当成契约，造成偶发红灯。两条路径本身已由固定夹具用例
     * {@code decryptFromBase64_shouldFailOnFixedPayloadWithWrongKey} 与
     * {@code decryptFromBase64_shouldReturnDifferentPlainTextOnFixedPayloadWithWrongKey} 确定覆盖，
     * 本用例只负责随机载荷下的性质不被破坏。</p>
     */
    @Test
    void decryptFromBase64_shouldNeverRecoverPlainTextWithWrongKey() {
        byte[] plainBytes = PLAIN_TEXT.getBytes(StandardCharsets.UTF_8);
        String cipherText = AesCbcUtils.encryptToBase64(plainBytes, KEY);

        byte[] recovered = null;
        try {
            recovered = AesCbcUtils.decryptFromBase64(cipherText, WRONG_KEY);
        } catch (IllegalArgumentException failure) {
            assertEquals("AES 解密失败", failure.getMessage());
        }
        if (recovered != null) {
            assertThat(recovered).as("错误密钥绝不能还原出原明文").isNotEqualTo(plainBytes);
        }
    }
}
