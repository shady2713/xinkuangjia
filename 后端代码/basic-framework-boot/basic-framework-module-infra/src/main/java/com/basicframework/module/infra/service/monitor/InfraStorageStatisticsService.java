/** 基于当前对象存储桶采集容量，覆盖所有绕过文件登记表的写入链路。 */
package com.basicframework.module.infra.service.monitor;

import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.module.infra.api.monitor.dto.InfraStorageStatisticsDTO;
import com.basicframework.module.infra.framework.file.core.client.FileObjectPage;
import com.basicframework.module.infra.service.file.FileStorageService;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.Objects;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.LongSupplier;

/**
 * 分页统计当前 MinIO 桶，按真实业务目录互斥分类，不读取文件内容。
 *
 * <p>每个进程最多一个采集者，其他调用者立即读取标明状态的旧快照或未就绪结果；结果缓存 60 秒。
 * 每轮最多 100 页、启动新页前检查 5 秒预算。
 * 单页另受客户端 3 秒超时限制。达到边界或失败时明确返回部分数据，不能当作全量。</p>
 * @author 吴晓群
 */
@Service
@Slf4j
public class InfraStorageStatisticsService {

    /** 采集状态：存储后端不可用，统计值不代表真实占用。 */
    private static final String STATUS_UNAVAILABLE = "unavailable";

    /** 最大扫描对象数为 100 页乘以客户端每页 1000 条。 */
    private static final int MAX_PAGES = 100;
    /** 扫描预算使用单调时钟，避免系统校时影响资源边界。 */
    private static final long SCAN_NANOS = Duration.ofSeconds(5).toNanos();
    /** 完成的采集结果缓存一分钟，失败也缓存以避免请求放大。 */
    private static final long CACHE_NANOS = Duration.ofSeconds(60).toNanos();
    /** 对象列表不提供 MIME；普通媒体按项目上传支持的扩展名归类。 */
    private static final Set<String> IMAGE_EXTENSIONS = Set.of("jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "ico", "tif", "tiff", "avif");
    /** 无法识别的扩展名进入其他对象，仍包含在总容量中。 */
    private static final Set<String> VIDEO_EXTENSIONS = Set.of("mp4", "avi", "mov", "mkv", "flv", "wmv", "webm", "m4v", "ts", "mpeg", "mpg");

    @Resource
    private FileStorageService fileStorageService;
    /** 单一采集锁；并发读取只尝试获取，不等待任何外部网络请求。 */
    private final ReentrantLock collectionLock = new ReentrantLock();
    /** 快照与生成时刻一起发布，避免读到新数据配旧缓存时间。 */
    private volatile Snapshot cachedSnapshot;
    /** 单调时间来源，统一用于过期和扫描预算，测试可独立控制实例时钟。 */
    private final LongSupplier nanoClock;

    /** 生产环境使用进程单调时钟，系统校时不会延长缓存或扫描预算。 */
    public InfraStorageStatisticsService() {
        this(System::nanoTime);
    }

    /** 为实例提供统一单调时钟，不修改全局时间或其他服务的缓存。 */
    InfraStorageStatisticsService(LongSupplier nanoClock) {
        this.nanoClock = Objects.requireNonNull(nanoClock);
    }

    /**
     * 返回独立容量快照；只有取得采集权的调用者执行有界外部扫描。
     * @return 缓存有效时返回原完整性；正在采集时立即返回标明陈旧的快照，无历史结果则为 unavailable
     */
    public InfraStorageStatisticsDTO getStorageStatistics() {
        Snapshot snapshot = cachedSnapshot;
        if (isFresh(snapshot)) {
            return copy(snapshot.statistics());
        }
        if (!collectionLock.tryLock()) {
            snapshot = cachedSnapshot;
            return isFresh(snapshot) ? copy(snapshot.statistics()) : collectingSnapshot(snapshot);
        }
        try {
            // 前一个采集者可能在本次取得锁之前刚发布新结果，避免重复扫描。
            snapshot = cachedSnapshot;
            if (!isFresh(snapshot)) {
                snapshot = new Snapshot(collect(), nanoClock.getAsLong());
                cachedSnapshot = snapshot;
            }
            return copy(snapshot.statistics());
        } finally {
            collectionLock.unlock();
        }
    }

    /** 用同一快照内的时刻判断缓存新鲜度；空缓存始终需要采集。 */
    private boolean isFresh(Snapshot snapshot) {
        return snapshot != null && nanoClock.getAsLong() - snapshot.completedAtNanos() < CACHE_NANOS;
    }

    /** 返回脱离内部缓存的对象，调用方修改统计字段不会污染其他请求。 */
    private InfraStorageStatisticsDTO copy(InfraStorageStatisticsDTO statistics) {
        return BeanUtils.toBean(statistics, InfraStorageStatisticsDTO.class);
    }

    /** 保留旧采集时刻并明确标记未就绪或陈旧结果，不将历史完整快照冒充当前全量。 */
    private InfraStorageStatisticsDTO collectingSnapshot(Snapshot snapshot) {
        if (snapshot == null) {
            InfraStorageStatisticsDTO result = emptyStatistics();
            result.setCollectionStatus(STATUS_UNAVAILABLE);
            result.setCollectionMessage("对象容量正在采集，尚无可用快照；未知容量不显示为零。");
            return result;
        }
        InfraStorageStatisticsDTO result = copy(snapshot.statistics());
        if (!STATUS_UNAVAILABLE.equals(result.getCollectionStatus())) {
            result.setCollectionStatus("partial");
        }
        result.setCollectionMessage("对象容量正在更新，当前展示上次采集结果；请结合采集时间判断，不作为当前桶总量。");
        return result;
    }

    /** 只在内部持有的统计对象和对应结束时刻；发布后不再修改其字段。 */
    private record Snapshot(InfraStorageStatisticsDTO statistics, long completedAtNanos) {
    }

    /** 扫描对象列表并标记完整性；不向页面泄漏第三方异常中的连接信息。 */
    private InfraStorageStatisticsDTO collect() {
        InfraStorageStatisticsDTO statistics = emptyStatistics();
        long started = nanoClock.getAsLong();
        String token = null;
        Set<String> seenTokens = new HashSet<>();
        int pages = 0;
        try {
            do {
                if (pages >= MAX_PAGES || nanoClock.getAsLong() - started >= SCAN_NANOS) {
                    statistics.setCollectionStatus(pages == 0 ? STATUS_UNAVAILABLE : "partial");
                    statistics.setCollectionMessage("达到单次采集上限，仅展示已扫描对象；不能作为桶总量。");
                    break;
                }
                FileObjectPage page = fileStorageService.listObjects(token);
                for (FileObjectPage.Entry entry : page.objects()) {
                    accumulate(statistics, entry);
                }
                pages++;
                token = page.nextToken();
                if (token != null && !seenTokens.add(token)) {
                    throw new IllegalStateException("对象列表分页游标重复");
                }
            } while (token != null);
        } catch (RuntimeException exception) {
            statistics.setCollectionStatus(pages == 0 ? STATUS_UNAVAILABLE : "partial");
            statistics.setCollectionMessage(pages == 0
                    ? "对象存储采集失败，请检查存储连通性与列举权限；未知容量不显示为零。"
                    : "对象存储采集中断，仅展示已扫描对象；不能作为桶总量。");
            // 第三方异常可能携带存储地址，只保留错误类型与已完成页数。
            log.warn("对象容量采集失败 pages={} errorType={}", pages, exception.getClass().getSimpleName());
        }
        statistics.setCollectedAt(LocalDateTime.now());
        return statistics;
    }

    /** 初始化真实零值；仅完整扫描成功后，零值才能解释为空桶。 */
    private InfraStorageStatisticsDTO emptyStatistics() {
        InfraStorageStatisticsDTO statistics = new InfraStorageStatisticsDTO();
        statistics.setCollectionStatus("complete");
        statistics.setCollectionMessage("当前桶对象逻辑容量，最多缓存 60 秒；不含历史版本、未完成分片和副本开销。");
        statistics.setImageFiles(0L);
        statistics.setImageBytes(0L);
        statistics.setClipFiles(0L);
        statistics.setClipBytes(0L);
        statistics.setUploadVideoFiles(0L);
        statistics.setUploadVideoBytes(0L);
        statistics.setTotalFiles(0L);
        statistics.setTotalBytes(0L);
        statistics.setFrameFiles(0L);
        statistics.setFrameBytes(0L);
        statistics.setBusinessImageFiles(0L);
        statistics.setBusinessImageBytes(0L);
        statistics.setOtherFiles(0L);
        statistics.setOtherBytes(0L);
        return statistics;
    }

    /**
     * 按稳定目录优先、扩展名兜底分类，每个对象只进入一个叶子分类。
     * @param statistics 正在累计的快照
     * @param entry 对象路径与非负字节数
     */
    private void accumulate(InfraStorageStatisticsDTO statistics, FileObjectPage.Entry entry) {
        String path = entry.path();
        long size = entry.size();
        statistics.setTotalFiles(statistics.getTotalFiles() + 1);
        statistics.setTotalBytes(statistics.getTotalBytes() + size);
        String extension = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        if (path.startsWith("ai-business/video/")) {
            statistics.setClipFiles(statistics.getClipFiles() + 1);
            statistics.setClipBytes(statistics.getClipBytes() + size);
        } else if (path.startsWith("frames/") || IMAGE_EXTENSIONS.contains(extension)
                || path.startsWith("ai-business/image/")) {
            statistics.setImageFiles(statistics.getImageFiles() + 1);
            statistics.setImageBytes(statistics.getImageBytes() + size);
            if (path.startsWith("frames/")) {
                statistics.setFrameFiles(statistics.getFrameFiles() + 1);
                statistics.setFrameBytes(statistics.getFrameBytes() + size);
            } else if (path.startsWith("ai-business/")) {
                // 兼容现行 ai-business/日期/ 与旧 ai-business/image/ 图片目录。
                statistics.setBusinessImageFiles(statistics.getBusinessImageFiles() + 1);
                statistics.setBusinessImageBytes(statistics.getBusinessImageBytes() + size);
            }
        } else if (VIDEO_EXTENSIONS.contains(extension)) {
            statistics.setUploadVideoFiles(statistics.getUploadVideoFiles() + 1);
            statistics.setUploadVideoBytes(statistics.getUploadVideoBytes() + size);
        } else {
            statistics.setOtherFiles(statistics.getOtherFiles() + 1);
            statistics.setOtherBytes(statistics.getOtherBytes() + size);
        }
    }
}
