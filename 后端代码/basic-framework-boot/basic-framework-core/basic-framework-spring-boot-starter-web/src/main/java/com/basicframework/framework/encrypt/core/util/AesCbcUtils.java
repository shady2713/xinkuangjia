package com.basicframework.framework.encrypt.core.util;

import cn.hutool.core.util.StrUtil;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;

/**
 * AES-CBC 加解密工具。
 *
 * 密文格式：Base64(16 字节随机 IV + AES-CBC 密文)。
 * @author 李杰
 */
public final class AesCbcUtils {

    private static final String AES = "AES";
    private static final String TRANSFORMATION = "AES/CBC/PKCS5Padding";
    private static final int IV_LENGTH = 16;

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    /**
     * 禁止外部实例化 AesCbcUtils。
     */
    private AesCbcUtils() {
    }

    /**
     * 校验键。
     *
     * @param key 键名
     */
    public static void validateKey(String key) {
        byte[] keyBytes = getKeyBytes(key);
        int length = keyBytes.length;
        if (length != 16 && length != 24 && length != 32) {
            throw new IllegalArgumentException("AES 密钥长度必须为 16、24 或 32 字节");
        }
    }

    /**
     * 完成 encryptToBase64 对应的业务处理。
     *
     * @param plainBytes plainBytes参数
     * @param key 键名
     * @return 方法处理结果
     */
    public static String encryptToBase64(byte[] plainBytes, String key) {
        try {
            byte[] iv = new byte[IV_LENGTH];
            SECURE_RANDOM.nextBytes(iv);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, buildKey(key), new IvParameterSpec(iv));
            byte[] cipherBytes = cipher.doFinal(plainBytes);
            byte[] payload = new byte[iv.length + cipherBytes.length];
            System.arraycopy(iv, 0, payload, 0, iv.length);
            System.arraycopy(cipherBytes, 0, payload, iv.length, cipherBytes.length);
            return Base64.getEncoder().encodeToString(payload);
        } catch (Exception ex) {
            throw new IllegalArgumentException("AES 加密失败", ex);
        }
    }

    /**
     * 完成 decryptFromBase64 对应的业务处理。
     *
     * @param encryptedText encryptedText参数
     * @param key 键名
     * @return 方法处理结果
     */
    public static byte[] decryptFromBase64(String encryptedText, String key) {
        try {
            byte[] payload = Base64.getDecoder().decode(encryptedText);
            if (payload.length <= IV_LENGTH) {
                throw new IllegalArgumentException("AES 解密数据格式不正确");
            }
            byte[] iv = Arrays.copyOfRange(payload, 0, IV_LENGTH);
            byte[] cipherBytes = Arrays.copyOfRange(payload, IV_LENGTH, payload.length);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, buildKey(key), new IvParameterSpec(iv));
            return cipher.doFinal(cipherBytes);
        } catch (Exception ex) {
            throw new IllegalArgumentException("AES 解密失败", ex);
        }
    }

    /**
     * 构建Key。
     */
    private static SecretKeySpec buildKey(String key) {
        return new SecretKeySpec(getKeyBytes(key), AES);
    }

    /**
     * 获取KeyBytes。
     */
    private static byte[] getKeyBytes(String key) {
        if (StrUtil.isBlank(key)) {
            throw new IllegalArgumentException("AES 密钥不能为空");
        }
        return key.getBytes(StandardCharsets.UTF_8);
    }
}
