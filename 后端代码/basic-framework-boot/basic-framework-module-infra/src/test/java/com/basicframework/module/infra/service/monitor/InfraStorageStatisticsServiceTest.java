package com.basicframework.module.infra.service.monitor;

import com.basicframework.module.infra.api.monitor.InfraMonitorStatisticsApi;
import com.basicframework.module.infra.api.monitor.InfraMonitorStatisticsApiImpl;
import com.basicframework.module.infra.api.monitor.dto.InfraStorageStatisticsDTO;
import com.basicframework.module.infra.framework.file.core.client.FileObjectPage;
import com.basicframework.module.infra.service.file.FileStorageService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.any;

/**
 * 从公开跨模块 API 验证存储采集的并发边界；可控列表请求只替代外部网络，不复制产品算法。
 *
 * @author shady2713
 */
class InfraStorageStatisticsServiceTest {

    /** 一个慢采集尚未释放时其他调用者应得到明确未就绪状态，不能占住所有请求线程。 */
    @Test
    void concurrentReaderDoesNotWaitForStorage() throws Exception {
        FileStorageService storage = mock(FileStorageService.class);
        InfraStorageStatisticsService service = new InfraStorageStatisticsService();
        ReflectionTestUtils.setField(service, "fileStorageService", storage);
        InfraMonitorStatisticsApi api = api(service);
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(storage.listObjects(null)).thenAnswer(invocation -> {
            entered.countDown();
            assertThat(release.await(15, TimeUnit.SECONDS)).isTrue();
            return new FileObjectPage(List.of(new FileObjectPage.Entry("images/a.png", 17)), null);
        });
        var executor = Executors.newFixedThreadPool(2);
        try {
            var collector = executor.submit(api::getStorageStatistics);
            assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
            long started = System.nanoTime();
            var reader = executor.submit(api::getStorageStatistics);
            // 五秒仅是线程清理前的测试截止；外部请求仍被同步点阻塞，不能靠偶然请求完成通过。
            InfraStorageStatisticsDTO waiting = reader.get(5, TimeUnit.SECONDS);
            assertThat(waiting.getCollectionStatus()).isEqualTo("unavailable");
            assertThat(waiting.getCollectedAt()).isNull();
            assertThat(release.getCount()).isEqualTo(1);
            System.out.println("storage-statistics waiting-reader elapsed-us="
                    + TimeUnit.NANOSECONDS.toMicros(System.nanoTime() - started));
            release.countDown();
            assertThat(collector.get(5, TimeUnit.SECONDS).getTotalBytes()).isEqualTo(17);
            verify(storage, times(1)).listObjects(null);
        } finally {
            release.countDown();
            executor.shutdownNow();
            assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    /** 缓存过期重采集时其他请求读取标明陈旧的旧快照，完成后统一发布新结果。 */
    @Test
    void expiredSnapshotRemainsReadableWithoutClaimingCurrentCompleteness() throws Exception {
        AtomicLong clock = new AtomicLong(1);
        FileStorageService storage = mock(FileStorageService.class);
        var service = service(storage, clock);
        when(storage.listObjects(null)).thenReturn(page("a.png", 10));
        InfraStorageStatisticsDTO first = service.getStorageStatistics();
        clock.addAndGet(Duration.ofSeconds(61).toNanos());
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(storage.listObjects(null)).thenAnswer(invocation -> {
            entered.countDown();
            assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
            return page("b.png", 20);
        });
        var executor = Executors.newFixedThreadPool(2);
        try {
            var collecting = executor.submit(service::getStorageStatistics);
            assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
            var reading = executor.submit(service::getStorageStatistics);
            InfraStorageStatisticsDTO stale = reading.get(5, TimeUnit.SECONDS);
            assertThat(stale.getTotalBytes()).isEqualTo(10);
            assertThat(stale.getCollectedAt()).isEqualTo(first.getCollectedAt());
            assertThat(stale.getCollectionStatus()).isEqualTo("partial");
            stale.setTotalBytes(999L);
            assertThat(service.getStorageStatistics().getTotalBytes()).isEqualTo(10);
            release.countDown();
            assertThat(collecting.get(5, TimeUnit.SECONDS).getTotalBytes()).isEqualTo(20);
            assertThat(service.getStorageStatistics().getCollectionStatus()).isEqualTo("complete");
            verify(storage, times(2)).listObjects(null);
        } finally {
            release.countDown();
            executor.shutdownNow();
            assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    /** 一分钟内复用同一采集结果但不暴露内部可变对象，边界到期后重新采集。 */
    @Test
    void cacheLifetimeAndDefensiveCopiesRemainCorrect() {
        AtomicLong clock = new AtomicLong(1);
        FileStorageService storage = mock(FileStorageService.class);
        var service = service(storage, clock);
        when(storage.listObjects(null)).thenReturn(page("a.png", 10), page("b.png", 20));
        service.getStorageStatistics().setTotalBytes(999L);
        clock.addAndGet(Duration.ofSeconds(60).toNanos() - 1);
        assertThat(service.getStorageStatistics().getTotalBytes()).isEqualTo(10);
        verify(storage, times(1)).listObjects(null);
        clock.incrementAndGet();
        assertThat(service.getStorageStatistics().getTotalBytes()).isEqualTo(20);
        verify(storage, times(2)).listObjects(null);
    }

    /** 失败快照被缓存，过期后重新采集能够恢复；依赖故障不能被表示为成功空桶。 */
    @Test
    void collectionFailureIsCachedAndEventuallyRecovers() {
        AtomicLong clock = new AtomicLong(1);
        FileStorageService storage = mock(FileStorageService.class);
        var service = service(storage, clock);
        when(storage.listObjects(null)).thenThrow(new IllegalStateException("private endpoint must not leak"))
                .thenReturn(page("ready.txt", 4));
        InfraStorageStatisticsDTO failed = service.getStorageStatistics();
        assertThat(failed.getCollectionStatus()).isEqualTo("unavailable");
        assertThat(failed.getCollectionMessage()).doesNotContain("private endpoint");
        assertThat(service.getStorageStatistics().getCollectionStatus()).isEqualTo("unavailable");
        verify(storage, times(1)).listObjects(null);
        clock.addAndGet(Duration.ofSeconds(61).toNanos());
        assertThat(service.getStorageStatistics().getTotalBytes()).isEqualTo(4);
        assertThat(service.getStorageStatistics().getCollectionStatus()).isEqualTo("complete");
    }

    /** 互斥分类与子分类保持真实字节总数，缓存优化不改变业务统计口径。 */
    @Test
    void countsMutuallyExclusiveCategoriesAcrossPages() {
        FileStorageService storage = mock(FileStorageService.class);
        var service = service(storage, new AtomicLong());
        when(storage.listObjects(null)).thenReturn(new FileObjectPage(List.of(
                new FileObjectPage.Entry("ai-business/video/a.mp4", 1),
                new FileObjectPage.Entry("frames/a.jpg", 2),
                new FileObjectPage.Entry("ai-business/image/a.png", 3)), "page-2"));
        when(storage.listObjects("page-2")).thenReturn(new FileObjectPage(List.of(
                new FileObjectPage.Entry("other/a.webp", 4),
                new FileObjectPage.Entry("uploads/a.mp4", 5),
                new FileObjectPage.Entry("docs/a.txt", 6)), null));
        var result = service.getStorageStatistics();
        assertThat(result.getCollectionStatus()).isEqualTo("complete");
        assertThat(result.getTotalFiles()).isEqualTo(6);
        assertThat(result.getTotalBytes()).isEqualTo(21);
        assertThat(result.getFrameBytes()).isEqualTo(2);
        assertThat(result.getBusinessImageBytes()).isEqualTo(3);
        assertThat(result.getImageBytes()).isEqualTo(9);
        assertThat(result.getClipBytes()).isEqualTo(1);
        assertThat(result.getUploadVideoBytes()).isEqualTo(5);
        assertThat(result.getOtherBytes()).isEqualTo(6);
    }

    /** 页数上限仍限制对象列举次数，未扫完整个桶时不得发布 complete。 */
    @Test
    void pageLimitPublishesOnlyPartialStatistics() {
        FileStorageService storage = mock(FileStorageService.class);
        var service = service(storage, new AtomicLong());
        AtomicInteger calls = new AtomicInteger();
        when(storage.listObjects(any())).thenAnswer(invocation -> new FileObjectPage(
                List.of(new FileObjectPage.Entry("objects/a.txt", 1)), "page-" + calls.incrementAndGet()));
        var result = service.getStorageStatistics();
        assertThat(calls.get()).isEqualTo(100);
        assertThat(result.getCollectionStatus()).isEqualTo("partial");
        assertThat(result.getTotalBytes()).isEqualTo(100);
    }

    /** 使用单调预算在下一页前停止扫描，防止把单页超时相乘为无界总时长。 */
    @Test
    void elapsedBudgetStopsBeforeStartingAnotherPage() {
        AtomicLong clock = new AtomicLong();
        FileStorageService storage = mock(FileStorageService.class);
        var service = service(storage, clock);
        when(storage.listObjects(null)).thenAnswer(invocation -> {
            clock.addAndGet(Duration.ofSeconds(5).toNanos());
            return new FileObjectPage(List.of(new FileObjectPage.Entry("objects/a.txt", 2)), "next");
        });
        var result = service.getStorageStatistics();
        assertThat(result.getCollectionStatus()).isEqualTo("partial");
        assertThat(result.getTotalBytes()).isEqualTo(2);
        verify(storage, times(1)).listObjects(any());
    }

    /** 重复游标中止采集并保留部分结果，不能忙循环直到预算耗尽。 */
    @Test
    void repeatingPaginationTokenCannotClaimComplete() {
        FileStorageService storage = mock(FileStorageService.class);
        var service = service(storage, new AtomicLong());
        when(storage.listObjects(any())).thenReturn(new FileObjectPage(List.of(), "same"));
        assertThat(service.getStorageStatistics().getCollectionStatus()).isEqualTo("partial");
        verify(storage, times(2)).listObjects(any());
    }

    /** 为时间边界测试提供实例私有时钟，不影响其他线程或服务。 */
    private InfraStorageStatisticsService service(FileStorageService storage, AtomicLong clock) {
        var service = new InfraStorageStatisticsService(clock::get);
        ReflectionTestUtils.setField(service, "fileStorageService", storage);
        return service;
    }

    /** 单对象结束页用于缓存与失败恢复场景。 */
    private FileObjectPage page(String name, long size) {
        return new FileObjectPage(List.of(new FileObjectPage.Entry(name, size)), null);
    }

    /** 使用生产跨模块适配器，不把 Service 局部结果误称为页面或网络端到端结果。 */
    private InfraMonitorStatisticsApi api(InfraStorageStatisticsService service) {
        InfraMonitorStatisticsApiImpl api = new InfraMonitorStatisticsApiImpl();
        ReflectionTestUtils.setField(api, "storageStatisticsService", service);
        return api;
    }
}
