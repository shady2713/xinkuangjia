package com.basicframework.framework.mybatis.core.type;

import cn.hutool.core.lang.Assert;
import cn.hutool.extra.spring.SpringUtil;
import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.Base64;

/**
 * 用随机 IV 的 AES-CBC 与 HMAC 完整性校验保护数据库字符串字段。
 *
 * <p>通过 mybatis-plus.encryptor.password 配置 16、24 或 32 字节 UTF-8 密钥。
 * 存储格式为 v1: + Base64(16 字节 IV + CBC 密文 + 32 字节 HMAC-SHA256)，
 * 版本前缀也参与认证；无此前缀的值拒绝读取，不能回退为明文。</p>
 *
 * @author 李杰
 */
public class EncryptTypeHandler extends BaseTypeHandler<String> {

    private static final String ENCRYPTOR_PROPERTY_NAME = "mybatis-plus.encryptor.password";

    private static final String VERSION_PREFIX = "v1:";
    private static final String TRANSFORMATION = "AES/CBC/PKCS5Padding";
    private static final String MAC_ALGORITHM = "HmacSHA256";
    private static final int IV_LENGTH = 16;
    private static final int MAC_LENGTH = 32;
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    /**
     * 将非空业务值加密后写入 JDBC，避免明文进入数据库及其备份。
     *
     * @param ps 调用方管理生命周期的预编译语句
     * @param i 从 1 开始的参数序号
     * @param parameter 待加密的业务值；空串作为独立业务值加密
     * @param jdbcType MyBatis 声明的 JDBC 类型
     * @throws SQLException JDBC 写入失败时抛出
     * @throws IllegalArgumentException 密钥为空时抛出
     * @throws IllegalStateException 密钥不合法或加密失败时抛出，不写入明文
     */
    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, String parameter, JdbcType jdbcType) throws SQLException {
        ps.setString(i, encrypt(parameter));
    }

    /**
     * 按列名读取经过认证的明文；SQL NULL 保留为空，非法密文拒绝读取。
     *
     * @param rs 调用方管理生命周期的结果集
     * @param columnName 数据库列名
     * @return 还原的业务值；SQL NULL 返回 null
     * @throws SQLException JDBC 读取失败时抛出
     * @throws IllegalArgumentException 密钥为空或密文格式、认证、解密失败时抛出
     */
    @Override
    public String getNullableResult(ResultSet rs, String columnName) throws SQLException {
        String value = rs.getString(columnName);
        return decrypt(value);
    }

    /**
     * 按列序号读取经过认证的明文，使索引读取与列名读取遵守相同边界。
     *
     * @param rs 调用方管理生命周期的结果集
     * @param columnIndex 从 1 开始的数据库列序号
     * @return 还原的业务值；SQL NULL 返回 null
     * @throws SQLException JDBC 读取失败时抛出
     * @throws IllegalArgumentException 密钥为空或密文格式、认证、解密失败时抛出
     */
    @Override
    public String getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        String value = rs.getString(columnIndex);
        return decrypt(value);
    }

    /**
     * 解密存储过程的输出值，避免此读取入口绕过密文认证。
     *
     * @param cs 调用方管理生命周期的存储过程语句
     * @param columnIndex 从 1 开始的输出参数序号
     * @return 还原的业务值；SQL NULL 返回 null
     * @throws SQLException JDBC 读取失败时抛出
     * @throws IllegalArgumentException 密钥为空或密文格式、认证、解密失败时抛出
     */
    @Override
    public String getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        String value = cs.getString(columnIndex);
        return decrypt(value);
    }

    /**
     * 先验证版本、布局和认证标签，再解密，防止 CBC 篡改结果进入业务层。
     *
     * @param value 带版本前缀的存储值；null 表示 SQL NULL
     * @return UTF-8 业务值；输入为 null 时返回 null
     * @throws IllegalArgumentException 配置缺失、格式错误或密文无法认证和解密时抛出
     */
    private static String decrypt(String value) {
        if (value == null) {
            return null;
        }
        if (!value.startsWith(VERSION_PREFIX)) {
            throw new IllegalArgumentException("字段密文无效");
        }
        byte[] payload;
        try {
            payload = Base64.getDecoder().decode(value.substring(VERSION_PREFIX.length()));
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("字段密文无效", exception);
        }
        int cipherLength = payload.length - IV_LENGTH - MAC_LENGTH;
        // 空串加密也产生一个填充块，缺 IV、认证标签或完整密文块都不能视为合法值。
        if (cipherLength < IV_LENGTH || cipherLength % IV_LENGTH != 0) {
            throw new IllegalArgumentException("字段密文无效");
        }
        byte[] key = getKeyBytes();
        try {
            int authenticatedLength = payload.length - MAC_LENGTH;
            byte[] authenticatedBytes = Arrays.copyOf(payload, authenticatedLength);
            byte[] storedMac = Arrays.copyOfRange(payload, authenticatedLength, payload.length);
            if (!MessageDigest.isEqual(storedMac, authenticate(key, authenticatedBytes))) {
                throw new IllegalArgumentException("字段密文无效");
            }
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"),
                    new IvParameterSpec(Arrays.copyOf(payload, IV_LENGTH)));
            byte[] plainBytes = cipher.doFinal(payload, IV_LENGTH, cipherLength);
            return new String(plainBytes, StandardCharsets.UTF_8);
        } catch (GeneralSecurityException exception) {
            throw new IllegalArgumentException("字段密文无效", exception);
        }
    }

    /**
     * 为每次字段写入生成独立 IV 和认证标签，隐藏相同明文的重复模式。
     *
     * <p>每次调用使用独立 Cipher 与 Mac，线程间不共享 IV 或运算状态；
     * null 不触发加密，空串正常加密。没有旧格式回退，失败不会返回明文。</p>
     *
     * @param rawValue 待保护的 UTF-8 业务字符串，可为 null 或空串
     * @return 带 v1: 前缀的认证密文；输入为 null 时返回 null
     * @throws IllegalArgumentException 密钥配置为空时抛出
     * @throws IllegalStateException 密钥不合法或 JDK 加密运算失败时抛出
     */
    public static String encrypt(String rawValue) {
        if (rawValue == null) {
            return null;
        }
        byte[] key = getKeyBytes();
        try {
            byte[] iv = new byte[IV_LENGTH];
            SECURE_RANDOM.nextBytes(iv);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
            byte[] cipherBytes = cipher.doFinal(rawValue.getBytes(StandardCharsets.UTF_8));
            byte[] authenticatedBytes = new byte[IV_LENGTH + cipherBytes.length];
            System.arraycopy(iv, 0, authenticatedBytes, 0, IV_LENGTH);
            System.arraycopy(cipherBytes, 0, authenticatedBytes, IV_LENGTH, cipherBytes.length);
            byte[] mac = authenticate(key, authenticatedBytes);
            byte[] payload = Arrays.copyOf(authenticatedBytes, authenticatedBytes.length + MAC_LENGTH);
            System.arraycopy(mac, 0, payload, authenticatedBytes.length, MAC_LENGTH);
            return VERSION_PREFIX + Base64.getEncoder().encodeToString(payload);
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("字段加密失败", exception);
        }
    }

    /**
     * 读取 UTF-8 密钥并保持缺失配置时失败的约定，不缓存可能被并发修改的加密状态。
     */
    private static byte[] getKeyBytes() {
        String password = SpringUtil.getProperty(ENCRYPTOR_PROPERTY_NAME);
        Assert.notEmpty(password, "配置项({}) 不能为空", ENCRYPTOR_PROPERTY_NAME);
        return password.getBytes(StandardCharsets.UTF_8);
    }

    /**
     * 派生独立的认证密钥并认证版本、IV 与密文，阻断 CBC 的可塑性和格式降级。
     *
     * @param key AES 配置密钥的 UTF-8 字节，不向外部输出
     * @param payload IV 与 CBC 密文的连续字节
     * @return 32 字节 HMAC-SHA256 认证标签
     * @throws GeneralSecurityException JDK 认证算法不可用或密钥初始化失败时抛出
     */
    private static byte[] authenticate(byte[] key, byte[] payload) throws GeneralSecurityException {
        Mac keyDerivation = Mac.getInstance(MAC_ALGORITHM);
        keyDerivation.init(new SecretKeySpec(key, MAC_ALGORITHM));
        byte[] authenticationKey = keyDerivation.doFinal(
                "mybatis-field-encryption:v1:authentication".getBytes(StandardCharsets.UTF_8));
        Mac mac = Mac.getInstance(MAC_ALGORITHM);
        mac.init(new SecretKeySpec(authenticationKey, MAC_ALGORITHM));
        mac.update(VERSION_PREFIX.getBytes(StandardCharsets.UTF_8));
        return mac.doFinal(payload);
    }

}
