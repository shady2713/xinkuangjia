package com.basicframework.framework.mybatis.config;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.mybatis.core.util.JdbcUtils;
import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.annotation.IdType;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * 当 IdType 为 {@link IdType#NONE} 时，根据 PRIMARY 数据源所使用的数据库，自动设置
 *
 * @author 李杰
 */
@Slf4j
public class IdTypeEnvironmentPostProcessor implements EnvironmentPostProcessor {

    private static final String ID_TYPE_KEY = "mybatis-plus.global-config.db-config.id-type";

    private static final String DATASOURCE_DYNAMIC_KEY = "spring.datasource.dynamic";

    private static final String QUARTZ_JOB_STORE_DRIVER_KEY = "spring.quartz.properties.org.quartz.jobStore.driverDelegateClass";

    private static final Set<DbType> INPUT_ID_TYPES = CollUtil.newHashSet(DbType.ORACLE, DbType.ORACLE_12C,
            DbType.POSTGRE_SQL, DbType.KINGBASE_ES, DbType.DB2, DbType.H2);

    /**
     * 执行后置处理Environment。
     *
     * @param environment environment 参数
     * @param application application 参数
     */
    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        // 如果获取不到 DbType，则不进行处理
        DbType dbType = getDbType(environment);
        if (dbType == null) {
            return;
        }

        // 在环境后置处理阶段补齐 Quartz JobStore 对应的 Driver，当前放这里是为了依赖最少、启动最早。
        setJobStoreDriverIfPresent(environment, dbType);

        // 如果非 NONE，则不进行处理
        IdType idType = getIdType(environment);
        if (idType != IdType.NONE) {
            return;
        }
        // 情况一，用户输入 ID，适合 Oracle、PostgreSQL、Kingbase、DB2、H2 数据库
        if (INPUT_ID_TYPES.contains(dbType)) {
            setIdType(environment, IdType.INPUT);
            return;
        }
        // 情况二，自增 ID，适合 MySQL、DM 达梦等直接自增的数据库
        setIdType(environment, IdType.AUTO);
    }

    /**
     * 获取编号类型。
     *
     * @param environment 运行环境配置
     * @return 查询结果
     */
    public IdType getIdType(ConfigurableEnvironment environment) {
        String value = environment.getProperty(ID_TYPE_KEY);
        try {
            return StrUtil.isNotBlank(value) ? IdType.valueOf(value) : IdType.NONE;
        } catch (IllegalArgumentException ex) {
            log.error("[getIdType][无法解析 id-type 配置值({})]", value, ex);
            return IdType.NONE;
        }
    }

    /**
     * 设置编号类型。
     *
     * @param environment 运行环境配置
     * @param idType 编号类型参数
     */
    public void setIdType(ConfigurableEnvironment environment, IdType idType) {
        Map<String, Object> map = new HashMap<>();
        map.put(ID_TYPE_KEY, idType);
        environment.getPropertySources().addFirst(new MapPropertySource("mybatisPlusIdType", map));
        log.info("[setIdType][修改 MyBatis Plus 的 idType 为({})]", idType);
    }

    /**
     * 根据数据库类型设置 Quartz JobStore 驱动。
     *
     * @param environment 运行环境配置
     * @param dbType db类型参数
     */
    public void setJobStoreDriverIfPresent(ConfigurableEnvironment environment, DbType dbType) {
        String driverClass = environment.getProperty(QUARTZ_JOB_STORE_DRIVER_KEY);
        if (StrUtil.isNotEmpty(driverClass)) {
            return;
        }
        // 根据 dbType 类型，获取对应的 driverClass
        switch (dbType) {
            case POSTGRE_SQL:
                driverClass = "org.quartz.impl.jdbcjobstore.PostgreSQLDelegate";
                break;
            case ORACLE:
            case ORACLE_12C:
                driverClass = "org.quartz.impl.jdbcjobstore.oracle.OracleDelegate";
                break;
            case SQL_SERVER:
            case SQL_SERVER2005:
                driverClass = "org.quartz.impl.jdbcjobstore.MSSQLDelegate";
                break;
            case DM:
            case KINGBASE_ES:
                driverClass = "org.quartz.impl.jdbcjobstore.StdJDBCDelegate";
                break;
            default:
                break;
        }
        // 设置 driverClass 变量
        if (StrUtil.isNotEmpty(driverClass)) {
            environment.getSystemProperties().put(QUARTZ_JOB_STORE_DRIVER_KEY, driverClass);
        }
    }

    /**
     * 获取Db类型。
     *
     * @param environment 运行环境配置
     * @return 查询结果
     */
    public static DbType getDbType(ConfigurableEnvironment environment) {
        String primary = environment.getProperty(DATASOURCE_DYNAMIC_KEY + "." + "primary");
        if (StrUtil.isEmpty(primary)) {
            return null;
        }
        String url = environment.getProperty(DATASOURCE_DYNAMIC_KEY + ".datasource." + primary + ".url");
        if (StrUtil.isEmpty(url)) {
            return null;
        }
        return JdbcUtils.getDbType(url);
    }

}
