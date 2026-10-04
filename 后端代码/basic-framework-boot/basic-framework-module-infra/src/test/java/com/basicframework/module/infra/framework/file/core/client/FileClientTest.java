package com.basicframework.module.infra.framework.file.core.client;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证文件客户端接口默认实现的真实契约。
 *
 * <p>接口的默认实现决定各存储实现的共同底线：不支持的能力必须抛出带明确中文提示的
 * {@link UnsupportedOperationException}，让上层能区分“存储不支持”与“调用失败”，
 * 而不是返回空结果伪装成功；{@code copy} 必须按“读取源对象内容后写到目标路径”的真实语义执行，
 * 复制结果要与上传返回值一致；{@code close} 默认无操作，供不持有连接的实现直接继承。</p>
 *
 * <p>用例用一个记录调用的最小实现驱动默认方法，断言真实入参透传与异常提示。</p>
 *
 * @author shady2713
 */
class FileClientTest {

    /** 记录调用的最小实现，只实现抽象方法，默认方法由接口提供。 */
    private final RecordingFileClient client = new RecordingFileClient();

    /** 对象容量采集默认不支持，必须给出明确提示。 */
    @Test
    void listObjectsIsUnsupportedByDefault() {
        assertThatThrownBy(() -> client.listObjects("DUMMY-CONTINUATION-TOKEN"))
                .isInstanceOf(UnsupportedOperationException.class)
                .hasMessage("当前存储不支持对象容量采集");
    }

    /** 前缀列举、前缀删除与两种预签名默认都不支持，且提示一致。 */
    @Test
    void prefixAndPresignOperationsAreUnsupportedByDefault() {
        assertThatThrownBy(() -> client.listPrefixes("demo/", "/"))
                .isInstanceOf(UnsupportedOperationException.class).hasMessage("不支持的操作");
        assertThatThrownBy(() -> client.deletePrefix("demo/"))
                .isInstanceOf(UnsupportedOperationException.class).hasMessage("不支持的操作");
        assertThatThrownBy(() -> client.presignPutUrl("demo/a.txt", 1024L))
                .isInstanceOf(UnsupportedOperationException.class).hasMessage("不支持的操作");
        assertThatThrownBy(() -> client.presignGetUrl("https://cdn.example.test/a.txt", 60))
                .isInstanceOf(UnsupportedOperationException.class).hasMessage("不支持的操作");
    }

    /** 复制必须读取源路径内容并写到目标路径，类型原样传递且返回上传结果。 */
    @Test
    void copyReadsSourceAndUploadsToTarget() throws Exception {
        client.content.put("demo/source.txt", new byte[] {1, 2, 3});

        String result = client.copy("demo/source.txt", "demo/target.txt", "text/plain");

        assertThat(result).isEqualTo("/demo/target.txt");
        assertThat(client.uploadedPath).isEqualTo("demo/target.txt");
        assertThat(client.uploadedType).isEqualTo("text/plain");
        assertThat(client.uploadedContent).containsExactly(1, 2, 3);
        assertThat(client.readPaths).containsExactly("demo/source.txt");
    }

    /** 源对象不存在时复制必须原样失败，不得写出空文件。 */
    @Test
    void copyFailsWhenSourceMissing() {
        assertThatThrownBy(() -> client.copy("demo/absent.txt", "demo/target.txt", "text/plain"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("源对象不存在");
        assertThat(client.uploadedPath).as("读取失败时不得上传任何内容").isNull();
    }

    /** 默认关闭实现不持有资源，调用不得抛异常也不需要实现方覆写。 */
    @Test
    void closeIsNoOpByDefault() throws Exception {
        assertThatCode(client::close).doesNotThrowAnyException();
        assertThat(FileClient.class.getMethod("close").isDefault())
                .as("关闭必须是接口默认实现，避免每个存储实现重复空实现").isTrue();
    }

    /** 最小文件客户端实现：记录读写调用，供默认方法断言真实入参。 */
    private static class RecordingFileClient implements FileClient {

        /** 预置的对象内容，键为路径。 */
        private final java.util.Map<String, byte[]> content = new java.util.HashMap<>();
        /** 被读取过的路径。 */
        private final List<String> readPaths = new ArrayList<>();
        /** 最近一次上传的内容。 */
        private byte[] uploadedContent;
        /** 最近一次上传的目标路径。 */
        private String uploadedPath;
        /** 最近一次上传的 MIME 类型。 */
        private String uploadedType;
        /**
         * 返回客户端编号。
         *
         * @return 固定编号
         */
        @Override
        public Long getId() {
            return 1L;
        }

        /**
         * 记录上传入参并返回目标路径。
         *
         * @param content 文件内容
         * @param path 目标路径
         * @param type MIME 类型
         * @return 目标路径
         */
        @Override
        public String upload(byte[] content, String path, String type) {
            this.uploadedContent = content;
            this.uploadedPath = path;
            this.uploadedType = type;
            return "/" + path;
        }

        /**
         * 删除对象，本替身不保存状态。
         *
         * @param path 目标路径
         */
        @Override
        public void delete(String path) {
            content.remove(path);
        }

        /**
         * 读取对象内容。
         *
         * @param path 目标路径
         * @return 对象内容
         */
        @Override
        public byte[] getContent(String path) {
            readPaths.add(path);
            byte[] value = content.get(path);
            if (value == null) {
                throw new IllegalArgumentException("源对象不存在：" + path);
            }
            return value;
        }

        /**
         * 读取有上限的对象内容，本替身按完整内容返回。
         *
         * @param path 目标路径
         * @param maximumBytes 读取上限
         * @return 对象内容
         */
        @Override
        public byte[] getContent(String path, int maximumBytes) {
            return getContent(path);
        }
    }

}
