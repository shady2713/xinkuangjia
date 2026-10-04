package com.basicframework.module.infra.job.logger;

import com.basicframework.module.infra.service.logger.ApiErrorLogService;
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
 * 验证错误日志清理任务传给清理服务的保留天数、单批数量与返回描述。
 *
 * <p>错误日志是排查线上故障的主要依据，保留天数与单批数量属于运维口径：保留天数过短会
 * 删掉仍在排查窗口内的异常，单批数量过大则会在错误高峰期放大数据库压力。执行结果描述会
 * 写入任务日志，必须包含真实清理条数。</p>
 *
 * @author shady2713
 */
class ErrorLogCleanJobTest {

    /** 被测任务，清理服务按外部边界替换为可观察替身。 */
    private ErrorLogCleanJob job;
    /** 记录调用参数的错误日志清理服务替身。 */
    private ApiErrorLogService apiErrorLogService;

    /** 为每个用例创建独立任务与替身，避免用例之间共享调用记录。 */
    @BeforeEach
    void setUp() {
        job = new ErrorLogCleanJob();
        apiErrorLogService = mock(ApiErrorLogService.class);
        ReflectionTestUtils.setField(job, "apiErrorLogService", apiErrorLogService);
    }

    /** 必须按保留 14 天、单批 100 条调用清理服务，并返回带真实条数的描述。 */
    @Test
    void executeCleansWithRetainDaysAndBatchLimit() {
        when(apiErrorLogService.cleanErrorLog(14, 100)).thenReturn(6);

        String result = job.execute("{}");

        verify(apiErrorLogService).cleanErrorLog(14, 100);
        verifyNoMoreInteractions(apiErrorLogService);
        assertThat(result).isEqualTo("定时执行清理错误日志数量 6 个");
    }

    /** 没有可清理数据时必须如实返回 0，便于运维判断任务是否真的执行。 */
    @Test
    void executeReportsZeroWhenNothingIsCleaned() {
        when(apiErrorLogService.cleanErrorLog(14, 100)).thenReturn(0);

        assertThat(job.execute("")).isEqualTo("定时执行清理错误日志数量 0 个");
    }

    /** 调度参数当前不参与清理逻辑，传入不同取值不得改变调用口径。 */
    @Test
    void executeIgnoresSchedulerParam() {
        when(apiErrorLogService.cleanErrorLog(14, 100)).thenReturn(2);

        job.execute("{\"retainDay\":1}");
        job.execute(null);

        verify(apiErrorLogService, times(2)).cleanErrorLog(14, 100);
    }
}
