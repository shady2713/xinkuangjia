package com.basicframework.module.infra.dal.mysql.config;

import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.core.toolkit.GlobalConfigUtils;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.framework.mybatis.core.interceptor.SoftDeleteUniqueInnerInterceptor;
import com.basicframework.module.infra.controller.admin.config.vo.ConfigPageReqVO;
import com.basicframework.module.infra.dal.dataobject.config.ConfigDO;
import org.apache.ibatis.exceptions.PersistenceException;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.h2.Driver;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.SimpleDriverDataSource;
import org.springframework.jdbc.datasource.init.DatabasePopulatorUtils;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import javax.sql.DataSource;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.Statement;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * 基于 H2 MySQL 兼容模式的参数配置 Mapper 真实 SQL 切片测试示例。
 * 验证字段下划线映射、条件分页查询、审计字段自动填充与逻辑删除过滤。
 *
 * @author shady2713
 */
class ConfigMapperTest {

    /** 共享内存库的 MyBatis 会话工厂。 */
    private static SqlSessionFactory sqlSessionFactory;

    /** 隔离的 H2 内存数据源。 */
    private static DataSource dataSource;

    /**
     * 初始化 H2 MySQL 兼容模式数据源与 MyBatis-Plus 拦截器、逻辑删除及审计填充规则。
     *
     * @throws Exception 初始化会话工厂失败时抛出
     */
    @BeforeAll
    static void setUpSessionFactory() throws Exception {
        String jdbcUrl = "jdbc:h2:mem:config_mapper_" + UUID.randomUUID()
                + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;NON_KEYWORDS=VALUE,KEY,USER;DB_CLOSE_DELAY=-1";
        dataSource = new SimpleDriverDataSource(new Driver(), jdbcUrl, "sa", "");
        ResourceDatabasePopulator populator = new ResourceDatabasePopulator();
        populator.setSqlScriptEncoding(StandardCharsets.UTF_8.name());
        populator.addScript(new ClassPathResource("sql/infra_config_schema.sql"));
        DatabasePopulatorUtils.execute(populator, dataSource);

        MybatisConfiguration configuration = new MybatisConfiguration(
                new Environment("test", new JdbcTransactionFactory(), dataSource));
        configuration.setMapUnderscoreToCamelCase(true);

        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        interceptor.addInnerInterceptor(new SoftDeleteUniqueInnerInterceptor());
        interceptor.addInnerInterceptor(new PaginationInnerInterceptor(DbType.H2));
        configuration.addInterceptor(interceptor);

        GlobalConfig globalConfig = GlobalConfigUtils.defaults();
        globalConfig.setBanner(false);
        globalConfig.setMetaObjectHandler(new DefaultDBFieldHandler());
        GlobalConfig.DbConfig dbConfig = globalConfig.getDbConfig();
        dbConfig.setIdType(IdType.AUTO);
        dbConfig.setLogicDeleteField("deleted");
        dbConfig.setLogicDeleteValue("1");
        dbConfig.setLogicNotDeleteValue("0");
        GlobalConfigUtils.setGlobalConfig(configuration, globalConfig);
        configuration.addMapper(ConfigMapper.class);

        sqlSessionFactory = new MybatisSqlSessionFactoryBuilder().build(configuration);
    }

    /**
     * 每个用例前清空参数表，避免用例间数据串扰。
     *
     * @throws Exception 清空表失败时抛出
     */
    @BeforeEach
    void cleanTable() throws Exception {
        try (Connection connection = dataSource.getConnection();
             Statement statement = connection.createStatement()) {
            statement.execute("TRUNCATE TABLE infra_config");
        }
    }

    /** 验证插入、按键精确查询与逻辑删除后的不可见契约。 */
    @Test
    void insertSelectByKeyAndLogicalDelete() {
        try (SqlSession session = sqlSessionFactory.openSession(true)) {
            ConfigMapper mapper = session.getMapper(ConfigMapper.class);
            ConfigDO entity = buildConfig("ui.theme", "系统主题", "dark", 1);
            mapper.insert(entity);

            assertNotNull(entity.getId());
            assertNotNull(entity.getCreateTime());

            ConfigDO loaded = mapper.selectByKey("ui.theme");
            assertNotNull(loaded);
            assertEquals("dark", loaded.getValue());

            mapper.deleteById(entity.getId());
            assertNull(mapper.selectByKey("ui.theme"));
        }
    }

    /** 验证未删除记录严格保持业务键唯一，而多次逻辑删除后可反复创建同键名配置且互不冲突。 */
    @Test
    void softDeleteReleasesUniqueKeyAcrossRepeatedDeletions() {
        try (SqlSession session = sqlSessionFactory.openSession(true)) {
            ConfigMapper mapper = session.getMapper(ConfigMapper.class);
            ConfigDO first = buildConfig("sys.quota", "配额一", "10", 2);
            mapper.insert(first);

            ConfigDO duplicateActive = buildConfig("sys.quota", "冲突配置", "20", 2);
            assertThrows(PersistenceException.class, () -> mapper.insert(duplicateActive));

            mapper.deleteById(first.getId());
            ConfigDO second = buildConfig("sys.quota", "配额二", "20", 2);
            mapper.insert(second);
            assertEquals("20", mapper.selectByKey("sys.quota").getValue());

            mapper.deleteById(second.getId());
            ConfigDO third = buildConfig("sys.quota", "配额三", "30", 2);
            mapper.insert(third);
            assertEquals("30", mapper.selectByKey("sys.quota").getValue());
        }
    }

    /** 验证多条件模糊匹配与倒序分页 SQL 在真实引擎下可执行且计数准确。 */
    @Test
    void selectPageFiltersAndOrdersByIdDesc() {
        try (SqlSession session = sqlSessionFactory.openSession(true)) {
            ConfigMapper mapper = session.getMapper(ConfigMapper.class);
            mapper.insert(buildConfig("security.lock.max", "登录锁定次数", "5", 1));
            mapper.insert(buildConfig("security.lock.window", "登录锁定窗口", "30m", 1));
            mapper.insert(buildConfig("upload.max.size", "上传文件上限", "50MB", 2));

            ConfigPageReqVO reqVO = new ConfigPageReqVO();
            reqVO.setPageNo(1);
            reqVO.setPageSize(10);
            reqVO.setKey("security.lock");
            reqVO.setType(1);

            PageResult<ConfigDO> page = mapper.selectPage(reqVO);
            assertEquals(2L, page.getTotal());
            assertEquals(2, page.getList().size());
            assertEquals("security.lock.window", page.getList().get(0).getConfigKey());
        }
    }

    /**
     * 构造待持久化的测试参数实体。
     *
     * @param key 参数键名
     * @param name 参数名称
     * @param value 参数值
     * @param type 参数类型
     * @return 未持久化的参数实体
     */
    private static ConfigDO buildConfig(String key, String name, String value, int type) {
        ConfigDO config = new ConfigDO();
        config.setCategory("system");
        config.setConfigKey(key);
        config.setName(name);
        config.setValue(value);
        config.setType(type);
        config.setVisible(Boolean.TRUE);
        config.setRemark("slice-test");
        return config;
    }
}
