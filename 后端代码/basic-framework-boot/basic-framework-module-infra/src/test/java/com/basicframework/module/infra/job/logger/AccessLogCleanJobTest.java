package com.basicframework.module.infra.job.logger;

import com.basicframework.module.infra.service.logger.ApiAccessLogService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证访问日志清理任务传给清理服务的保留天数、单批数量与返回描述。
 *
 * <p>该任务由调度器按 Cron 触发，保留天数与单批数量是防止误删近期日志、避免一次删除
 * 压垮数据库的关键口径：保留天数写成其它值会删掉仍需排查的日志，单批数量过大则可能造成
 * 长时间锁表。执行结果描述会写入任务日志供运维核对，必须包含真实清理条数。</p>
 *
 * @author shady2713
 */
class AccessLogCleanJobTest {

    /** 被测任务，清理服务按外部边界替换为可观察替身。 */
    private AccessLogCleanJob job;
    /** 记录调用参数的访问日志清理服务替身。 */
    private ApiAccessLogService apiAccessLogService;

    /** 为每个用例创建独立任务与替身，避免用例之间共享调用记录。 */
    @BeforeEach
    void setUp() {
        job = new AccessLogCleanJob();
        apiAccessLogService = mock(ApiAccessLogService.class);
        ReflectionTestUtils.setField(job, "apiAccessLogService", apiAccessLogService);
    }

    /** 必须按保留 14 天、单批 100 条调用清理服务，并返回带真实条数的描述。 */
    @Test
    void executeCleansWithRetainDaysAndBatchLimit() {
        when(apiAccessLogService.cleanAccessLog(14, 100)).thenReturn(3);

        String result = job.execute("{}");

        verify(apiAccessLogService).cleanAccessLog(14, 100);
        verifyNoMoreInteractions(apiAccessLogService);
        assertThat(result).isEqualTo("定时执行清理访问日志数量 3 个");
    }

    /** 没有可清理数据时必须如实返回 0，便于运维判断任务是否真的执行。 */
    @Test
    void executeReportsZeroWhenNothingIsCleaned() {
        when(apiAccessLogService.cleanAccessLog(14, 100)).thenReturn(0);

        assertThat(job.execute("")).isEqualTo("定时执行清理访问日志数量 0 个");
    }

    /** 调度参数当前不参与清理逻辑，传入不同取值不得改变调用口径。 */
    @Test
    void executeIgnoresSchedulerParam() {
        when(apiAccessLogService.cleanAccessLog(14, 100)).thenReturn(1);

        job.execute("{\"retainDay\":1}");
        job.execute(null);

        verify(apiAccessLogService, times(2)).cleanAccessLog(14, 100);
    }
}
