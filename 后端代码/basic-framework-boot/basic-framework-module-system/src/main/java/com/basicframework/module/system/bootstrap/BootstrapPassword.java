package com.basicframework.module.system.bootstrap;

import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HexFormat;

/**
 * 一次性初始化的明文强度边界与既有浏览器 MD5、服务端 BCrypt 协议适配。
 *
 * @author shady2713
 */
final class BootstrapPassword {

    /** 口令必须覆盖的字符类别数下限（大写、小写、数字、特殊字符）。 */
    private static final int MIN_CHARACTER_CATEGORIES = 3;

    /** 工具类不允许实例化。 */
    private BootstrapPassword() {
    }

    /**
     * 以 UTF-8 小写 MD5 对接当前登录协议，再用 BCrypt cost 10 存储。
     *
     * @param plaintext 明文口令，12–128 个 Unicode 码点，至少三类字符；所有权属于调用方
     * @return 仅供写入数据库的 BCrypt 摘要，不得输出
     * @throws BootstrapFailure 强度不足、控制字符、非法 Unicode 或首尾空白；不会静默 trim
     */
    static String encode(char[] plaintext) {
        validate(plaintext);
        ByteBuffer bytes = null;
        byte[] digest = null;
        try {
            bytes = StandardCharsets.UTF_8.newEncoder().encode(CharBuffer.wrap(plaintext));
            MessageDigest md5 = MessageDigest.getInstance("MD5");
            md5.update(bytes);
            digest = md5.digest();
            return new BCryptPasswordEncoder(10).encode(HexFormat.of().formatHex(digest));
        } catch (CharacterCodingException exception) {
            throw new BootstrapFailure(BootstrapFailure.Reason.PASSWORD_POLICY);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("Required password protocol digest unavailable");
        } finally {
            if (bytes != null && bytes.hasArray()) {
                Arrays.fill(bytes.array(), (byte) 0);
            }
            if (digest != null) {
                Arrays.fill(digest, (byte) 0);
            }
        }
    }

    /** 空白不算特殊字符类别，首尾空白与控制字符直接拒绝，内部普通空格按原样保留。 */
    private static void validate(char[] plaintext) {
        if (plaintext == null || plaintext.length == 0) {
            throw new BootstrapFailure(BootstrapFailure.Reason.PASSWORD_POLICY);
        }
        int count = Character.codePointCount(plaintext, 0, plaintext.length);
        if (count < 12 || count > 128 || isSpace(Character.codePointAt(plaintext, 0))
                || isSpace(Character.codePointBefore(plaintext, plaintext.length))) {
            throw new BootstrapFailure(BootstrapFailure.Reason.PASSWORD_POLICY);
        }
        int categories = 0;
        for (int offset = 0; offset < plaintext.length;) {
            int point = Character.codePointAt(plaintext, offset);
            offset += Character.charCount(point);
            if (Character.isISOControl(point) || Character.getType(point) == Character.FORMAT) {
                throw new BootstrapFailure(BootstrapFailure.Reason.PASSWORD_POLICY);
            }
            if (Character.isUpperCase(point)) {
                categories |= 1;
            } else if (Character.isLowerCase(point)) {
                categories |= 2;
            } else if (Character.isDigit(point)) {
                categories |= 4;
            } else if (!isSpace(point)) {
                categories |= 8;
            }
        }
        if (Integer.bitCount(categories) < MIN_CHARACTER_CATEGORIES) {
            throw new BootstrapFailure(BootstrapFailure.Reason.PASSWORD_POLICY);
        }
    }

    /** 同时识别 Unicode 空白和不可断空格，防止空白被误算为特殊字符。 */
    private static boolean isSpace(int point) {
        return Character.isWhitespace(point) || Character.isSpaceChar(point);
    }
}
