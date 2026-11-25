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
 * 针对 MyBatis Plus 的 {@link DbType} 增强，维护 JDBC 产品名到方言枚举的映射。
 *
 * @author shady
 */
@Getter
@AllArgsConstructor
public enum DbTypeEnum {

    /** H2 内存数据库。 */
    H2(DbType.H2, "H2"),

    /** MySQL 数据库。 */
    MY_SQL(DbType.MYSQL, "MySQL"),

    /** Oracle 数据库。 */
    ORACLE(DbType.ORACLE, "Oracle"),

    /** PostgreSQL（含使用相同产品名的兼容数据库）。 */
    POSTGRE_SQL(DbType.POSTGRE_SQL, "PostgreSQL"),

    /** Microsoft SQL Server。 */
    SQL_SERVER(DbType.SQL_SERVER, "Microsoft SQL Server"),

    /** Microsoft SQL Server 2005。 */
    SQL_SERVER2005(DbType.SQL_SERVER2005, "Microsoft SQL Server 2005"),

    /** 达梦数据库。 */
    DM(DbType.DM, "DM DBMS"),

    /** 人大金仓数据库。 */
    KINGBASE_ES(DbType.KINGBASE_ES, "KingbaseES"),

    /** OceanBase 数据库。 */
    OCEAN_BASE(DbType.OCEAN_BASE, "OceanBase");

    private static final Map<String, DbTypeEnum> BY_PRODUCT_NAME = Map.copyOf(Arrays.stream(values())
            .collect(Collectors.toMap(DbTypeEnum::getProductName, Function.identity())));

    /** MyBatis Plus 数据库方言类型。 */
    private final DbType mpDbType;

    /** JDBC 元数据返回的数据库产品名称。 */
    private final String productName;

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

}
