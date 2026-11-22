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
 * 当 IdType 为 {@link IdType#NONE} 时，根据标准数据源 URL 自动推导主键策略。
 *
 * @author 李杰
 */
@Slf4j
public class IdTypeEnvironmentPostProcessor implements EnvironmentPostProcessor {

    private static final String ID_TYPE_KEY = "mybatis-plus.global-config.db-config.id-type";

    private static final String DATASOURCE_URL_KEY = "spring.datasource.url";

    private static final Set<DbType> INPUT_ID_TYPES = CollUtil.newHashSet(DbType.ORACLE, DbType.ORACLE_12C,
            DbType.POSTGRE_SQL, DbType.KINGBASE_ES, DbType.DB2, DbType.H2);

    /**
     * 在环境后置处理阶段根据数据源类型补齐 MyBatis-Plus 主键策略。
     *
     * @param environment 运行环境配置
     * @param application Spring 应用实例
     */
    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        DbType dbType = getDbType(environment);
        if (dbType == null) {
            return;
        }
        IdType idType = getIdType(environment);
        if (idType != IdType.NONE) {
            return;
        }
        if (INPUT_ID_TYPES.contains(dbType)) {
            setIdType(environment, IdType.INPUT);
            return;
        }
        setIdType(environment, IdType.AUTO);
    }

    /**
     * 获取当前配置的主键类型。
     *
     * @param environment 运行环境配置
     * @return 主键类型，非法或为空时返回 {@link IdType#NONE}
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
     * 写入推导后的 MyBatis-Plus 主键策略。
     *
     * @param environment 运行环境配置
     * @param idType 主键策略
     */
    public void setIdType(ConfigurableEnvironment environment, IdType idType) {
        Map<String, Object> map = new HashMap<>();
        map.put(ID_TYPE_KEY, idType);
        environment.getPropertySources().addFirst(new MapPropertySource("mybatisPlusIdType", map));
        log.info("[setIdType][修改 MyBatis Plus 的 idType 为({})]", idType);
    }

    /**
     * 根据 {@code spring.datasource.url} 推导数据库类型。
     *
     * @param environment 运行环境配置
     * @return 数据库类型；未配置 URL 时返回 null
     */
    public static DbType getDbType(ConfigurableEnvironment environment) {
        String url = environment.getProperty(DATASOURCE_URL_KEY);
        if (StrUtil.isEmpty(url)) {
            return null;
        }
        return JdbcUtils.getDbType(url);
    }

}
