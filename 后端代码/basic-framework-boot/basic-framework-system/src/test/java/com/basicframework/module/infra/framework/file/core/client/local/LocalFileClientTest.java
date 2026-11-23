package com.basicframework.module.infra.framework.file.core.client.local;

import com.basicframework.framework.common.exception.ServiceException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;

import static com.basicframework.module.infra.enums.ErrorCodeConstants.FILE_METADATA_INVALID;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.FILE_PRIVATE_SIGNING_UNSUPPORTED;
import static com.basicframework.module.infra.framework.file.core.utils.FilePathUtils.MAX_FILE_URL_LENGTH;
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
        assertArrayEquals(data, client.getContent("20261122/sample.txt"));

        client.delete("20261122/sample.txt");
        assertNull(client.getContent("20261122/sample.txt"));
    }

    @Test
    void upload_withOriginDomain_appendsContentPathOnce() throws Exception {
        LocalFileClientConfig config = new LocalFileClientConfig();
        config.setBasePath(tempDir.toString());
        config.setDomain("https://files.example.com");
        LocalFileClient client = new LocalFileClient(1L, config);
        client.init();

        assertEquals(
                "https://files.example.com/admin-api/infra/file/content/20261122/a.png",
                client.upload(new byte[]{1}, "20261122/a.png", "image/png")
        );
    }

    @Test
    void presignPrivateGetUrl_rejectsWithStableBusinessError() {
        LocalFileClientConfig config = new LocalFileClientConfig();
        config.setBasePath(tempDir.toString());
        config.setDomain("/admin-api/infra/file/content");
        LocalFileClient client = new LocalFileClient(1L, config);
        client.init();

        ServiceException ex = assertThrows(ServiceException.class,
                () -> client.presignPrivateGetUrl("20261122/sample.txt", 300));
        assertEquals(FILE_PRIVATE_SIGNING_UNSUPPORTED.getCode(), ex.getCode());
    }

    @Test
    void upload_preservesUnicodeAndQuotesPathSyntaxOnce() throws Exception {
        LocalFileClientConfig config = new LocalFileClientConfig();
        config.setBasePath(tempDir.toString());
        config.setDomain("/admin-api/infra/file/content");
        LocalFileClient client = new LocalFileClient(1L, config);
        client.init();

        byte[] data = "segment".getBytes(StandardCharsets.UTF_8);
        String path = "合同📄/a b%#1+c.txt";
        String url = client.upload(data, path, "text/plain");

        assertEquals("/admin-api/infra/file/content/合同📄/a%20b%25%231+c.txt", url);
        assertArrayEquals(data, client.getContent(path));
    }

    @Test
    void upload_checksPublicUrlBudgetIncludingPrefixBeforeWriting() throws Exception {
        String origin = "https://files.example.com/";
        String suffix = "/admin-api/infra/file/content/合同/first%20draft.txt";
        String path = "合同/first draft.txt";
        String tooLong = "合同/first draft2.txt";
        LocalFileClientConfig config = new LocalFileClientConfig();
        config.setBasePath(tempDir.toString());
        config.setDomain(origin + "a".repeat(MAX_FILE_URL_LENGTH - origin.length() - suffix.length()));
        LocalFileClient client = new LocalFileClient(1L, config);
        client.init();

        byte[] data = "budget boundary".getBytes(StandardCharsets.UTF_8);
        assertEquals(MAX_FILE_URL_LENGTH, client.upload(data, path, "text/plain").length());
        assertArrayEquals(data, client.getContent(path));

        ServiceException ex = assertThrows(ServiceException.class,
                () -> client.upload(data, tooLong, "text/plain"));
        assertEquals(FILE_METADATA_INVALID.getCode(), ex.getCode());
        assertNull(client.getContent(tooLong));
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
