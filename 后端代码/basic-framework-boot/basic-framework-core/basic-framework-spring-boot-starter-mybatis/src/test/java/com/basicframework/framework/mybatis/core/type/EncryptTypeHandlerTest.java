package com.basicframework.framework.mybatis.core.type;

import cn.hutool.extra.spring.SpringUtil;
import org.apache.ibatis.type.JdbcType;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.parallel.Execution;
import org.junit.jupiter.api.parallel.ExecutionMode;
import org.junit.jupiter.api.parallel.ResourceLock;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.util.ReflectionTestUtils;

import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证字段加密的随机化、完整性保护与 JDBC 往返，防止明文或篡改值进入业务层。
 *
 * <p>密钥只在隔离测试上下文中随机生成，不读取宿主环境或仓库凭据。
 * 测试结束恢复 Hutool 静态上下文，并等待自有工作线程退出。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@Execution(ExecutionMode.SAME_THREAD)
@ResourceLock("hutool-spring-context")
class EncryptTypeHandlerTest {

    /** 测试拥有的属性来源，允许在边界用例中临时移除密钥。 */
    private final Map<String, Object> properties = new HashMap<>();
    /** 测试创建且负责关闭的 Spring 上下文。 */
    private GenericApplicationContext context;
    /** 测试前的 Hutool 上下文，结束时按原值恢复。 */
    private Object originalApplicationContext;
    /** 测试前的 Hutool BeanFactory，避免本测试污染后续配置读取。 */
    private Object originalBeanFactory;

    /** 创建随机测试密钥的属性来源，保留宿主静态状态以便初始化失败后也能恢复。 */
    @BeforeAll
    void setUpEnvironment() {
        originalApplicationContext = ReflectionTestUtils.getField(SpringUtil.class, "applicationContext");
        originalBeanFactory = ReflectionTestUtils.getField(SpringUtil.class, "beanFactory");
        try {
            properties.put("mybatis-plus.encryptor.password", randomPassword());
            MockEnvironment environment = new MockEnvironment();
            environment.getPropertySources().addFirst(new MapPropertySource("encrypt-test", properties));
            context = new GenericApplicationContext();
            context.setEnvironment(environment);
            context.refresh();
            new SpringUtil().setApplicationContext(context);
        } catch (RuntimeException exception) {
            restoreEnvironment();
            throw exception;
        }
    }

    /** 恢复真实静态上下文并关闭测试资源，使随机密钥不会跨套件残留。 */
    @AfterAll
    void tearDownEnvironment() {
        restoreEnvironment();
    }

    /** 密文不包含可识别明文，并带可校验的版本前缀供未来格式演进。 */
    @Test
    void encryptedValueDoesNotExposePlainText() {
        String raw = "SensitiveValue-" + UUID.randomUUID();

        String encrypted = EncryptTypeHandler.encrypt(raw);

        assertThat(encrypted).startsWith("v1:").isNotEqualTo(raw).doesNotContain(raw);
    }

    /** 相同明文使用不同 IV，密文不可据相等关系识别重复内容且都能还原。 */
    @Test
    void repeatedEncryptionUsesDifferentIvAndRestoresPlainText() {
        String raw = "SameInput-" + UUID.randomUUID();

        String first = EncryptTypeHandler.encrypt(raw);
        String second = EncryptTypeHandler.encrypt(raw);

        assertThat(first).isNotEqualTo(second);
        assertThat(Arrays.copyOf(decodePayload(first), 16))
                .isNotEqualTo(Arrays.copyOf(decodePayload(second), 16));
        assertThat(decryptThroughHandler(first)).isEqualTo(raw);
        assertThat(decryptThroughHandler(second)).isEqualTo(raw);
    }

    /** 任意 IV 字节被改动都会被认证拒绝，不能返回损坏明文。 */
    @Test
    void tamperedIvFailsClosed() {
        String encrypted = EncryptTypeHandler.encrypt("payload-" + UUID.randomUUID());

        assertInvalidCipherText(tamperPayload(encrypted, 0));
    }

    /** CBC 密文被改动必须显式失败，不能仅依赖填充偶然发现损坏。 */
    @Test
    void tamperedCipherTextFailsClosed() {
        String encrypted = EncryptTypeHandler.encrypt("payload-" + UUID.randomUUID());

        assertInvalidCipherText(tamperPayload(encrypted, 16));
    }

    /** 认证标签被改动必须拒绝读取，以防伪造标签被当作可信字段。 */
    @Test
    void tamperedAuthenticationTagFailsClosed() {
        String encrypted = EncryptTypeHandler.encrypt("payload-" + UUID.randomUUID());

        assertInvalidCipherText(tamperPayload(encrypted, decodePayload(encrypted).length - 1));
    }

    /** 正常字段往返还原原文，随机化和认证不能改变业务值。 */
    @Test
    void roundTripRestoresPlainText() {
        String raw = "round-trip-" + UUID.randomUUID();

        assertThat(decryptThroughHandler(EncryptTypeHandler.encrypt(raw))).isEqualTo(raw);
    }

    /** SQL NULL 保留空值语义，不生成密文或依赖密钥配置。 */
    @Test
    void nullValueStaysNull() {
        assertThat(EncryptTypeHandler.encrypt(null)).isNull();
        assertThat(decryptThroughHandler(null)).isNull();
    }

    /** MyBatis 的空值入口写 SQL NULL，不能生成字符串密文改变空值查询。 */
    @Test
    void setNonNullParameterSkipsNullValue() throws Exception {
        PreparedStatement statement = mock(PreparedStatement.class);

        new EncryptTypeHandler().setParameter(statement, 1, null, JdbcType.VARCHAR);

        verify(statement).setNull(1, JdbcType.VARCHAR.TYPE_CODE);
        verify(statement, never()).setString(anyInt(), anyString());
    }

    /** JDBC 写入的是可认证密文，并能够通过真实处理器读取入口还原。 */
    @Test
    void setNonNullParameterWritesCipherText() throws Exception {
        PreparedStatement statement = mock(PreparedStatement.class);
        String raw = "written-" + UUID.randomUUID();

        new EncryptTypeHandler().setParameter(statement, 1, raw, JdbcType.VARCHAR);

        org.mockito.ArgumentCaptor<String> captor = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(statement).setString(eq(1), captor.capture());
        assertThat(captor.getValue()).startsWith("v1:").isNotEqualTo(raw).doesNotContain(raw);
        assertThat(decryptThroughHandler(captor.getValue())).isEqualTo(raw);
    }

    /** 按列名读取存储密文时恢复明文，保持已有 JDBC 契约。 */
    @Test
    void getResultDecryptsStoredValue() throws Exception {
        String raw = "stored-" + UUID.randomUUID();
        ResultSet resultSet = resultSetOf(EncryptTypeHandler.encrypt(raw));

        assertThat(new EncryptTypeHandler().getNullableResult(resultSet, "secret")).isEqualTo(raw);
    }

    /** 三种 JDBC 读取入口都保留 SQL NULL，不能转换为空字符串。 */
    @Test
    void getResultKeepsNullValue() throws Exception {
        ResultSet resultSet = mock(ResultSet.class);
        CallableStatement statement = mock(CallableStatement.class);
        EncryptTypeHandler handler = new EncryptTypeHandler();

        assertThat(handler.getNullableResult(resultSet, "secret")).isNull();
        assertThat(handler.getNullableResult(resultSet, 3)).isNull();
        assertThat(handler.getNullableResult(statement, 1)).isNull();
    }

    /** 按列序号读取同样执行认证解密，不能绕过列名入口的保护。 */
    @Test
    void getResultByIndexDecryptsStoredValue() throws Exception {
        String raw = "by-index-" + UUID.randomUUID();
        ResultSet resultSet = mock(ResultSet.class);
        when(resultSet.getString(3)).thenReturn(EncryptTypeHandler.encrypt(raw));

        assertThat(new EncryptTypeHandler().getNullableResult(resultSet, 3)).isEqualTo(raw);
    }

    /** 存储过程读取同样认证解密，保留已有第三个 JDBC 入口。 */
    @Test
    void getResultFromCallableStatementDecryptsStoredValue() throws Exception {
        String raw = "callable-" + UUID.randomUUID();
        CallableStatement statement = mock(CallableStatement.class);
        when(statement.getString(1)).thenReturn(EncryptTypeHandler.encrypt(raw));

        assertThat(new EncryptTypeHandler().getNullableResult(statement, 1)).isEqualTo(raw);
    }

    /** UTF-8 的中文、补充字符和长文本不能因平台默认编码而损坏。 */
    @Test
    void specialCharactersAndLongTextRoundTrip() {
        String raw = "特殊字符@#$%^&*()_+ 中文 emoji😀 " + "长".repeat(500);

        assertThat(decryptThroughHandler(EncryptTypeHandler.encrypt(raw))).isEqualTo(raw);
    }

    /** 明文空串正常加密并还原，保持其与 SQL NULL 的业务区别。 */
    @Test
    void emptyStringRoundTrips() {
        String encrypted = EncryptTypeHandler.encrypt("");

        assertThat(encrypted).startsWith("v1:");
        assertThat(decryptThroughHandler(encrypted)).isEmpty();
    }

    /** 存储空串不符合版本化密文布局，必须失败而非回退空明文。 */
    @Test
    void emptyStoredValueFailsClosed() {
        assertInvalidCipherText("");
        assertInvalidCipherText("v1:");
    }

    /** 明文和无前缀旧格式不能静默读取，零存量前提下只接受新布局。 */
    @Test
    void unversionedStoredValueFailsClosed() {
        assertInvalidCipherText("plaintext");
        assertInvalidCipherText(Base64.getEncoder().encodeToString(new byte[64]));
    }

    /** 未知版本拒绝解密，未来格式变更不能被误用当前算法处理。 */
    @Test
    void unsupportedVersionFailsClosed() {
        assertInvalidCipherText("v2:" + EncryptTypeHandler.encrypt("payload").substring(3));
    }

    /** 非法 Base64 明确失败，错误信息不能包含存储值。 */
    @Test
    void invalidBase64FailsClosed() {
        assertInvalidCipherText("v1:not@base64!");
    }

    /** 任意短于 IV 的内容都属于截断数据，不能进入解密或明文回退。 */
    @Test
    void payloadShorterThanIvFailsClosed() {
        for (int length = 0; length < 16; length++) {
            assertInvalidCipherText(encodePayload(new byte[length]));
        }
    }

    /** 缺少密文块或完整认证标签的布局全部拒绝，空明文也必须有填充块。 */
    @Test
    void missingCipherTextOrTagFailsClosed() {
        assertInvalidCipherText(encodePayload(new byte[16]));
        assertInvalidCipherText(encodePayload(new byte[32]));
        assertInvalidCipherText(encodePayload(new byte[48]));
        String encrypted = EncryptTypeHandler.encrypt("payload-" + UUID.randomUUID());
        byte[] payload = decodePayload(encrypted);
        assertInvalidCipherText(encodePayload(Arrays.copyOf(payload, payload.length - 16)));
    }

    /** 截断一个字节会破坏 CBC 块布局，不能把部分值当作完整业务数据。 */
    @Test
    void truncatedCipherTextFailsClosed() {
        byte[] payload = decodePayload(EncryptTypeHandler.encrypt("payload-" + UUID.randomUUID()));

        assertInvalidCipherText(encodePayload(Arrays.copyOf(payload, payload.length - 1)));
    }

    /** 异钥写入的合法新格式值不能通过认证，也不能返回损坏的明文。 */
    @Test
    void valueEncryptedWithAnotherKeyFailsToDecrypt() {
        String encrypted = withPassword(randomPassword(), () -> EncryptTypeHandler.encrypt("payload"));

        assertInvalidCipherText(encrypted);
    }

    /** 未配置或空密钥保持 Assert 失败约定，并提示实际配置项而非旧注释名。 */
    @Test
    void missingOrEmptyKeyFailsClosed() {
        String encrypted = EncryptTypeHandler.encrypt("payload");
        for (String password : Arrays.asList(null, "")) {
            withPassword(password, () -> {
                assertThatThrownBy(() -> EncryptTypeHandler.encrypt("payload"))
                        .isInstanceOf(IllegalArgumentException.class)
                        .hasMessageContaining("mybatis-plus.encryptor.password");
                assertThatThrownBy(() -> new EncryptTypeHandler()
                        .getNullableResult(resultSetOf(encrypted), "secret"))
                        .isInstanceOf(IllegalArgumentException.class)
                        .hasMessageContaining("mybatis-plus.encryptor.password");
                assertThat(EncryptTypeHandler.encrypt(null)).isNull();
                assertThat(decryptThroughHandler(null)).isNull();
                return null;
            });
        }
    }

    /** 非 AES 长度密钥失败时不返回原文，保留原有密钥长度约束。 */
    @Test
    void invalidKeyLengthFailsClosed() {
        withPassword("invalid-length", () -> {
            assertThatThrownBy(() -> EncryptTypeHandler.encrypt("sensitive-payload"))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("字段加密失败");
            return null;
        });
    }

    /** 16、24 和 32 字节密钥都可使用，字符数不替代 UTF-8 字节数。 */
    @Test
    void supportedKeyLengthsAndUtf8KeyRoundTrip() {
        for (int length : new int[]{16, 24, 32}) {
            withPassword(randomPassword().substring(0, length), () -> {
                assertThat(decryptThroughHandler(EncryptTypeHandler.encrypt("payload"))).isEqualTo("payload");
                return null;
            });
        }
        withPassword("密钥" + randomPassword().substring(0, 10), () -> {
            assertThat(decryptThroughHandler(EncryptTypeHandler.encrypt("中文😀"))).isEqualTo("中文😀");
            return null;
        });
    }

    /** 同步启动的并发读写都还原自己的原文，避免共享 Cipher 或 IV 引入串扰。 */
    @Test
    void concurrentEncryptionAndDecryptionDoNotShareCipherState() throws Exception {
        int workers = 8;
        ExecutorService executor = Executors.newFixedThreadPool(workers);
        CyclicBarrier barrier = new CyclicBarrier(workers);
        List<Future<?>> tasks = new ArrayList<>();
        try {
            for (int worker = 0; worker < workers; worker++) {
                final int workerId = worker;
                tasks.add(executor.submit(() -> {
                    for (int round = 0; round < 20; round++) {
                        barrier.await(10, TimeUnit.SECONDS);
                        String raw = "worker-" + workerId + "-round-" + round + "-中文😀";
                        assertThat(decryptThroughHandler(EncryptTypeHandler.encrypt(raw))).isEqualTo(raw);
                    }
                    return null;
                }));
            }
            for (Future<?> task : tasks) {
                task.get(30, TimeUnit.SECONDS);
            }
        } finally {
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS))
                    .as("本用例拥有的线程必须退出，不能污染后续密钥边界用例")
                    .isTrue();
        }
    }

    /** 经真实 JDBC 读取入口解密，辅助断言仍观察处理器公开契约。 */
    private static String decryptThroughHandler(String encrypted) {
        try {
            return new EncryptTypeHandler().getNullableResult(resultSetOf(encrypted), "secret");
        } catch (SQLException exception) {
            throw new IllegalStateException("测试结果集读取失败", exception);
        }
    }

    /** 对损坏存储值要求统一拒绝，错误文本不泄露原始密文或业务内容。 */
    private static void assertInvalidCipherText(String encrypted) {
        assertThatThrownBy(() -> new EncryptTypeHandler().getNullableResult(resultSetOf(encrypted), "secret"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("字段密文无效");
    }

    /** 构造只控制 JDBC 外部边界的结果集，保留真实解密实现。 */
    private static ResultSet resultSetOf(String value) throws SQLException {
        ResultSet resultSet = mock(ResultSet.class);
        when(resultSet.getString("secret")).thenReturn(value);
        return resultSet;
    }

    /** 解码新格式以构造损坏布局用例，不改变生产算法。 */
    private static byte[] decodePayload(String encrypted) {
        return Base64.getDecoder().decode(encrypted.substring(3));
    }

    /** 编码损坏内容为语法合法的新格式，隔离 Base64 与布局、认证失败原因。 */
    private static String encodePayload(byte[] payload) {
        return "v1:" + Base64.getEncoder().encodeToString(payload);
    }

    /** 修改指定协议区域的单字节，验证 IV、密文与标签都受到认证保护。 */
    private static String tamperPayload(String encrypted, int index) {
        byte[] payload = decodePayload(encrypted);
        payload[index] ^= 1;
        return encodePayload(payload);
    }

    /** 临时改变隔离属性并在断言失败时恢复，避免密钥测试污染其它用例。 */
    private String withPassword(String password, Supplier<String> operation) {
        String originalPassword = (String) properties.get("mybatis-plus.encryptor.password");
        try {
            setPassword(password);
            return operation.get();
        } finally {
            setPassword(originalPassword);
        }
    }

    /** 更新测试拥有的属性，null 表示真正缺失而非字符串形式的空值。 */
    private void setPassword(String password) {
        if (password == null) {
            properties.remove("mybatis-plus.encryptor.password");
        } else {
            properties.put("mybatis-plus.encryptor.password", password);
        }
    }

    /** 生成满足 AES 32 字节约束的独立测试密钥，不依赖真实凭据。 */
    private static String randomPassword() {
        return UUID.randomUUID().toString().replace("-", "");
    }

    /** 先恢复被替换的静态引用，再关闭自有上下文，初始化失败也可调用。 */
    private void restoreEnvironment() {
        try {
            ReflectionTestUtils.setField(SpringUtil.class, "applicationContext", originalApplicationContext);
            ReflectionTestUtils.setField(SpringUtil.class, "beanFactory", originalBeanFactory);
        } finally {
            if (context != null) {
                context.close();
                context = null;
            }
        }
    }
}
