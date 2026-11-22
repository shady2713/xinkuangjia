package com.basicframework.module.system.framework.security.sm2;

import com.basicframework.framework.security.config.SecurityProperties;
import org.bouncycastle.asn1.gm.GMNamedCurves;
import org.bouncycastle.asn1.x9.X9ECParameters;
import org.bouncycastle.crypto.engines.SM2Engine;
import org.bouncycastle.crypto.params.ECDomainParameters;
import org.bouncycastle.crypto.params.ECPrivateKeyParameters;
import org.bouncycastle.crypto.params.ECPublicKeyParameters;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.bouncycastle.math.ec.ECPoint;
import org.bouncycastle.util.encoders.Hex;
import org.springframework.stereotype.Component;

import java.math.BigInteger;
import java.security.SecureRandom;
import java.security.Security;
import java.util.regex.Pattern;

/**
 * SM2 密码传输加解密组件，前后端统一使用 C1C3C2 模式。
 *
 * <p>前端 sm-crypto 的 {@code doEncrypt} 返回不带 {@code 04} 前缀的 C1 坐标；
 * BouncyCastle 需要未压缩点前缀，因此本组件对带/不带前缀的输入都做兼容尝试。
 * 公钥以带 {@code 04} 前缀的未压缩点十六进制下发给前端。</p>
 *
 * @author shady2713
 */
@Component
public class Sm2PasswordCipher {

    /** SM2 曲线名称。 */
    private static final String SM2_CURVE_NAME = "sm2p256v1";

    /** 十六进制密文格式。 */
    private static final Pattern HEX_PATTERN = Pattern.compile("^[0-9a-fA-F]+$");

    static {
        // 只在缺失时注册，避免覆盖运行环境已安装的 BouncyCastle Provider。
        if (Security.getProvider(BouncyCastleProvider.PROVIDER_NAME) == null) {
            Security.addProvider(new BouncyCastleProvider());
        }
    }

    /** SM2 曲线域参数。 */
    private final ECDomainParameters domainParameters;

    /** 服务端私钥参数，只在进程内解密时使用。 */
    private final ECPrivateKeyParameters privateKeyParameters;

    /** 与私钥配对的未压缩公钥，包含 04 前缀。 */
    private final String publicKeyHex;

    /** 安全随机源，仅用于 BC 加密测试路径。 */
    private final SecureRandom secureRandom = new SecureRandom();

    /**
     * 按配置的私钥初始化 SM2 曲线和密钥参数。
     *
     * @param securityProperties 安全配置；私钥必须已通过环境变量注入
     * @throws IllegalStateException 私钥缺失或格式错误时抛出，阻止应用在错误配置下启动
     */
    public Sm2PasswordCipher(SecurityProperties securityProperties) {
        String privateKeyHex = securityProperties.getSm2().getPrivateKey();
        if (privateKeyHex == null || !HEX_PATTERN.matcher(privateKeyHex).matches()
                || privateKeyHex.length() != 64) {
            throw new IllegalStateException("SM2 私钥未配置或格式错误，请通过 SM2_PRIVATE_KEY 注入 64 位十六进制私钥");
        }
        X9ECParameters curve = GMNamedCurves.getByName(SM2_CURVE_NAME);
        if (curve == null) {
            throw new IllegalStateException("当前运行环境缺少 SM2 曲线参数");
        }
        this.domainParameters = new ECDomainParameters(curve.getCurve(), curve.getG(),
                curve.getN(), curve.getH());
        BigInteger privateKey = new BigInteger(privateKeyHex, 16);
        if (privateKey.signum() <= 0 || privateKey.compareTo(domainParameters.getN()) >= 0) {
            throw new IllegalStateException("SM2 私钥超出曲线有效范围");
        }
        this.privateKeyParameters = new ECPrivateKeyParameters(privateKey, domainParameters);
        ECPoint publicKey = domainParameters.getG().multiply(privateKey).normalize();
        this.publicKeyHex = Hex.toHexString(publicKey.getEncoded(false));
    }

    /**
     * 获取带 04 前缀的未压缩 SM2 公钥，供前端加密密码。
     *
     * @return 130 位十六进制公钥
     */
    public String getPublicKeyHex() {
        return publicKeyHex;
    }

    /**
     * 解密前端提交的 SM2 密文。
     *
     * <p>优先按标准 04 前缀解析；若失败且输入本身以 04 开头，再尝试把它视为
     * sm-crypto 原始输出补前缀解析，兼容两种前端输出格式。</p>
     *
     * @param ciphertextHex SM2 密文十六进制，C1C3C2 模式
     * @return UTF-8 明文
     * @throws IllegalArgumentException 密文为空、格式非法或解密失败时抛出，不携带明文信息
     */
    public String decrypt(String ciphertextHex) {
        String normalized = normalizeCiphertext(ciphertextHex);
        String plaintext = tryDecrypt(normalized);
        if (plaintext == null) {
            // sm-crypto 原始输出不带 04；带前缀解析失败时补前缀再尝试一次，
            // 同时覆盖原始输出恰好以 04 开头的边界。
            plaintext = tryDecrypt("04" + normalized);
        }
        if (plaintext == null) {
            throw new IllegalArgumentException("SM2 密文解密失败");
        }
        return plaintext;
    }

    /**
     * 使用服务端密钥对加密内容，供测试和跨端样例生成使用。
     *
     * @param plaintext 待加密明文
     * @return 带 04 前缀的 C1C3C2 密文
     */
    public String encrypt(String plaintext) {
        ECPoint publicKey = domainParameters.getG()
                .multiply(privateKeyParameters.getD()).normalize();
        ECPublicKeyParameters publicKeyParameters = new ECPublicKeyParameters(publicKey, domainParameters);
        SM2Engine engine = new SM2Engine(SM2Engine.Mode.C1C3C2);
        engine.init(true, new org.bouncycastle.crypto.params.ParametersWithRandom(publicKeyParameters, secureRandom));
        try {
            byte[] plaintextBytes = plaintext.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            byte[] encrypted = engine.processBlock(plaintextBytes, 0, plaintextBytes.length);
            return Hex.toHexString(encrypted);
        } catch (Exception ex) {
            throw new IllegalStateException("SM2 加密失败", ex);
        }
    }

    /**
     * 校验并规范化十六进制密文。
     *
     * @param ciphertextHex 原始密文
     * @return 去掉空白后的小写密文
     */
    private String normalizeCiphertext(String ciphertextHex) {
        if (ciphertextHex == null) {
            throw new IllegalArgumentException("SM2 密文为空");
        }
        String normalized = ciphertextHex.replaceAll("\\s", "").toLowerCase();
        if (normalized.isEmpty() || normalized.length() % 2 != 0
                || !HEX_PATTERN.matcher(normalized).matches()) {
            throw new IllegalArgumentException("SM2 密文格式非法");
        }
        // C1 至少 64 字节，加 C3 32 字节和最短密文，低于该长度不可能有效。
        if (normalized.length() < 194) {
            throw new IllegalArgumentException("SM2 密文长度非法");
        }
        return normalized;
    }

    /**
     * 尝试一次 BC 解密。
     *
     * @param ciphertextHex 已规范化的密文
     * @return 明文；失败返回 {@code null}
     */
    private String tryDecrypt(String ciphertextHex) {
        try {
            byte[] ciphertext = Hex.decode(ciphertextHex);
            SM2Engine engine = new SM2Engine(SM2Engine.Mode.C1C3C2);
            engine.init(false, privateKeyParameters);
            byte[] plaintext = engine.processBlock(ciphertext, 0, ciphertext.length);
            return new String(plaintext, java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception ex) {
            return null;
        }
    }
}
