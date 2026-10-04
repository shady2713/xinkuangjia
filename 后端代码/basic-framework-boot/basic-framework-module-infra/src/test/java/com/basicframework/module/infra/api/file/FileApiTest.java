package com.basicframework.module.infra.api.file;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 {@link FileApi} 两个便捷重载的委托契约。
 *
 * <p>跨模块调用方常用“只给内容”或“内容 + 名称”的简化入口，它们必须在可选参数位置传 null，
 * 由文件服务按自身规则推导目录与 MIME。若便捷入口自行补默认值，同一份文件经不同入口上传
 * 会落到不同路径或带上错误类型，与直接调用四参入口的结果不一致。</p>
 *
 * @author shady2713
 */
class FileApiTest {

    /** 内容，用于确认字节数组按引用传递且未被改写。 */
    private static final byte[] CONTENT = "synthetic-content".getBytes(StandardCharsets.UTF_8);

    /** 记录四参入口收到的参数。 */
    private final List<String> calls = new ArrayList<>();

    /** 只给内容的入口必须把名称、目录与类型都传 null。 */
    @Test
    void singleArgumentOverloadPassesNullMetadata() {
        assertThat(api().createFile(CONTENT)).isEqualTo("resolved-path");

        assertThat(calls).containsExactly("content=" + CONTENT.length + ", name=null, directory=null, type=null");
    }

    /** 内容 + 名称的入口必须只透出名称，目录与类型仍为 null。 */
    @Test
    void contentAndNameOverloadPassesNullDirectoryAndType() {
        assertThat(api().createFile(CONTENT, "note.txt")).isEqualTo("resolved-path");

        assertThat(calls).containsExactly(
                "content=" + CONTENT.length + ", name=note.txt, directory=null, type=null");
    }

    /**
     * 构造只实现四参入口的 API 替身，记录真实收到的参数并返回固定路径。
     *
     * @return 文件 API 替身；预签名入口不属于本用例范围，被调用即失败
     */
    private FileApi api() {
        return new FileApi() {

            /** 记录四参入口收到的内容长度与元数据，返回固定路径。 */
            @Override
            public String createFile(byte[] content, String name, String directory, String type) {
                calls.add(String.format("content=%d, name=%s, directory=%s, type=%s",
                        content.length, name, directory, type));
                return "resolved-path";
            }

            /** 本用例只验证便捷重载的委托参数，预签名入口不应被触达。 */
            @Override
            public String presignGetUrl(String url, Integer expirationSeconds) {
                throw new UnsupportedOperationException("本用例不验证预签名入口");
            }
        };
    }

}
