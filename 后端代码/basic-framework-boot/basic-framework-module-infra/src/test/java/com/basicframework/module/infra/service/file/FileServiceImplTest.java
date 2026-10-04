package com.basicframework.module.infra.service.file;

import com.basicframework.module.infra.dal.dataobject.file.FileDO;
import com.basicframework.module.infra.dal.mysql.file.FileMapper;
import com.basicframework.module.infra.framework.file.core.utils.FilePathUtils;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * 验证并发上传路径隔离及批量删除的逐项失败边界。
 *
 * @author OpenAI Codex
 */
class FileServiceImplTest {

    private FileServiceImpl service;
    private FileStorageService storage;
    private FileMapper mapper;

    /** 为每个用例创建独立服务和外部边界，避免行为依赖测试顺序。 */
    @BeforeEach
    void setUp() {
        service = new FileServiceImpl();
        storage = mock(FileStorageService.class);
        mapper = mock(FileMapper.class);
        ReflectionTestUtils.setField(service, "fileStorageService", storage);
        ReflectionTestUtils.setField(service, "fileMapper", mapper);
    }

    /** 同名并发上传必须获得独立且合法的对象键，不能靠毫秒间隔避免覆盖。 */
    @Test
    void concurrentSameNameUploadsNeverReuseObjectKeys() throws Exception {
        var executor = Executors.newFixedThreadPool(8);
        try {
            CountDownLatch start = new CountDownLatch(1);
            List<Future<List<String>>> tasks = new ArrayList<>();
            for (int worker = 0; worker < 8; worker++) {
                tasks.add(executor.submit(() -> {
                    assertThat(start.await(5, TimeUnit.SECONDS)).isTrue();
                    List<String> paths = new ArrayList<>();
                    for (int index = 0; index < 128; index++) {
                        paths.add(service.generateUploadPath("头像.png", "profile"));
                    }
                    return paths;
                }));
            }
            start.countDown();
            var paths = new HashSet<String>();
            for (Future<List<String>> task : tasks) {
                for (String path : task.get(10, TimeUnit.SECONDS)) {
                    assertThat(FilePathUtils.isObjectPathValid(path)).isTrue();
                    assertThat(path).startsWith("profile/").endsWith(".png");
                    assertThat(paths.add(path)).as("每次上传独占对象键").isTrue();
                }
            }
            assertThat(paths).hasSize(1024);
        } finally {
            executor.shutdownNow();
            assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    /** 归一化浏览器文件名仍保留类型，同时拒绝目录越界。 */
    @Test
    void generatedPathsPreserveExtensionAndRejectEscapingDirectories() {
        assertThat(service.generateUploadPath("C:\\fakepath\\头像.png", null))
                .doesNotContain("fakepath", "\\").endsWith(".png");
        assertThatThrownBy(() -> service.generateUploadPath("avatar.png", "../another-user"))
                .isInstanceOf(RuntimeException.class);
        assertThatThrownBy(() -> service.generateUploadPath("avatar.png", "upload-staging/child"))
                .isInstanceOf(RuntimeException.class);
    }

    /** 未验证暂存对象和越界路径不得经应用域名读取，防止绕过附件下载头。 */
    @Test
    void publicReadsRejectStagingAndInvalidPaths() throws Exception {
        assertThat(service.getFileContent("upload-staging/example")).isNull();
        assertThat(service.getFileContent("../another-object")).isNull();
        verifyNoInteractions(storage);
    }

    /**
     * 空文件名保持空值语义，对象路径的空白与超长边界必须在入库前被拒绝。
     *
     * <p>文件名可能整份缺失：归一化把 null 变成字符串 "null" 会生成名为 null 的对象键；
     * 对象路径是预签名上传后登记定位的唯一依据，空白或超过列容量的路径一旦放行，
     * 要么登记出无法访问的对象，要么在数据库写入阶段才失败。</p>
     */
    @Test
    void blankFileNamesAndInvalidObjectPathsAreRejected() {
        assertThat(FilePathUtils.normalizeFileName(null)).isNull();
        assertThat(FilePathUtils.normalizeFileName("")).isEmpty();
        assertThat(FilePathUtils.normalizeFileName("   ")).as("纯空白名称清理后为空").isEmpty();
        assertThat(FilePathUtils.normalizeFileName("C:\\fakepath\\头像.png")).isEqualTo("头像.png");

        assertThat(FilePathUtils.isObjectPathValid(null)).isFalse();
        assertThat(FilePathUtils.isObjectPathValid("")).isFalse();
        assertThat(FilePathUtils.isObjectPathValid("   ")).isFalse();
        assertThat(FilePathUtils.isObjectPathValid("a".repeat(FilePathUtils.MAX_OBJECT_PATH_LENGTH + 1)))
                .as("超过列容量的路径必须拒绝").isFalse();
        assertThat(FilePathUtils.isObjectPathValid("a".repeat(FilePathUtils.MAX_OBJECT_PATH_LENGTH)))
                .as("恰好等于列容量的受限相对路径仍然可用").isTrue();
        assertThat(FilePathUtils.isObjectPathValid("profile/2026/01/头像.png")).isTrue();
    }

    /** 第二项存储失败时，第一项元数据已经移除，失败项及未开始项保持可重试。 */
    @Test
    void partialBatchFailureKeepsMetadataOnlyForUnfinishedItems() throws Exception {
        FileDO first = file(1L, "owned-first.png");
        FileDO second = file(2L, "owned-second.png");
        FileDO third = file(3L, "owned-third.png");
        List<Long> ids = List.of(1L, 2L, 3L);
        when(mapper.selectByIds(ids)).thenReturn(List.of(first, second, third));
        doThrow(new IOException("测试存储不可用")).when(storage).delete(second.getPath());

        assertThatThrownBy(() -> service.deleteFileList(ids)).isInstanceOf(IOException.class);

        InOrder order = inOrder(storage, mapper);
        order.verify(storage).delete(first.getPath());
        order.verify(mapper).deleteById(first.getId());
        order.verify(storage).delete(second.getPath());
        verify(mapper, never()).deleteById(second.getId());
        verify(storage, never()).delete(third.getPath());
        verify(mapper, never()).deleteByIds(anyCollection());
    }

    /** 生成仅含本测试删除操作所需标识和对象键的记录。 */
    private FileDO file(Long id, String path) {
        FileDO file = new FileDO();
        file.setId(id);
        file.setPath(path);
        return file;
    }
}
