package com.basicframework.module.infra.service.file;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.module.infra.dal.dataobject.file.FileUploadDO;
import com.basicframework.module.infra.dal.mysql.file.FileMapper;
import com.basicframework.module.infra.dal.mysql.file.FileUploadMapper;
import com.basicframework.module.infra.framework.file.config.FileUploadProperties;
import com.basicframework.module.infra.framework.file.config.MinioFileProperties;
import com.basicframework.module.infra.framework.file.core.client.FileClientFactoryImpl;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.mybatis.spring.mapper.MapperFactoryBean;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.S3Exception;

import javax.sql.DataSource;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 用独立 MySQL 库、MinIO 桶和生产 Mapper 验证上传补偿扫描的边界、失败隔离与对象处置。
 *
 * <p>补偿扫描是上传协议里唯一的兜底：预约过期后如果没人来清理，暂存对象会一直占用桶空间，
 * 被取消的预约对应的对象也会成为孤儿。这里锁定三条真实风险：扫描批次必须有界（否则一次拉满全表）、
 * 单条失败不能拖垮整批（否则一个坏记录会长期堵住后面的清理）、以及已完成记录的最终对象绝不能被清掉。</p>
 *
 * <p>显式执行此集成入口必须提供环回测试环境，缺失环境直接失败，不连接业务库或已有存储桶。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class FileUploadReconcilerMySqlS3IT {

    /** 补偿扫描单批上限，与生产 Mapper 的有界查询保持一致。 */
    private static final int SCAN_BATCH_LIMIT = 50;
    /** 超过单批上限的预约数量，用于验证扫描确实有界。 */
    private static final int OVERSIZED_BACKLOG = SCAN_BATCH_LIMIT + 10;
    /** 每条用例使用独立身份，避免共享日预算影响预约数量。 */
    private static final int DAILY_REQUESTS = 500;
    /** 每条用例的日字节预算，覆盖全部预约大小。 */
    private static final long DAILY_BYTES = 50L * 1024 * 1024;

    private final String schema = "bf_reconcile_" + UUID.randomUUID().toString().replace("-", "");
    private final String bucket = "bf-reconcile-" + UUID.randomUUID().toString().replace("-", "");
    private AnnotationConfigApplicationContext context;
    private JdbcTemplate jdbc;
    private FileUploadReconciler reconciler;
    private FileUploadLifecycle lifecycle;
    private FileStorageService storage;
    private FileUploadProperties limits;
    private S3Client admin;
    private String adminUrl;
    private String databaseUser;
    private String databasePassword;
    private boolean schemaCreated;
    private boolean bucketCreated;
    private String owner;

    /** 建立随机数据库和随机桶，并只导入上传协议用到的生产表。 */
    @BeforeAll
    void startEnvironment() throws Exception {
        adminUrl = requiredEnvironment("AUTH_TEST_MYSQL_URL");
        if (!adminUrl.matches("jdbc:mysql://(?:127\\.0\\.0\\.1|localhost):[0-9]+/(?:\\?.*)?")) {
            throw new IllegalArgumentException("补偿测试必须使用不带库名的环回 MySQL 地址");
        }
        databaseUser = requiredEnvironment("AUTH_TEST_MYSQL_USERNAME");
        databasePassword = requiredEnvironment("AUTH_TEST_MYSQL_PASSWORD");
        URI endpoint = URI.create(requiredEnvironment("BF_TEST_S3_ENDPOINT"));
        if (!List.of("localhost", "127.0.0.1").contains(endpoint.getHost()) || endpoint.getPort() < 1) {
            throw new IllegalArgumentException("补偿测试仅支持隔离环回 MinIO 服务");
        }
        try (Connection connection = DriverManager.getConnection(adminUrl, databaseUser, databasePassword);
             Statement statement = connection.createStatement()) {
            statement.execute("CREATE DATABASE `" + schema + "` CHARACTER SET utf8mb4");
            schemaCreated = true;
        }
        String[] parts = adminUrl.split("\\?", 2);
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                parts[0] + schema + (parts.length == 2 ? "?" + parts[1] : ""), databaseUser, databasePassword);
        jdbc = new JdbcTemplate(dataSource);
        String baseline = Files.readString(repositoryRoot().resolve("数据库文件/basic_framework.sql"));
        String migration = Files.readString(repositoryRoot().resolve(
                "docs/部署/mysql-migrations/V202610020001__infra_file_upload_lifecycle.sql"));
        jdbc.execute(tableDefinition(baseline, "infra_file"));
        for (String table : List.of("infra_file_upload", "infra_file_upload_quota")) {
            assertThat(tableDefinition(migration, table)).isEqualTo(tableDefinition(baseline, table));
            jdbc.execute(tableDefinition(migration, table));
        }
        MinioFileProperties properties = new MinioFileProperties();
        properties.setEndpoint(endpoint.toString());
        properties.setPublicUrl(endpoint.toString());
        properties.setBucket(bucket);
        properties.setRegion("us-east-1");
        properties.setAccessKey(requiredEnvironment("BF_TEST_S3_ACCESS_KEY"));
        properties.setSecretKey(requiredEnvironment("BF_TEST_S3_SECRET_KEY"));
        admin = S3Client.builder().endpointOverride(endpoint).region(Region.US_EAST_1)
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(
                        properties.getAccessKey(), properties.getSecretKey())))
                .forcePathStyle(true).overrideConfiguration(builder -> builder.apiCallTimeout(Duration.ofSeconds(20)))
                .build();
        admin.createBucket(builder -> builder.bucket(bucket));
        bucketCreated = true;
        limits = new FileUploadProperties();
        storage = new FileStorageServiceImpl(new FileClientFactoryImpl(), properties);

        context = new AnnotationConfigApplicationContext();
        context.register(TransactionConfiguration.class);
        // 组件用 @Resource 按名注入，并依赖 @PostConstruct 建立唯一存储客户端；
        // 因此按生产字段名注册 Bean，保留真实装配行为而不是手工塞值
        context.registerBean(DataSource.class, () -> dataSource);
        context.registerBean(DataSourceTransactionManager.class,
                () -> new DataSourceTransactionManager(dataSource));
        context.registerBean(SqlSessionFactory.class, () -> sqlSessionFactory(dataSource));
        registerMapper("uploads", FileUploadMapper.class);
        registerMapper("files", FileMapper.class);
        context.registerBean("limits", FileUploadProperties.class, () -> limits);
        context.registerBean("storage", FileStorageService.class, () -> storage);
        context.registerBean("lifecycle", FileUploadLifecycle.class);
        context.refresh();
        lifecycle = context.getBean(FileUploadLifecycle.class);
        // 补偿器不是事务边界组件，直接按生产字段装配以保留真实的逐条调用行为
        reconciler = new FileUploadReconciler();
        ReflectionTestUtils.setField(reconciler, "uploads", context.getBean("uploads", FileUploadMapper.class));
        ReflectionTestUtils.setField(reconciler, "lifecycle", lifecycle);
    }

    /** 每例清空预约、预算和桶内容，让批次边界和对象断言都是精确值而不是累计值。 */
    @BeforeEach
    void resetFixtures() throws Exception {
        limits.setMaxBytes(10 * 1024 * 1024);
        limits.setDailyRequests(DAILY_REQUESTS);
        limits.setDailyBytes(DAILY_BYTES);
        owner = "reconcile:" + UUID.randomUUID();
        jdbc.update("DELETE FROM infra_file_upload");
        jdbc.update("DELETE FROM infra_file_upload_quota");
        for (var page : admin.listObjectsV2Paginator(builder -> builder.bucket(bucket))) {
            for (var object : page.contents()) {
                admin.deleteObject(builder -> builder.bucket(bucket).key(object.key()));
            }
        }
    }

    /**
     * 单次扫描最多处理有界批次，剩余记录留到下一轮。
     *
     * <p>一次拉取全部到期记录会让补偿事务长时间持有行锁；分批才能让单轮耗时可控。</p>
     */
    @Test
    void reconcileProcessesOnlyOneBoundedBatch() {
        for (int index = 0; index < OVERSIZED_BACKLOG; index++) {
            expire(reserveDirect(bytes("staged")));
        }
        assertThat(countByStatus("PENDING")).isEqualTo(OVERSIZED_BACKLOG);

        reconciler.reconcile();

        assertThat(countByStatus("CANCELLED")).isEqualTo(SCAN_BATCH_LIMIT);
        assertThat(countByStatus("PENDING")).isEqualTo(OVERSIZED_BACKLOG - SCAN_BATCH_LIMIT);

        reconciler.reconcile();

        assertThat(countByStatus("CANCELLED")).as("下一轮必须继续消化剩余记录")
                .isEqualTo(OVERSIZED_BACKLOG);
    }

    /** 取消记录必须同时删除最终对象和暂存对象，不能留下孤儿对象占用桶空间。 */
    @Test
    void cancelledReservationRemovesBothObjects() throws Exception {
        FileUploadDO upload = reserveDirect(bytes("staged"));
        storage.upload(bytes("staged"), upload.getStagingPath(), "text/plain");
        expire(upload);

        reconciler.reconcile();

        assertThat(statusOf(upload)).isEqualTo("CANCELLED");
        assertAbsent(upload.getPath());
        assertAbsent(upload.getStagingPath());
    }

    /**
     * 已完成记录只清暂存对象，最终对象必须保留。
     *
     * <p>终态记录会继续被定期核对，用于清除超时写请求迟到的对象；
     * 一旦把它当成取消记录处理，已交付给业务的文件就会直接消失。</p>
     */
    @Test
    void completedReservationKeepsFinalObjectAndClearsStaging() throws Exception {
        byte[] body = bytes("delivered");
        FileUploadDO upload = reserveDirect(body);
        storage.upload(body, upload.getStagingPath(), "text/plain");
        lifecycle.complete(upload.getPath(), owner, null);
        makeCleanupDue(upload);

        reconciler.reconcile();

        assertThat(statusOf(upload)).isEqualTo("COMPLETE");
        assertThat(storage.getContent(upload.getPath())).isEqualTo(body);
        assertAbsent(upload.getStagingPath());
    }

    /**
     * 单条记录失败不得阻断同一批次的其他记录。
     *
     * <p>补偿记录里既有存储故障也有数据库故障；若一条坏记录能让整轮抛错，
     * 它会长期占据扫描批次最前面的位置，后续所有记录都得不到清理。</p>
     */
    @Test
    void singleFailingRecordDoesNotStopTheRestOfTheBatch() {
        List<FileUploadDO> uploads = List.of(reserveDirect(bytes("staged")), reserveDirect(bytes("staged")), reserveDirect(bytes("staged")));
        FileUploadDO broken = uploads.get(1);
        for (FileUploadDO upload : uploads) {
            expire(upload);
        }
        // 让第二条记录的取消写入在数据库层失败，其余记录保持可处理
        jdbc.execute("CREATE TRIGGER reject_one BEFORE UPDATE ON infra_file_upload FOR EACH ROW "
                + "BEGIN IF OLD.id = '" + broken.getId() + "' THEN "
                + "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'controlled reconcile failure'; END IF; END");
        try {
            reconciler.reconcile();
        } finally {
            jdbc.execute("DROP TRIGGER reject_one");
        }

        assertThat(statusOf(uploads.get(0))).isEqualTo("CANCELLED");
        assertThat(statusOf(broken)).as("失败记录必须保持原状以等待重试").isEqualTo("PENDING");
        assertThat(statusOf(uploads.get(2))).isEqualTo("CANCELLED");
    }

    /** 尚未到期的记录不得被处理；否则正常直传窗口内的对象会被提前清掉。 */
    @Test
    void notYetDueReservationIsLeftUntouched() throws Exception {
        FileUploadDO upload = reserveDirect(bytes("staged"));
        storage.upload(bytes("in-flight"), upload.getStagingPath(), "text/plain");

        reconciler.reconcile();

        assertThat(statusOf(upload)).isEqualTo("PENDING");
        assertThat(storage.getContent(upload.getStagingPath())).isEqualTo(bytes("in-flight"));
    }

    /** 清理成功后把下次核对时间推后一天，终态记录因此保持长期有效。 */
    @Test
    void processedRecordIsRescheduledForLaterRecheck() {
        FileUploadDO upload = reserveDirect(bytes("staged"));
        expire(upload);
        long dueAt = nextCleanupAt(upload);

        reconciler.reconcile();

        assertThat(nextCleanupAt(upload)).as("已处理的记录不得立刻再次到期")
                .isGreaterThanOrEqualTo(dueAt);
    }

    /** 关闭客户端后仅移除本类已创建的随机桶和数据库，异常也继续回收其他独立资源。 */
    @AfterAll
    void closeEnvironment() throws Exception {
        try {
            if (context != null) context.close();
            if (admin != null && bucketCreated) {
                for (var page : admin.listObjectsV2Paginator(builder -> builder.bucket(bucket))) {
                    for (var object : page.contents()) {
                        admin.deleteObject(builder -> builder.bucket(bucket).key(object.key()));
                    }
                }
                admin.deleteBucket(builder -> builder.bucket(bucket));
            }
        } finally {
            if (admin != null) admin.close();
            if (schemaCreated) {
                try (Connection connection = DriverManager.getConnection(adminUrl, databaseUser, databasePassword);
                     Statement statement = connection.createStatement()) {
                    statement.execute("DROP DATABASE `" + schema + "`");
                }
            }
        }
    }

    /**
     * 建立一条带暂存键的直传预约。
     *
     * @param content 稍后写入暂存对象的字节；预约大小必须与之完全一致，否则完成阶段会因超限失败
     * @return 已提交的预约
     */
    private FileUploadDO reserveDirect(byte[] content) {
        return lifecycle.reserve(owner, "tests/" + UUID.randomUUID() + "/note.txt", "note.txt", content.length, true);
    }

    /** 通过数据库把预约置为已到期且到期清理，不依赖睡眠或修改机器时钟。 */
    private void expire(FileUploadDO upload) {
        jdbc.update("UPDATE infra_file_upload SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE), "
                + "next_cleanup_at = UTC_TIMESTAMP() WHERE id = ?", upload.getId());
    }

    /** 只把清理时间提前到当前，不改变预约有效期。 */
    private void makeCleanupDue(FileUploadDO upload) {
        jdbc.update("UPDATE infra_file_upload SET next_cleanup_at = UTC_TIMESTAMP() WHERE id = ?", upload.getId());
    }

    /** 读取预约的持久化状态，避免只断言方法返回值。 */
    private String statusOf(FileUploadDO upload) {
        return jdbc.queryForObject("SELECT status FROM infra_file_upload WHERE id = ?", String.class,
                upload.getId());
    }

    /** 读取下次清理时间，用于验证清理后被推后而不是立即再次到期。 */
    private long nextCleanupAt(FileUploadDO upload) {
        Long seconds = jdbc.queryForObject(
                "SELECT UNIX_TIMESTAMP(next_cleanup_at) FROM infra_file_upload WHERE id = ?", Long.class,
                upload.getId());
        return seconds == null ? 0L : seconds;
    }

    /** 按状态统计预约条数，用于验证扫描批次边界。 */
    private int countByStatus(String status) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM infra_file_upload WHERE status = ?", Integer.class, status);
    }

    /** 真实 S3 HEAD 必须返回不存在，其他错误不能冒充已清理。 */
    private void assertAbsent(String path) {
        assertThatThrownBy(() -> admin.headObject(builder -> builder.bucket(bucket).key(path)))
                .isInstanceOfSatisfying(S3Exception.class, failure -> assertThat(failure.statusCode()).isEqualTo(404));
    }

    /** 返回明确 UTF-8 字节以保持大小与测试文本一致。 */
    private byte[] bytes(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }

    /** 缺失隔离环境时直接失败，避免退化成跳过真实数据库和存储证据。 */
    private String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException("缺少隔离测试环境变量 " + name);
        return value;
    }

    /** 定位版本控制中的生产 DDL，不依赖测试进程从哪个模块启动。 */
    private Path repositoryRoot() {
        Path directory = Path.of("").toAbsolutePath();
        while (directory != null && !Files.isRegularFile(directory.resolve("数据库文件/basic_framework.sql"))) {
            directory = directory.getParent();
        }
        if (directory == null) throw new IllegalStateException("未找到框架空库基线");
        return directory;
    }

    /** 从实际基线或迁移提取指定完整建表语句；缺失时直接失败。 */
    private String tableDefinition(String source, String table) {
        var matcher = Pattern.compile("CREATE TABLE `" + table + "`[\\s\\S]*?;").matcher(source);
        assertThat(matcher.find()).as("结构必须定义 %s", table).isTrue();
        return matcher.group();
    }

    /** 使用真实 MyBatis 配置与审计填充器，防止内存替身掩盖映射或事务错误。 */
    private SqlSessionFactory sqlSessionFactory(DataSource dataSource) {
        try {
            MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
            factory.setDataSource(dataSource);
            MybatisConfiguration configuration = new MybatisConfiguration();
            configuration.setMapUnderscoreToCamelCase(true);
            factory.setConfiguration(configuration);
            GlobalConfig config = new GlobalConfig();
            config.setDbConfig(new GlobalConfig.DbConfig().setIdType(IdType.AUTO));
            config.setMetaObjectHandler(new DefaultDBFieldHandler());
            factory.setGlobalConfig(config);
            return factory.getObject();
        } catch (Exception failure) {
            throw new IllegalStateException("补偿测试 Mapper 初始化失败", failure);
        }
    }

    /** 按生产字段名注册真实 Mapper 动态代理，使 @Resource 按名注入与生产一致。 */
    private <T> void registerMapper(String beanName, Class<T> type) {
        context.registerBean(beanName, type, () -> {
            try {
                MapperFactoryBean<T> factory = new MapperFactoryBean<>(type);
                factory.setSqlSessionFactory(context.getBean(SqlSessionFactory.class));
                factory.afterPropertiesSet();
                return factory.getObject();
            } catch (Exception failure) {
                throw new IllegalStateException("补偿测试 Mapper 创建失败", failure);
            }
        });
    }

    /** 启用真实事务代理，使逐条清理使用独立事务。 */
    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement(proxyTargetClass = true)
    static class TransactionConfiguration {
    }
}
