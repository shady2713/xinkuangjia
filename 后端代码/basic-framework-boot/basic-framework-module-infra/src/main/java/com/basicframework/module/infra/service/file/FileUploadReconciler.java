package com.basicframework.module.infra.service.file;

import com.basicframework.module.infra.dal.mysql.file.FileUploadMapper;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 定期消费持久化上传补偿记录；每条使用独立事务，单项失败不影响其他文件。
 *
 * @author shady2713
 */
@Component
@Slf4j
public class FileUploadReconciler {

    @Resource
    private FileUploadMapper uploads;
    @Resource
    private FileUploadLifecycle lifecycle;

    /** 按到期顺序执行一批清理，数据库不可用时保留记录等待后续调度。 */
    @Scheduled(fixedDelayString = "${basic-framework.file.upload.reconcile-delay-ms:60000}",
            initialDelayString = "${basic-framework.file.upload.reconcile-delay-ms:60000}")
    public void reconcile() {
        for (Long id : uploads.selectCleanupIds()) {
            try {
                lifecycle.reconcile(id);
            } catch (RuntimeException failure) {
                log.warn("文件补偿事务未完成，预约编号={}，失败类型={}", id, failure.getClass().getSimpleName());
            }
        }
    }
}
