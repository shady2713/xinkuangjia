package com.basicframework.module.infra.framework.file.core.client;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Objects;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证文件客户端模板类的配置刷新与地址拼接契约。
 *
 * <p>刷新是热路径：配置等价时若仍重新初始化，每次配置轮询都会重建 SDK 连接资源；
 * 初始化失败时若不恢复原配置，会留下一个"持有新配置但资源仍是旧的"的客户端，
 * 后续上传会持续失败且无法回到可用状态。因此本用例用计数与失败注入锁定
 * "等价不重初始化、变化才初始化、失败必回滚并原样抛错"三条规则。</p>
 *
 * <p>另外锁定两处不影响流程但会被下游依赖的行为：受保护的地址拼接模板必须与
 * 文件下载接口路径一致；配置缺省时初始化只写摘要日志，不得在日志语句上抛空指针
 * （错误点会与真实原因完全无关）。</p>
 *
 * @author shady2713
 */
class AbstractFileClientTest {

    /** 固定客户端标识，用于验证摘要与取值回读。 */
    private static final Long CLIENT_ID = 7L;

    /** 配置未变化时不得重新初始化，也不得替换配置对象。 */
    @Test
    void refreshReturnsEarlyWhenConfigIsUnchanged() {
        ProbeConfig original = new ProbeConfig("endpoint-a");
        ProbeFileClient client = new ProbeFileClient(CLIENT_ID, original);
        client.init();
        assertThat(client.initCount()).as("首次初始化必须真实执行").isEqualTo(1);

        client.refresh(new ProbeConfig("endpoint-a"));

        assertThat(client.initCount()).as("等价配置不得再次初始化").isEqualTo(1);
        assertThat(client.currentConfig()).as("等价配置不得替换既有配置对象").isSameAs(original);
    }

    /** 配置变化时必须重新初始化，并记录新配置用于后续比较。 */
    @Test
    void refreshReinitializesWhenConfigChanged() {
        ProbeFileClient client = new ProbeFileClient(CLIENT_ID, new ProbeConfig("endpoint-a"));
        client.init();

        ProbeConfig updated = new ProbeConfig("endpoint-b");
        client.refresh(updated);

        assertThat(client.initCount()).isEqualTo(2);
        assertThat(client.currentConfig()).isSameAs(updated);
        client.refresh(new ProbeConfig("endpoint-b"));
        assertThat(client.initCount()).as("再次刷新等价配置时不再初始化").isEqualTo(2);
    }

    /**
     * 初始化失败时必须恢复刷新前的配置并原样抛出异常。
     *
     * <p>恢复原配置是"失败后仍可用"的唯一依据；若保留失败的新配置，
     * 下一次等价刷新会被判为"没有变化"而永远不会重试，客户端就此卡死。</p>
     */
    @Test
    void failedRefreshRestoresPreviousConfigAndRethrows() {
        ProbeConfig original = new ProbeConfig("endpoint-a");
        ProbeFileClient client = new ProbeFileClient(CLIENT_ID, original);
        client.init();
        IllegalStateException failure = new IllegalStateException("synthetic-init-failure");
        client.failNextInit(failure);

        assertThatThrownBy(() -> client.refresh(new ProbeConfig("endpoint-b"))).isSameAs(failure);

        assertThat(client.currentConfig()).as("失败后必须回到原配置").isSameAs(original);
        // 失败的尝试本身已经执行过一次初始化，因此重试只在此基础上再增加一次
        int attemptsAfterFailure = client.initCount();
        ProbeConfig retry = new ProbeConfig("endpoint-b");
        client.refresh(retry);
        assertThat(client.initCount()).as("恢复后同一目标配置必须可以重试")
                .isEqualTo(attemptsAfterFailure + 1);
        assertThat(client.currentConfig()).isSameAs(retry);
    }

    /** 配置由缺省变为可用时同样必须初始化，不能因原配置为空而跳过。 */
    @Test
    void refreshFromMissingConfigStillInitializes() {
        ProbeFileClient client = new ProbeFileClient(CLIENT_ID, null);

        ProbeConfig updated = new ProbeConfig("endpoint-a");
        client.refresh(updated);

        assertThat(client.initCount()).isEqualTo(1);
        assertThat(client.currentConfig()).isSameAs(updated);
    }

    /**
     * 配置缺省时初始化只写摘要日志，不得抛出空指针。
     *
     * <p>摘要用于在日志里定位是哪个客户端在刷新，实现必须容忍配置缺省；
     * 若摘要解引用空配置，初始化会在日志语句上失败，故障点与真实原因完全无关。</p>
     */
    @Test
    void initToleratesMissingConfig() {
        ProbeFileClient client = new ProbeFileClient(CLIENT_ID, null);

        assertThatCode(client::init).doesNotThrowAnyException();

        assertThat(client.initCount()).isEqualTo(1);
        assertThat(client.getId()).isEqualTo(CLIENT_ID);
    }

    /** 受保护的地址拼接必须与文件下载接口路径一致，并保留调用方给出的域名原样。 */
    @Test
    void formatFileUrlBuildsDownloadEndpoint() {
        ProbeFileClient client = new ProbeFileClient(CLIENT_ID, new ProbeConfig("endpoint-a"));

        assertThat(client.format("https://storage.example.test", "profile/2026/01/avatar.png"))
                .isEqualTo("https://storage.example.test/admin-api/infra/file/content/profile/2026/01/avatar.png");
        assertThat(client.format("", "note.txt"))
                .as("域名为空时只保留接口路径，不产生多余斜杠")
                .isEqualTo("/admin-api/infra/file/content/note.txt");
    }

    /** 客户端标识必须原样返回，供工厂与日志关联配置。 */
    @Test
    void getIdReturnsConstructorId() {
        assertThat(new ProbeFileClient(CLIENT_ID, new ProbeConfig("endpoint-a")).getId()).isEqualTo(CLIENT_ID);
    }

    /**
     * 可观察配置与初始化次数的文件客户端探针。
     *
     * <p>本用例只验证模板类的刷新与拼接行为，因此除 {@code doInit} 计数外的
     * 存储操作一律不支持，避免用假实现掩盖真实存储协议。</p>
     */
    static class ProbeFileClient extends AbstractFileClient<ProbeConfig> {

        /** 已执行的初始化次数。 */
        private int initCount;
        /** 下一次初始化需要抛出的受控异常；为 null 表示正常初始化。 */
        private RuntimeException nextInitFailure;

        /**
         * 以指定标识与初始配置构造探针。
         *
         * @param id 进程内客户端标识
         * @param config 初始配置，允许为 null 以复现配置缺省状态
         */
        ProbeFileClient(Long id, ProbeConfig config) {
            super(id, config);
        }

        /** 记录初始化次数，或抛出调用方注入的受控异常。 */
        @Override
        protected void doInit() {
            initCount++;
            if (nextInitFailure != null) {
                RuntimeException failure = nextInitFailure;
                nextInitFailure = null;
                throw failure;
            }
        }

        /**
         * 读取当前生效配置，用于区分"刷新已生效"与"仍持有旧配置"。
         *
         * @return 当前生效配置，可能为 null
         */
        ProbeConfig currentConfig() {
            return this.config;
        }

        /**
         * 读取已执行的初始化次数。
         *
         * @return 初始化次数
         */
        int initCount() {
            return initCount;
        }

        /**
         * 让下一次初始化抛出指定异常，用于验证失败回滚。
         *
         * @param failure 下一次初始化抛出的异常，只生效一次
         */
        void failNextInit(RuntimeException failure) {
            this.nextInitFailure = failure;
        }

        /**
         * 暴露受保护的地址拼接，供断言真实输出。
         *
         * @param domain 自定义域名
         * @param path 文件路径
         * @return 拼接后的访问地址
         */
        String format(String domain, String path) {
            return formatFileUrl(domain, path);
        }

        /** 探针不执行上传。 */
        @Override
        public String upload(byte[] content, String path, String type) {
            throw new UnsupportedOperationException("探针不执行上传");
        }

        /** 探针不执行删除。 */
        @Override
        public void delete(String path) {
            throw new UnsupportedOperationException("探针不执行删除");
        }

        /** 探针不读取内容。 */
        @Override
        public byte[] getContent(String path) {
            throw new UnsupportedOperationException("探针不读取内容");
        }

        /** 探针不执行有界读取。 */
        @Override
        public byte[] getContent(String path, int maximumBytes) {
            throw new UnsupportedOperationException("探针不执行有界读取");
        }

        /** 探针不列举对象。 */
        @Override
        public FileObjectPage listObjects(String continuationToken) {
            throw new UnsupportedOperationException("探针不列举对象");
        }

        /** 探针不列举目录前缀。 */
        @Override
        public List<String> listPrefixes(String prefix, String delimiter) {
            throw new UnsupportedOperationException("探针不列举目录前缀");
        }
    }

    /** 按端点取值判等的探针配置，用于构造"等价但不同实例"的刷新输入。 */
    static class ProbeConfig implements FileClientConfig {

        /** 配置端点，作为等价判定的唯一字段。 */
        private final String endpoint;

        /**
         * 创建指定端点的探针配置。
         *
         * @param endpoint 配置端点
         */
        ProbeConfig(String endpoint) {
            this.endpoint = endpoint;
        }

        /** 按端点判等，使"等价配置"成为一个可构造的输入。 */
        @Override
        public boolean equals(Object other) {
            if (this == other) {
                return true;
            }
            if (!(other instanceof ProbeConfig that)) {
                return false;
            }
            return Objects.equals(endpoint, that.endpoint);
        }

        /** 与判等保持一致的哈希值。 */
        @Override
        public int hashCode() {
            return Objects.hash(endpoint);
        }
    }
}
