package com.basicframework.framework.mybatis.core.type;

import cn.hutool.core.lang.Assert;
import cn.hutool.crypto.SecureUtil;
import cn.hutool.crypto.symmetric.AES;
import cn.hutool.extra.spring.SpringUtil;
import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;

import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

/**
 * 字段字段的 TypeHandler 实现类，基于 {@link AES} 实现
 * 可通过 jasypt.encryptor.password 配置项，设置密钥
 *
 * @author 李杰
 */
public class EncryptTypeHandler extends BaseTypeHandler<String> {

    private static final String ENCRYPTOR_PROPERTY_NAME = "mybatis-plus.encryptor.password";

    private static AES aes;

    /**
     * 设置NonNull参数。
     *
     * @param ps ps 参数
     * @param i i 参数
     * @param parameter parameter 参数
     * @param jdbcType jdbcType 参数
     * @throws SQLException 底层处理失败时抛出
     */
    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, String parameter, JdbcType jdbcType) throws SQLException {
        ps.setString(i, encrypt(parameter));
    }

    /**
     * 从数据库查询结果中读取并转换可空字段值。
     *
     * @param rs rs 数据集合
     * @param columnName 数据库列名
     * @return 查询或转换后的结果
     * @throws SQLException 底层处理失败时抛出
     */
    @Override
    public String getNullableResult(ResultSet rs, String columnName) throws SQLException {
        String value = rs.getString(columnName);
        return decrypt(value);
    }

    /**
     * 从数据库查询结果中读取并转换可空字段值。
     *
     * @param rs rs 数据集合
     * @param columnIndex 数据库列序号
     * @return 查询或转换后的结果
     * @throws SQLException 底层处理失败时抛出
     */
    @Override
    public String getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        String value = rs.getString(columnIndex);
        return decrypt(value);
    }

    /**
     * 从数据库查询结果中读取并转换可空字段值。
     *
     * @param cs cs 参数
     * @param columnIndex 数据库列序号
     * @return 查询或转换后的结果
     * @throws SQLException 底层处理失败时抛出
     */
    @Override
    public String getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        String value = cs.getString(columnIndex);
        return decrypt(value);
    }

    /**
     * 解密目标数据。
     */
    private static String decrypt(String value) {
        if (value == null) {
            return null;
        }
        return getEncryptor().decryptStr(value);
    }

    /**
     * 完成 encrypt 对应的业务处理。
     *
     * @param rawValue raw值参数
     * @return 方法处理结果
     */
    public static String encrypt(String rawValue) {
        if (rawValue == null) {
            return null;
        }
        return getEncryptor().encryptBase64(rawValue);
    }

    /**
     * 获取Encryptor。
     */
    private static AES getEncryptor() {
        if (aes != null) {
            return aes;
        }
        // 构建 AES
        String password = SpringUtil.getProperty(ENCRYPTOR_PROPERTY_NAME);
        Assert.notEmpty(password, "配置项({}) 不能为空", ENCRYPTOR_PROPERTY_NAME);
        aes = SecureUtil.aes(password.getBytes());
        return aes;
    }

}
