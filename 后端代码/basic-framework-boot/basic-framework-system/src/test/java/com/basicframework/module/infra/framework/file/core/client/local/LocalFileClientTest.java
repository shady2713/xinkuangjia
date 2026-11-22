package com.basicframework.module.infra.framework.file.core.client.local;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * {@link LocalFileClient} 单元测试，覆盖 URL 前缀防重复拼接、读写删除与目录穿越防护。
 *
 * @author shady2713
 */
class LocalFileClientTest {

    @TempDir
    Path tempDir;

    @Test
    void upload_withDefaultContentDomain_doesNotDuplicatePrefix() throws Exception {
        LocalFileClientConfig config = new LocalFileClientConfig();
        config.setBasePath(tempDir.toString());
        config.setDomain("/admin-api/infra/file/content");
        LocalFileClient client = new LocalFileClient(1L, config);
        client.init();

        byte[] data = "hello-local-file".getBytes(StandardCharsets.UTF_8);
        String url = client.upload(data, "20261122/sample.txt", "text/plain");

        assertEquals("/admin-api/infra/file/content/20261122/sample.txt", url);
        assertEquals(url, client.presignPrivateGetUrl("20261122/sample.txt", 300));
        assertArrayEquals(data, client.getContent("20261122/sample.txt"));

        client.delete("20261122/sample.txt");
        assertNull(client.getContent("20261122/sample.txt"));
    }

    @Test
    void presignPrivateGetUrl_withOriginDomain_appendsContentPathOnce() {
        LocalFileClientConfig config = new LocalFileClientConfig();
        config.setBasePath(tempDir.toString());
        config.setDomain("https://files.example.com/");
        LocalFileClient client = new LocalFileClient(1L, config);
        client.init();

        assertEquals(
                "https://files.example.com/admin-api/infra/file/content/20261122/a.png",
                client.presignPrivateGetUrl("/20261122/a.png", 300)
        );
    }

    @Test
    void upload_rejectsDirectoryTraversal() {
        LocalFileClientConfig config = new LocalFileClientConfig();
        config.setBasePath(tempDir.toString());
        LocalFileClient client = new LocalFileClient(1L, config);
        client.init();

        assertThrows(IllegalArgumentException.class,
                () -> client.upload("bad".getBytes(StandardCharsets.UTF_8), "../escape.txt", "text/plain"));
    }
}
