package com.basicframework.module.infra.service.file;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.module.infra.controller.admin.file.vo.file.FileCreateReqVO;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import com.basicframework.module.infra.dal.dataobject.file.FileDO;
import com.basicframework.module.infra.dal.dataobject.file.FileUploadDO;
import com.basicframework.module.infra.dal.mysql.file.FileMapper;
import com.basicframework.module.infra.dal.mysql.file.FileUploadMapper;
import com.basicframework.module.infra.framework.file.config.FileUploadProperties;
import com.basicframework.module.infra.framework.file.config.MinioFileProperties;
import com.basicframework.module.infra.framework.file.core.client.FileClientFactoryImpl;
import com.basicframework.module.infra.framework.file.core.utils.FilePathUtils;
import com.basicframework.module.infra.framework.file.core.utils.FileTypeUtils;
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
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.TransactionSystemException;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.DefaultTransactionStatus;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.S3Exception;

import javax.sql.DataSource;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

import static com.basicframework.module.infra.enums.ErrorCodeConstants.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.spy;

/**
 * 用独立 MySQL 库、MinIO 桶、生产 Mapper 与 Spring 事务验证上传协议的故障和并发边界。
 * 显式执行此集成入口必须提供环回测试环境，缺失环境直接失败，不连接业务库或已有存储桶。
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class FileUploadMySqlS3IT {

    private final String schema = "bf_file_" + UUID.randomUUID().toString().replace("-", "");
    private final String bucket = "bf-file-" + UUID.randomUUID().toString().replace("-", "");
    private AnnotationConfigApplicationContext context;
    private JdbcTemplate jdbc;
    private FileUploadLifecycle lifecycle;
    private FileStorageServiceImpl storage;
    private FileUploadProperties limits;
    private S3Client admin;
    private CommitFailureManager transactions;
    private String adminUrl;
    private String databaseUser;
    private String databasePassword;
    private boolean schemaCreated;
    private boolean bucketCreated;
    private String owner;

    /** 创建独立数据库和桶；实际执行增量迁移，并与空库基线逐表定义对比。 */
    @BeforeAll
    void createEnvironment() throws Exception {
        adminUrl = environment("AUTH_TEST_MYSQL_URL");
        if (!adminUrl.matches("jdbc:mysql://(?:127\\.0\\.0\\.1|localhost):[0-9]+/(?:\\?.*)?")) {
            throw new IllegalArgumentException("文件测试必须使用不带库名的环回 MySQL 地址");
        }
        databaseUser = environment("AUTH_TEST_MYSQL_USERNAME");
        databasePassword = environment("AUTH_TEST_MYSQL_PASSWORD");
        URI endpoint = URI.create(environment("BF_TEST_S3_ENDPOINT"));
        if (!List.of("localhost", "127.0.0.1").contains(endpoint.getHost()) || endpoint.getPort() < 1) {
            throw new IllegalArgumentException("文件测试仅支持隔离环回 MinIO 服务");
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
        Path root = repositoryRoot();
        String baseline = Files.readString(root.resolve("数据库文件/basic_framework.sql"));
        String migration = Files.readString(root.resolve(
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
        properties.setAccessKey(environment("BF_TEST_S3_ACCESS_KEY"));
        properties.setSecretKey(environment("BF_TEST_S3_SECRET_KEY"));
        admin = S3Client.builder().endpointOverride(endpoint).region(Region.US_EAST_1)
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(
                        properties.getAccessKey(), properties.getSecretKey())))
                .forcePathStyle(true).overrideConfiguration(builder -> builder.apiCallTimeout(Duration.ofSeconds(20)))
                .build();
        admin.createBucket(builder -> builder.bucket(bucket));
        bucketCreated = true;
        limits = new FileUploadProperties();
        storage = spy(new FileStorageServiceImpl(new FileClientFactoryImpl(), properties));
        transactions = new CommitFailureManager(dataSource);
        context = new AnnotationConfigApplicationContext();
        context.register(TransactionConfiguration.class);
        context.registerBean(DataSource.class, () -> dataSource);
        context.registerBean(DataSourceTransactionManager.class, () -> transactions);
        context.registerBean(SqlSessionFactory.class, () -> sqlSessionFactory(dataSource));
        registerMapper(FileMapper.class);
        registerMapper(FileUploadMapper.class);
        context.registerBean(FileUploadProperties.class, () -> limits);
        context.registerBean(FileStorageService.class, () -> storage);
        context.registerBean(FileUploadLifecycle.class);
        context.registerBean(FileService.class, FileServiceImpl::new);
        context.refresh();
        lifecycle = context.getBean(FileUploadLifecycle.class);
    }

    /** 每例使用独立身份预算，保留真实存储客户端并清除上例故障注入。 */
    @BeforeEach
    void resetFailureBoundaries() {
        SecurityContextHolder.clearContext();
        reset(storage);
        transactions.failAfterCommit.set(false);
        limits.setDailyRequests(100);
        limits.setDailyBytes(200L * 1024 * 1024);
        limits.setMaxBytes(10 * 1024 * 1024);
        owner = "test:" + UUID.randomUUID();
    }

    /** 实际文件服务从登录上下文绑定预约；忽略客户端伪造的元数据，换身份则拒绝。 */
    @Test
    void serviceResolvesOwnershipAndVerifiedMetadataFromServer() throws Exception {
        FileService service = context.getBean(FileService.class);
        byte[] body = bytes("actual bytes");
        assertThatThrownBy(() -> service.presignPutUrl("note.txt", null, body.length))
                .isInstanceOf(ServiceException.class);
        try {
            login(1001L);
            var reservation = service.presignPutUrl("note.txt", "notes", body.length);
            assertThat(put(reservation.getUploadUrl(), body, true)).isEqualTo(200);
            FileCreateReqVO claimed = new FileCreateReqVO();
            claimed.setPath(reservation.getPath());
            claimed.setName("forged.exe");
            claimed.setSize(1L);
            claimed.setType("application/executable");
            claimed.setUrl("https://unrelated.example.test/forged");
            login(1002L);
            assertThatThrownBy(() -> service.createFile(claimed)).isInstanceOf(ServiceException.class);
            login(1001L);
            Long id = service.createFile(claimed);
            FileDO file = service.getFile(id);
            assertThat(file.getName()).isEqualTo("note.txt");
            assertThat(file.getSize()).isEqualTo((long) body.length);
            assertThat(file.getType()).isEqualTo("text/plain");
            assertThat(file.getUrl()).isEqualTo(reservation.getUrl());
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    /** 文件元数据已删除后重复完成必须失败，不能复活原来的对象预约。 */
    @Test
    void deletedFileCannotBeRecreatedByReplayingCompletion() throws Exception {
        byte[] body = bytes("temporary text");
        FileUploadDO upload = reserve(body, false);
        FileDO file = lifecycle.complete(upload.getPath(), owner, body);
        context.getBean(FileService.class).deleteFile(file.getId());
        assertThatThrownBy(() -> lifecycle.complete(upload.getPath(), owner, body)).isInstanceOf(ServiceException.class);
        assertAbsent(upload.getPath());
    }

    /** 到期与不存在的对象预约拒绝登记，大小预算不会因失败回滚到可反复滥用。 */
    @Test
    void expiredAndMissingObjectsCannotBeRegistered() {
        byte[] body = bytes("valid text");
        FileUploadDO expired = reserve(body, false);
        expire(expired);
        assertThatThrownBy(() -> lifecycle.complete(expired.getPath(), owner, body)).isInstanceOf(ServiceException.class);
        FileUploadDO missing = reserve(body, true);
        assertThatThrownBy(() -> lifecycle.complete(missing.getPath(), owner, null)).isInstanceOf(S3Exception.class);
        assertNoMetadata(expired);
        assertNoMetadata(missing);
        assertThat(jdbc.queryForObject("SELECT requests FROM infra_file_upload_quota WHERE owner_key = ?", Integer.class,
                owner)).isEqualTo(2);
    }

    /** 同一身份重复完成返回同一记录，其他身份无法利用已知预约路径登记。 */
    @Test
    void ownerIsolationAndIdempotentCompletion() throws Exception {
        byte[] body = bytes("normal text");
        FileUploadDO upload = reserve(body, false);
        assertThatThrownBy(() -> lifecycle.complete(upload.getPath(), "other:identity", body))
                .isInstanceOfSatisfying(ServiceException.class,
                        failure -> assertThat(failure.getCode()).isEqualTo(FILE_UPLOAD_INVALID.getCode()));
        FileDO first = lifecycle.complete(upload.getPath(), owner, body);
        assertThat(lifecycle.complete(upload.getPath(), owner, body).getId()).isEqualTo(first.getId());
        assertThat(storage.getContent(upload.getPath())).isEqualTo(body);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM infra_file WHERE path = ?", Long.class,
                upload.getPath())).isEqualTo(1L);
    }

    /** 浏览器签名绑定精确大小及元数据，重复写暂存对象不会改变已完成的最终文件。 */
    @Test
    void realPresignedPutBindsLengthAndCannotOverwriteFinalObject() throws Exception {
        byte[] original = bytes("accepted");
        FileUploadDO upload = reserve(original, true);
        String signed = storage.presignPutUrl(upload.getStagingPath(), original.length);
        assertThat(put(signed, original, true)).isEqualTo(200);
        FileDO file = lifecycle.complete(upload.getPath(), owner, null);
        assertThat(put(signed, bytes("modified"), true)).isEqualTo(200);
        assertThat(storage.getContent(file.getPath())).isEqualTo(original);
        assertThat(lifecycle.complete(upload.getPath(), owner, null).getId()).isEqualTo(file.getId());
        assertThat(put(signed, bytes("longer-than-reservation"), true)).isBetween(400, 499);
        assertThat(put(signed, original, false)).isBetween(400, 499);
    }

    /** 存储声明或实际字节超过预约均拒绝登记，不能用伪造客户端 size 绕过服务端大小限制。 */
    @Test
    void oversizedStagingObjectIsRejectedBeforeMetadata() throws Exception {
        FileUploadDO upload = reserve(bytes("ok"), true);
        storage.upload(bytes("oversized data"), upload.getStagingPath(), "text/plain");
        assertThatThrownBy(() -> lifecycle.complete(upload.getPath(), owner, null)).isInstanceOf(IOException.class);
        assertNoMetadata(upload);
        assertThat(jdbc.queryForObject("SELECT status FROM infra_file_upload WHERE id = ?", String.class,
                upload.getId())).isEqualTo("PENDING");
    }

    /** SVG 与 HTML 改名仍被实际内容识别拒绝，不能通过 text/* 或 image/* 宽泛匹配。 */
    @Test
    void activeMarkupRenamedAsImageOrTextIsRejected() {
        for (String name : List.of("document.txt", "avatar.png")) {
            byte[] body = name.endsWith("png")
                    ? bytes("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>")
                    : bytes("<html><script>alert(1)</script></html>");
            FileUploadDO upload = lifecycle.reserve(owner, uniquePath(name), name, body.length, false);
            assertThatThrownBy(() -> lifecycle.complete(upload.getPath(), owner, body))
                    .isInstanceOfSatisfying(ServiceException.class,
                            failure -> assertThat(failure.getCode()).isEqualTo(FILE_TYPE_NOT_ALLOWED.getCode()));
            assertNoMetadata(upload);
        }
    }

    /** 数据库明确拒绝元数据时保留预约，清理失败也保留终态，后续重试最终删除对象。 */
    @Test
    void insertFailureAndCleanupFailureRemainRecoverable() throws Exception {
        byte[] body = bytes("valid text");
        FileUploadDO upload = reserve(body, false);
        jdbc.execute("CREATE TRIGGER reject_file BEFORE INSERT ON infra_file FOR EACH ROW "
                + "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'controlled file insert failure'");
        try {
            assertThatThrownBy(() -> lifecycle.complete(upload.getPath(), owner, body))
                    .isInstanceOf(RuntimeException.class);
        } finally {
            jdbc.execute("DROP TRIGGER reject_file");
        }
        assertNoMetadata(upload);
        assertThat(storage.getContent(upload.getPath())).isEqualTo(body);
        expire(upload);
        doThrow(new IOException("controlled cleanup failure")).when(storage).delete(upload.getPath());
        lifecycle.reconcile(upload.getId());
        assertThat(jdbc.queryForObject("SELECT status FROM infra_file_upload WHERE id = ?", String.class,
                upload.getId())).isEqualTo("CANCELLED");
        assertThatThrownBy(() -> lifecycle.complete(upload.getPath(), owner, body)).isInstanceOf(ServiceException.class);
        reset(storage);
        expire(upload);
        lifecycle.reconcile(upload.getId());
        assertAbsent(upload.getPath());
        // 模拟超时写请求在上次清理后才被存储接收；终态记录必须能再次清除。
        storage.upload(body, upload.getPath(), "text/plain");
        expire(upload);
        lifecycle.reconcile(upload.getId());
        assertAbsent(upload.getPath());
    }

    /** 实际 COMMIT 已成功但客户端收到异常时，不得把成功文件误认成孤儿删除。 */
    @Test
    void unknownCommitOutcomePreservesCommittedObject() throws Exception {
        byte[] body = bytes("committed bytes");
        FileUploadDO upload = reserve(body, false);
        transactions.failAfterCommit.set(true);
        assertThatThrownBy(() -> lifecycle.complete(upload.getPath(), owner, body))
                .isInstanceOf(TransactionSystemException.class);
        expire(upload);
        lifecycle.reconcile(upload.getId());
        assertThat(storage.getContent(upload.getPath())).isEqualTo(body);
        FileDO recovered = lifecycle.complete(upload.getPath(), owner, body);
        assertThat(recovered.getId()).isNotNull();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM infra_file WHERE path = ?", Long.class,
                upload.getPath())).isEqualTo(1L);
    }

    /**
     * 同名同目录由两个身份上传时对象键必须互不复用，一个身份的补偿不得删除另一个身份的对象。
     *
     * <p>放弃的直传预约到期后会被补偿清理；清理只能作用于该预约自己的最终键与暂存键。若对象路径依赖
     * 名称或时间而不含独立随机标识，取消一个身份就会连带删除另一个身份已登记并且仍在提供访问的文件，
     * 因此本例同时核对对象内容、元数据行与存储真实存在性，而不只断言补偿方法的返回值。</p>
     *
     * @throws Exception 预签名上传、登记或存储读取失败时抛出
     */
    @Test
    void abandonedReservationCompensationNeverDeletesAnotherOwnersObject() throws Exception {
        FileServiceImpl service = (FileServiceImpl) context.getBean(FileService.class);
        String firstOwner = "test:" + UUID.randomUUID();
        String secondOwner = "test:" + UUID.randomUUID();
        byte[] abandoned = bytes("abandoned direct upload");
        byte[] registered = bytes("registered file kept by another owner");

        // 同名同目录，两条预约必须落到不同对象键，否则后一次上传会覆盖前一次的对象。
        String abandonedPath = service.generateUploadPath("same-name.txt", "shared");
        String registeredPath = service.generateUploadPath("same-name.txt", "shared");
        assertThat(abandonedPath).isNotEqualTo(registeredPath);

        FileUploadDO pending = lifecycle.reserve(firstOwner, abandonedPath, "same-name.txt", abandoned.length, true);
        storage.upload(abandoned, pending.getStagingPath(), "text/plain");
        FileUploadDO kept = lifecycle.reserve(secondOwner, registeredPath, "same-name.txt", registered.length, false);
        FileDO keptFile = lifecycle.complete(kept.getPath(), secondOwner, registered);

        expire(pending);
        assertThat(status(pending.getId())).isEqualTo("PENDING");
        lifecycle.reconcile(pending.getId());

        // 补偿只清理被放弃预约自己的两个对象，终态记录保留以便迟到写入再次被清除。
        assertThat(status(pending.getId())).isEqualTo("CANCELLED");
        assertAbsent(pending.getPath());
        assertAbsent(pending.getStagingPath());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM infra_file WHERE path = ?", Long.class,
                pending.getPath())).isZero();
        // 另一个身份已登记的对象与元数据必须完好，仍可按编号读回原内容。
        assertThat(storage.getContent(kept.getPath())).isEqualTo(registered);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM infra_file WHERE id = ?", Long.class,
                keptFile.getId())).isEqualTo(1L);
        assertThat(service.getFile(keptFile.getId()).getPath()).isEqualTo(kept.getPath());
        assertThat(lifecycle.complete(kept.getPath(), secondOwner, registered).getId()).isEqualTo(keptFile.getId());
    }

    /**
     * 提交结果不确定与一次补偿同时发生时，只清理被放弃预约自身的孤儿对象。
     *
     * <p>三种结果在同一批数据上并存：已登记文件、COMMIT 实际成功但调用方收到异常、以及被放弃后到期取消
     * 的预约。对账必须保留前两者的对象与元数据，只删除第三者，且不确定提交的预约仍可重试完成；这条链路
     * 正是“数据库事务不是数据库与对象存储的原子事务”的落地核对。</p>
     *
     * @throws Exception 预约、登记、补偿或存储读取失败时抛出
     */
    @Test
    void reconciliationKeepsRegisteredAndUncertainObjectsWhileCleaningAbandonedOne() throws Exception {
        String registeredOwner = "test:" + UUID.randomUUID();
        String uncertainOwner = "test:" + UUID.randomUUID();
        String abandonedOwner = "test:" + UUID.randomUUID();
        byte[] registeredBody = bytes("registered content");
        byte[] uncertainBody = bytes("uncertain commit content");
        byte[] abandonedBody = bytes("abandoned content");

        FileUploadDO registered = reserveFor(registeredOwner, registeredBody, false);
        FileDO registeredFile = lifecycle.complete(registered.getPath(), registeredOwner, registeredBody);

        FileUploadDO uncertain = reserveFor(uncertainOwner, uncertainBody, false);
        transactions.failAfterCommit.set(true);
        assertThatThrownBy(() -> lifecycle.complete(uncertain.getPath(), uncertainOwner, uncertainBody))
                .isInstanceOf(TransactionSystemException.class);

        FileUploadDO abandoned = reserveFor(abandonedOwner, abandonedBody, true);
        storage.upload(abandonedBody, abandoned.getStagingPath(), "text/plain");
        expire(abandoned);

        // 对不确定提交的预约执行一次对账，模拟后台扫描先看到它。
        expire(uncertain);
        lifecycle.reconcile(uncertain.getId());
        assertThat(status(uncertain.getId())).isEqualTo("COMPLETE");
        assertThat(storage.getContent(uncertain.getPath())).isEqualTo(uncertainBody);

        lifecycle.reconcile(abandoned.getId());
        assertThat(status(abandoned.getId())).isEqualTo("CANCELLED");
        assertAbsent(abandoned.getPath());
        assertAbsent(abandoned.getStagingPath());

        // 已登记文件与不确定提交的对象、元数据都不受影响。
        assertThat(storage.getContent(registered.getPath())).isEqualTo(registeredBody);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM infra_file WHERE id = ?", Long.class,
                registeredFile.getId())).isEqualTo(1L);
        assertThat(storage.getContent(uncertain.getPath())).isEqualTo(uncertainBody);
        Long uncertainFileId = jdbc.queryForObject("SELECT id FROM infra_file WHERE path = ?", Long.class,
                uncertain.getPath());
        assertThat(uncertainFileId).isNotNull();
        // 不确定提交仍可重试完成，并返回已经登记成功的同一条记录。
        assertThat(lifecycle.complete(uncertain.getPath(), uncertainOwner, uncertainBody).getId())
                .isEqualTo(uncertainFileId);
    }

    /** 完成持有预约锁时，清理必须等待真实数据库锁并在锁后看到已提交完成状态。 */
    @Test
    void cleanupRacingWithCompletionCannotDeleteFinalObject() throws Exception {
        byte[] body = bytes("concurrent text");
        FileUploadDO upload = reserve(body, true);
        storage.upload(body, upload.getStagingPath(), "text/plain");
        jdbc.update("UPDATE infra_file_upload SET next_cleanup_at = UTC_TIMESTAMP() WHERE id = ?", upload.getId());
        CountDownLatch writing = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        doAnswer(invocation -> {
            writing.countDown();
            assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
            return invocation.callRealMethod();
        }).when(storage).upload(any(byte[].class), anyString(), anyString());
        var executor = Executors.newFixedThreadPool(2);
        try {
            Future<FileDO> completion = executor.submit(() -> lifecycle.complete(upload.getPath(), owner, null));
            assertThat(writing.await(10, TimeUnit.SECONDS)).isTrue();
            Future<?> cleanup = executor.submit(() -> lifecycle.reconcile(upload.getId()));
            await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> assertThat(jdbc.queryForObject(
                    "SELECT COUNT(*) FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l "
                            + "ON w.REQUESTING_ENGINE_LOCK_ID = l.ENGINE_LOCK_ID AND w.ENGINE = l.ENGINE "
                            + "WHERE l.OBJECT_SCHEMA = ?", Long.class, schema)).isPositive());
            release.countDown();
            assertThat(completion.get(10, TimeUnit.SECONDS).getId()).isNotNull();
            cleanup.get(10, TimeUnit.SECONDS);
            assertThat(storage.getContent(upload.getPath())).isEqualTo(body);
            assertAbsent(upload.getStagingPath());
        } finally {
            release.countDown();
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    /** 多线程同时预约同一身份时，日次数和字节限制由数据库原子更新控制。 */
    @Test
    void concurrentReservationsCannotExceedDailyBudget() throws Exception {
        limits.setDailyRequests(3);
        limits.setDailyBytes(15);
        CountDownLatch start = new CountDownLatch(1);
        var executor = Executors.newFixedThreadPool(8);
        try {
            List<Future<Boolean>> results = new ArrayList<>();
            for (int index = 0; index < 12; index++) {
                results.add(executor.submit(() -> {
                    assertThat(start.await(10, TimeUnit.SECONDS)).isTrue();
                    try {
                        reserve(bytes("hello"), false);
                        return true;
                    } catch (ServiceException failure) {
                        assertThat(failure.getCode()).isEqualTo(FILE_UPLOAD_QUOTA_EXCEEDED.getCode());
                        return false;
                    }
                }));
            }
            start.countDown();
            int accepted = 0;
            for (Future<Boolean> result : results) {
                if (result.get(15, TimeUnit.SECONDS)) accepted++;
            }
            assertThat(accepted).isEqualTo(3);
            assertThat(jdbc.queryForObject("SELECT reserved_bytes FROM infra_file_upload_quota WHERE owner_key = ?",
                    Long.class, owner)).isEqualTo(15L);
        } finally {
            start.countDown();
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    /**
     * 大小与路径校验必须发生在任何持久化写入之前，拒绝后不消耗日预算。
     *
     * <p>预约是"先占额度、后写对象"的入口：若大小为零或超过上限仍被放行，后续完成阶段
     * 会写入空对象或超出存储策略的文件；若文件名或对象路径含路径穿越语义被放行，
     * 对象键就会落到本身份目录之外。校验顺序同样重要——先消耗预算再拒绝会让失败请求
     * 白占额度，用户当天无法再上传。</p>
     */
    @Test
    void reserveRejectsInvalidSizeAndPathBeforeQuota() {
        assertThatThrownBy(() -> lifecycle.reserve(owner, uniquePath("note.txt"), "note.txt", 0, false))
                .isInstanceOfSatisfying(ServiceException.class,
                        failure -> assertThat(failure.getCode()).isEqualTo(FILE_SIZE_EXCEEDED.getCode()));
        assertThatThrownBy(() -> lifecycle.reserve(owner, uniquePath("note.txt"), "note.txt",
                limits.getMaxBytes() + 1, false))
                .isInstanceOfSatisfying(ServiceException.class,
                        failure -> assertThat(failure.getCode()).isEqualTo(FILE_SIZE_EXCEEDED.getCode()));
        assertThatThrownBy(() -> lifecycle.reserve(owner, uniquePath("note.txt"), "../evil.txt", 8, false))
                .isInstanceOfSatisfying(ServiceException.class,
                        failure -> assertThat(failure.getCode()).isEqualTo(FILE_PATH_INVALID.getCode()));
        assertThatThrownBy(() -> lifecycle.reserve(owner, "tests/../evil.txt", "note.txt", 8, false))
                .isInstanceOfSatisfying(ServiceException.class,
                        failure -> assertThat(failure.getCode()).isEqualTo(FILE_PATH_INVALID.getCode()));

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM infra_file_upload WHERE owner_key = ?",
                Integer.class, owner)).as("被拒绝的预约不得落库").isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM infra_file_upload_quota WHERE owner_key = ?",
                Integer.class, owner)).as("被拒绝的预约不得消耗日预算").isZero();
    }

    /**
     * 直传预约不允许在完成阶段改为后端上传内容。
     *
     * <p>直传预约的目的是让浏览器把字节写到暂存键，服务端只做有界读取与校验；
     * 若允许调用方再传一份内容，就会出现"最终对象来自请求体、校验来自暂存对象"的分裂，
     * 使大小与类型校验形同虚设。</p>
     */
    @Test
    void directReservationRejectsServerSuppliedContent() {
        byte[] body = bytes("staged only");
        FileUploadDO upload = reserve(body, true);

        assertThatThrownBy(() -> lifecycle.complete(upload.getPath(), owner, body))
                .isInstanceOfSatisfying(ServiceException.class,
                        failure -> assertThat(failure.getCode()).isEqualTo(FILE_UPLOAD_INVALID.getCode()));

        assertNoMetadata(upload);
        assertThat(jdbc.queryForObject("SELECT status FROM infra_file_upload WHERE id = ?", String.class,
                upload.getId())).isEqualTo("PENDING");
    }

    /**
     * 后端上传内容缺失、长度与预约不符或超过当前上限时都必须拒绝登记。
     *
     * <p>预约记录是"用户可以写多少字节"的唯一凭据；缺少长度校验会让客户端用小预约登记大文件，
     * 也会让空内容生成零字节元数据。上限在预约后被调小的场景同样必须拦住，
     * 否则配置收紧对已存在的预约完全无效。</p>
     */
    @Test
    void serverContentMustMatchReservationSizeAndLimit() {
        byte[] body = bytes("valid text");
        FileUploadDO absent = lifecycle.reserve(owner, uniquePath("note.txt"), "note.txt", 10, false);
        assertThatThrownBy(() -> lifecycle.complete(absent.getPath(), owner, null))
                .isInstanceOfSatisfying(ServiceException.class,
                        failure -> assertThat(failure.getCode()).isEqualTo(FILE_SIZE_EXCEEDED.getCode()));

        FileUploadDO mismatch = lifecycle.reserve(owner, uniquePath("note.txt"), "note.txt", body.length + 5, false);
        assertThatThrownBy(() -> lifecycle.complete(mismatch.getPath(), owner, body))
                .as("实际字节数少于预约时同样必须拒绝").isInstanceOfSatisfying(ServiceException.class,
                        failure -> assertThat(failure.getCode()).isEqualTo(FILE_SIZE_EXCEEDED.getCode()));

        limits.setMaxBytes(body.length);
        FileUploadDO lowered = lifecycle.reserve(owner, uniquePath("note.txt"), "note.txt", body.length, false);
        limits.setMaxBytes(body.length - 1);
        assertThatThrownBy(() -> lifecycle.complete(lowered.getPath(), owner, body))
                .as("预约之后收紧上限也必须拦住已经超限的内容").isInstanceOfSatisfying(ServiceException.class,
                        failure -> assertThat(failure.getCode()).isEqualTo(FILE_SIZE_EXCEEDED.getCode()));

        assertNoMetadata(absent);
        assertNoMetadata(mismatch);
        assertNoMetadata(lowered);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM infra_file WHERE path = ?", Long.class,
                absent.getPath())).isZero();
    }

    /**
     * 存储适配器返回空地址或超长地址时不得登记文件。
     *
     * <p>地址由存储客户端按端点与桶名拼接；端点被配错时可能返回空白或超长地址。
     * 此时若仍写库，文件表会留下永远无法访问的记录，且长度超出列容量会在提交阶段才失败，
     * 让"上传成功"的语义无法成立。</p>
     */
    @Test
    void invalidStorageUrlIsRejectedBeforeMetadata() throws Exception {
        byte[] body = bytes("valid text");
        FileUploadDO blank = reserve(body, false);
        doReturn("   ").when(storage).upload(any(byte[].class), anyString(), anyString());
        assertThatThrownBy(() -> lifecycle.complete(blank.getPath(), owner, body))
                .isInstanceOfSatisfying(ServiceException.class,
                        failure -> assertThat(failure.getCode()).isEqualTo(FILE_METADATA_INVALID.getCode()));

        reset(storage);
        FileUploadDO oversized = reserve(body, false);
        doReturn("a".repeat(FilePathUtils.MAX_FILE_URL_LENGTH + 1))
                .when(storage).upload(any(byte[].class), anyString(), anyString());
        assertThatThrownBy(() -> lifecycle.complete(oversized.getPath(), owner, body))
                .isInstanceOfSatisfying(ServiceException.class,
                        failure -> assertThat(failure.getCode()).isEqualTo(FILE_METADATA_INVALID.getCode()));

        assertNoMetadata(blank);
        assertNoMetadata(oversized);
        assertThat(jdbc.queryForObject("SELECT status FROM infra_file_upload WHERE id = ?", String.class,
                oversized.getId())).isEqualTo("PENDING");
    }

    /**
     * 内容探测出的 MIME 超出长度上限时必须在写元数据前拒绝。
     *
     * <p>该类型会写进文件表并作为下载响应头返回；无界文本既可能是探测器的异常输出，
     * 也可能被用来在响应头里附加内容。这里对内容探测做故障注入（真实 Tika 不会产出超长类型），
     * 断言拒绝分类为 {@code FILE_METADATA_INVALID}、没有落库，且预约仍停留在可重试的 PENDING。</p>
     */
    @Test
    void oversizedDetectedMimeTypeIsRejectedBeforeMetadata() throws Exception {
        byte[] body = bytes("valid text");
        FileUploadDO upload = reserve(body, false);
        try (org.mockito.MockedStatic<FileTypeUtils> fileTypeUtils =
                     org.mockito.Mockito.mockStatic(FileTypeUtils.class)) {
            fileTypeUtils.when(() -> FileTypeUtils.isAllowedUploadType(any(byte[].class), anyString())).thenReturn(true);
            fileTypeUtils.when(() -> FileTypeUtils.getMineType(any(byte[].class), anyString()))
                    .thenReturn("x".repeat(FilePathUtils.MAX_MIME_TYPE_LENGTH + 1));

            assertThatThrownBy(() -> lifecycle.complete(upload.getPath(), owner, body))
                    .isInstanceOfSatisfying(ServiceException.class,
                            failure -> assertThat(failure.getCode()).isEqualTo(FILE_METADATA_INVALID.getCode()));
        }

        assertNoMetadata(upload);
        assertThat(jdbc.queryForObject("SELECT status FROM infra_file_upload WHERE id = ?", String.class,
                upload.getId())).isEqualTo("PENDING");
    }

    /**
     * 补偿扫描对未知预约与"到期但预约尚未过期"的记录必须无副作用返回。
     *
     * <p>清理时间与预约过期时间相互独立：清理项可能先到期，此时预约仍在有效的五分钟窗口内，
     * 若直接按到期清理，用户正在进行的上传会在完成前被取消。这里用一个负对照确认
     * 同一条预约在真正过期后确实会被取消，证明前一次返回是边界判断而不是整体失效。</p>
     */
    @Test
    void reconcileSkipsUnknownAndNotYetExpiredReservations() {
        lifecycle.reconcile(999_999L);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM infra_file_upload WHERE owner_key = ?",
                Integer.class, owner)).as("未知预约不得产生任何记录").isZero();

        FileUploadDO pending = reserve(bytes("staged"), true);
        jdbc.update("UPDATE infra_file_upload SET next_cleanup_at = UTC_TIMESTAMP() WHERE id = ?", pending.getId());

        lifecycle.reconcile(pending.getId());

        assertThat(jdbc.queryForObject("SELECT status FROM infra_file_upload WHERE id = ?", String.class,
                pending.getId())).as("预约未过期时不得取消").isEqualTo("PENDING");
        assertThat(jdbc.queryForObject("SELECT next_cleanup_at FROM infra_file_upload WHERE id = ?",
                java.time.LocalDateTime.class, pending.getId())).as("未处理记录不得推进清理时间").isNotNull();

        expire(pending);
        lifecycle.reconcile(pending.getId());

        assertThat(jdbc.queryForObject("SELECT status FROM infra_file_upload WHERE id = ?", String.class,
                pending.getId())).as("真实过期后必须被取消").isEqualTo("CANCELLED");
    }

    /**
     * 存储清理失败时必须先提交取消状态并把重试时间推后五分钟，且不阻塞后续重试。
     *
     * <p>清理失败是正常的运维状态（存储短暂不可用）：状态若不落库，迟到的写入会被重新登记；
     * 重试时间若不推后，失败记录会一直占据扫描批次最前面的位置。这里同时锁定失败后的持久状态、
     * 对象仍然存在（说明确实没有删掉）与重试成功后的对象清理，避免"报错但状态看起来正常"。</p>
     */
    @Test
    void cleanupFailureIsPersistedAndRetriedLater() throws Exception {
        byte[] body = bytes("staged text");
        FileUploadDO upload = reserve(body, true);
        storage.upload(body, upload.getStagingPath(), "text/plain");
        expire(upload);
        doThrow(new IOException("controlled cleanup failure")).when(storage).delete(anyString());

        lifecycle.reconcile(upload.getId());

        assertThat(jdbc.queryForObject("SELECT status FROM infra_file_upload WHERE id = ?", String.class,
                upload.getId())).as("失败也必须提交取消状态").isEqualTo("CANCELLED");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM infra_file_upload WHERE id = ? "
                        + "AND next_cleanup_at BETWEEN DATE_ADD(UTC_TIMESTAMP(), INTERVAL 4 MINUTE) "
                        + "AND DATE_ADD(UTC_TIMESTAMP(), INTERVAL 6 MINUTE)", Integer.class, upload.getId()))
                .as("失败后必须安排五分钟后的重试而不是等到次日").isEqualTo(1);
        assertThat(storage.getContent(upload.getStagingPath()))
                .as("失败必须保留对象以便重试").isEqualTo(body);

        reset(storage);
        expire(upload);
        lifecycle.reconcile(upload.getId());

        assertAbsent(upload.getStagingPath());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM infra_file_upload WHERE id = ? "
                        + "AND next_cleanup_at BETWEEN DATE_ADD(UTC_TIMESTAMP(), INTERVAL 23 HOUR) "
                        + "AND DATE_ADD(UTC_TIMESTAMP(), INTERVAL 25 HOUR)", Integer.class, upload.getId()))
                .as("成功后改为次日核对迟到的写入").isEqualTo(1);
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

    /** 建立本例的唯一正常文本预约。 */
    private FileUploadDO reserve(byte[] body, boolean direct) {
        return reserveFor(owner, body, direct);
    }

    /** 为指定身份建立唯一文本预约，使同一用例可以并存多个互不共享预算与对象的身份。 */
    private FileUploadDO reserveFor(String ownerKey, byte[] body, boolean direct) {
        return lifecycle.reserve(ownerKey, uniquePath("note.txt"), "note.txt", body.length, direct);
    }

    /** 读取预约的持久化状态，避免只断言补偿方法的返回值。 */
    private String status(Long uploadId) {
        return jdbc.queryForObject("SELECT status FROM infra_file_upload WHERE id = ?", String.class, uploadId);
    }

    /** 生成永不复用的测试对象键，不使用任何业务目录。 */
    private String uniquePath(String name) {
        return "tests/" + UUID.randomUUID() + "/" + name;
    }

    /** 通过数据库修改控制到期，不依赖睡眠或修改机器时钟。 */
    private void expire(FileUploadDO upload) {
        jdbc.update("UPDATE infra_file_upload SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE), "
                + "next_cleanup_at = UTC_TIMESTAMP() WHERE id = ?", upload.getId());
    }

    /** 断言失败预约没有产生文件元数据，而非只检查方法抛错。 */
    private void assertNoMetadata(FileUploadDO upload) {
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM infra_file WHERE path = ?", Long.class,
                upload.getPath())).isZero();
    }

    /** 真实 S3 HEAD 必须返回不存在，其他错误不能冒充已清理。 */
    private void assertAbsent(String path) {
        assertThatThrownBy(() -> admin.headObject(builder -> builder.bucket(bucket).key(path)))
                .isInstanceOfSatisfying(S3Exception.class, failure -> assertThat(failure.statusCode()).isEqualTo(404));
    }

    /** 使用实际 HTTP PUT 消费预签名 URL，让 S3 服务验证签名头和长度。 */
    private int put(String url, byte[] body, boolean includeDisposition) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(10))
                .header("Content-Type", "application/octet-stream").PUT(HttpRequest.BodyPublishers.ofByteArray(body));
        if (includeDisposition) request.header("Content-Disposition", "attachment");
        // JDK 17 HttpClient 无 AutoCloseable；共享守护传输不启动服务端监听。
        return HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()
                .send(request.build(), HttpResponse.BodyHandlers.discarding()).statusCode();
    }

    /** 返回明确 UTF-8 字节以保持大小与测试文本一致。 */
    private byte[] bytes(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }

    /** 仅在测试线程装入可信认证结果，客户端请求字段无法覆盖该身份。 */
    private void login(Long id) {
        LoginUser user = new LoginUser();
        user.setId(id);
        user.setUserType(2);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(user, null, List.of()));
    }

    /** 缺少显式测试环境时失败，避免跳过真实数据库和存储证据。 */
    private String environment(String name) {
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
            throw new IllegalStateException("文件测试 Mapper 初始化失败", failure);
        }
    }

    /** 注册真实 Mapper 动态代理，表读写全部进入隔离 MySQL。 */
    private <T> void registerMapper(Class<T> type) {
        context.registerBean(type, () -> {
            try {
                MapperFactoryBean<T> factory = new MapperFactoryBean<>(type);
                factory.setSqlSessionFactory(context.getBean(SqlSessionFactory.class));
                factory.afterPropertiesSet();
                return factory.getObject();
            } catch (Exception failure) {
                throw new IllegalStateException("文件测试 Mapper 创建失败", failure);
            }
        });
    }

    /** 故障点放在真实数据库 COMMIT 之后，模拟调用方无法判断提交结果。 */
    private static class CommitFailureManager extends DataSourceTransactionManager {
        private final AtomicBoolean failAfterCommit = new AtomicBoolean();

        /** 使用真实数据源，除单次注入外保持正常事务行为。 */
        CommitFailureManager(DataSource dataSource) {
            super(dataSource);
        }

        /** 先真正提交，再注入结果传输异常，测试不得将此等同于回滚。 */
        @Override
        protected void doCommit(DefaultTransactionStatus status) {
            super.doCommit(status);
            if (failAfterCommit.compareAndSet(true, false)) {
                throw new TransactionSystemException("controlled unknown commit outcome");
            }
        }
    }

    /** 启用真实事务代理，不启动完整应用或扫描其他业务模块。 */
    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement(proxyTargetClass = true)
    static class TransactionConfiguration {
    }
}
