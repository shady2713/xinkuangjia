package com.basicframework.framework.mybatis.core.util;

import cn.hutool.core.util.ObjectUtil;
import com.basicframework.framework.common.util.spring.SpringUtils;
import com.basicframework.framework.mybatis.core.enums.DbTypeEnum;
import com.baomidou.mybatisplus.annotation.DbType;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;

/**
 * JDBC 工具类。
 *
 * @author 李杰
 */
public class JdbcUtils {

    /**
     * 判断数据库连接参数是否可正常建立连接。
     *
     * @param url 数据源连接地址
     * @param username 账号
     * @param password 密码
     * @return 连接成功返回 true
     */
    public static boolean isConnectionOK(String url, String username, String password) {
        try (Connection ignored = DriverManager.getConnection(url, username, password)) {
            return true;
        } catch (Exception ex) {
            return false;
        }
    }

    /**
     * 获得 JDBC URL 对应的数据库类型。
     *
     * @param url JDBC 连接地址
     * @return 数据库类型
     */
    public static DbType getDbType(String url) {
        return com.baomidou.mybatisplus.extension.toolkit.JdbcUtils.getDbType(url);
    }

    /**
     * 通过当前应用数据源元数据获得数据库类型。
     *
     * @return 数据库类型
     * @throws IllegalStateException 获取连接或读取元数据失败时抛出
     */
    public static DbType getDbType() {
        DataSource dataSource = SpringUtils.getBean(DataSource.class);
        try (Connection conn = dataSource.getConnection()) {
            return DbTypeEnum.find(conn.getMetaData().getDatabaseProductName());
        } catch (SQLException e) {
            throw new IllegalStateException("读取当前数据库类型失败", e);
        }
    }

    /**
     * 判断 JDBC 连接是否为 SQLServer 数据库。
     *
     * @param url JDBC 连接地址
     * @return 是否为 SQLServer
     */
    public static boolean isSQLServer(String url) {
        return isSQLServer(getDbType(url));
    }

    /**
     * 判断数据库类型是否为 SQLServer。
     *
     * @param dbType 数据库类型
     * @return 是否为 SQLServer
     */
    public static boolean isSQLServer(DbType dbType) {
        return ObjectUtil.equal(dbType, DbType.SQL_SERVER) || ObjectUtil.equal(dbType, DbType.SQL_SERVER2005);
    }

}
