package com.basicframework.framework.mybatis.core.enums;

import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.annotation.DbType;
import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.Arrays;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 针对 MyBatis Plus 的 {@link DbType} 增强，补充更多信息
 *
 * @author 李杰
 */
@Getter
@AllArgsConstructor
public enum DbTypeEnum {

    /**
     * H2
     *
     * 注意：H2 不支持 find_in_set 函数
     */
    H2(DbType.H2, "H2", ""),

    /**
     * MySQL
     */
    MY_SQL(DbType.MYSQL, "MySQL", "FIND_IN_SET('#{value}', #{column}) <> 0"),

    /**
     * Oracle
     */
    ORACLE(DbType.ORACLE, "Oracle", "FIND_IN_SET('#{value}', #{column}) <> 0"),

    /**
     * PostgreSQL
     *
     * 华为 openGauss 使用 ProductName 与 PostgreSQL 相同
     */
    POSTGRE_SQL(DbType.POSTGRE_SQL,"PostgreSQL", "POSITION('#{value}' IN #{column}) <> 0"),

    /**
     * SQL Server
     */
    SQL_SERVER(DbType.SQL_SERVER, "Microsoft SQL Server", "CHARINDEX(',' + #{value} + ',', ',' + #{column} + ',') <> 0"),
    /**
     * SQL Server 2005
     */
    SQL_SERVER2005(DbType.SQL_SERVER2005, "Microsoft SQL Server 2005", "CHARINDEX(',' + #{value} + ',', ',' + #{column} + ',') <> 0"),

    /**
     * 达梦
     */
    DM(DbType.DM, "DM DBMS", "FIND_IN_SET('#{value}', #{column}) <> 0"),

    /**
     * 人大金仓
     */
    KINGBASE_ES(DbType.KINGBASE_ES, "KingbaseES", "POSITION('#{value}' IN #{column}) <> 0"),

    /**
     * OceanBase
     */
    OCEAN_BASE(DbType.OCEAN_BASE, "OceanBase", "FIND_IN_SET('#{value}', #{column}) <> 0")

    ;

    private static final Map<String, DbTypeEnum> BY_PRODUCT_NAME = Map.copyOf(Arrays.stream(values())
            .collect(Collectors.toMap(DbTypeEnum::getProductName, Function.identity())));

    private static final Map<DbType, DbTypeEnum> BY_MP_TYPE = Map.copyOf(Arrays.stream(values())
            .collect(Collectors.toMap(DbTypeEnum::getMpDbType, Function.identity())));

    /**
     * MyBatis Plus 类型
     */
    private final DbType mpDbType;
    /**
     * 数据库产品名
     */
    private final String productName;
    /**
     * SQL FIND_IN_SET 模板
     */
    private final String findInSetTemplate;

    /**
     * 根据 JDBC 数据库产品名查找 MyBatis Plus 数据库类型。
     *
     * @param databaseProductName JDBC 数据库产品名
     * @return 数据库类型；产品名为空或未知时返回 null
     */
    public static DbType find(String databaseProductName) {
        if (StrUtil.isBlank(databaseProductName)) {
            return null;
        }
        DbTypeEnum dbType = BY_PRODUCT_NAME.get(databaseProductName);
        return dbType != null ? dbType.getMpDbType() : null;
    }

    /**
     * 获取指定数据库的 FIND_IN_SET 兼容 SQL 模板。
     *
     * @param dbType MyBatis Plus 数据库类型
     * @return FIND_IN_SET 兼容 SQL 模板
     * @throws IllegalArgumentException 数据库类型未知或不支持 FIND_IN_SET 时抛出
     */
    public static String getFindInSetTemplate(DbType dbType) {
        if (dbType == null) {
            throw new IllegalArgumentException("数据库类型不支持 FIND_IN_SET: null");
        }
        DbTypeEnum dbTypeEnum = BY_MP_TYPE.get(dbType);
        if (dbTypeEnum == null || StrUtil.isBlank(dbTypeEnum.getFindInSetTemplate())) {
            throw new IllegalArgumentException("数据库类型不支持 FIND_IN_SET: " + dbType);
        }
        return dbTypeEnum.getFindInSetTemplate();
    }
}
