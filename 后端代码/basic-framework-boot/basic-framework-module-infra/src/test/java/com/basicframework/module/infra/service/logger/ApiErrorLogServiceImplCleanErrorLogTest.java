package com.basicframework.module.infra.service.logger;

import com.basicframework.module.infra.dal.mysql.logger.ApiErrorLogMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证错误日志分批清理的循环口径：时间上限、单批数量、累计条数与终止条件。
 *
 * <p>错误日志表数据量大，清理必须分批执行：每批最多删除 {@code deleteLimit} 条，只有上一批
 * 删满时才继续下一批，避免一次性删除长期锁表；累计条数要如实返回给任务日志。时间上限必须
 * 是“当前时间减去保留天数”，写成固定时间或加号方向错误都会误删仍在保留期内的日志。</p>
 *
 * @author shady2713
 */
class ApiErrorLogServiceImplCleanErrorLogTest {

    /** 被测服务，持久化层按外部边界替换为可观察替身。 */
    private ApiErrorLogServiceImpl service;
    /** 记录删除参数的日志 Mapper 替身。 */
    private ApiErrorLogMapper apiErrorLogMapper;

    /** 为每个用例创建独立服务与持久化替身，避免用例之间共享调用记录。 */
    @BeforeEach
    void setUp() {
        service = new ApiErrorLogServiceImpl();
        apiErrorLogMapper = mock(ApiErrorLogMapper.class);
        ReflectionTestUtils.setField(service, "apiErrorLogMapper", apiErrorLogMapper);
    }

    /** 每批删满时必须继续下一批，直到某批不足上限才停止，并累计全部条数。 */
    @Test
    void deletesInBatchesUntilBatchIsNotFull() {
        when(apiErrorLogMapper.deleteByCreateTimeLt(any(LocalDateTime.class), eq(100)))
                .thenReturn(100, 100, 7);

        assertThat(service.cleanErrorLog(14, 100)).as("累计 100+100+7").isEqualTo(207);
        verify(apiErrorLogMapper, times(3)).deleteByCreateTimeLt(any(LocalDateTime.class), eq(100));
    }

    /** 首批不足上限时必须立即停止，不得继续空转删除。 */
    @Test
    void stopsAfterSingleBatchWhenDeletionIsBelowLimit() {
        when(apiErrorLogMapper.deleteByCreateTimeLt(any(LocalDateTime.class), eq(50))).thenReturn(0);

        assertThat(service.cleanErrorLog(7, 50)).isZero();
        verify(apiErrorLogMapper, times(1)).deleteByCreateTimeLt(any(LocalDateTime.class), eq(50));
    }

    /** 时间上限必须是“当前时间减去保留天数”，保留天数与单批数量必须原样传给持久化层。 */
    @Test
    void expireDateIsNowMinusExceedDay() {
        ArgumentCaptor<LocalDateTime> expireDateCaptor = ArgumentCaptor.forClass(LocalDateTime.class);
        when(apiErrorLogMapper.deleteByCreateTimeLt(expireDateCaptor.capture(), eq(30))).thenReturn(0);

        LocalDateTime before = LocalDateTime.now();
        service.cleanErrorLog(14, 30);
        LocalDateTime after = LocalDateTime.now();

        assertThat(expireDateCaptor.getValue())
                .as("时间上限必须落在用例执行期间的 14 天前")
                .isBetween(before.minusDays(14).minusSeconds(5), after.minusDays(14).plusSeconds(5));
    }
}
