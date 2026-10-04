package com.basicframework.module.infra.api.monitor;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.infra.api.monitor.dto.InfraLogStatisticsDTO;
import com.basicframework.module.infra.api.monitor.dto.InfraStorageStatisticsDTO;
import com.basicframework.module.infra.dal.dataobject.job.JobLogDO;
import com.basicframework.module.infra.dal.dataobject.logger.ApiErrorLogDO;
import com.basicframework.module.infra.dal.mysql.job.JobLogMapper;
import com.basicframework.module.infra.dal.mysql.logger.ApiErrorLogMapper;
import com.basicframework.module.infra.service.monitor.InfraStorageStatisticsService;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 验证基础设施监控统计的委托行为与日志统计的查询条件。
 *
 * <p>容量统计直接决定监控页展示的存储占用，必须原样返回存储统计服务的结论。日志统计的
 * 三类数字各有明确口径：异常日志按异常发生时间过滤，失败任务按状态等于失败过滤，重试任务
 * 按执行次数大于 1 过滤，且都限定在统计起始时间之后。条件写错会让监控页虚报或漏报，因此
 * 这里观察真正交给 Mapper 的条件对象，而不是只看返回数量。</p>
 *
 * @author shady2713
 */
class InfraMonitorStatisticsApiImplTest {

    /** 测试用统计起始时间，避免依赖当前时间。 */
    private static final LocalDateTime SINCE = LocalDateTime.of(2026, 9, 1, 0, 0);

    /** 被测统计 API。 */
    private InfraMonitorStatisticsApiImpl statisticsApi;
    /** 容量统计服务替身。 */
    private InfraStorageStatisticsService storageStatisticsService;
    /** 异常日志 Mapper 替身。 */
    private ApiErrorLogMapper apiErrorLogMapper;
    /** 任务日志 Mapper 替身。 */
    private JobLogMapper jobLogMapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使 Lambda 条件能在无 Spring 上下文时解析列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤；缺少元数据时条件对象取列名会
     * 直接抛错，无法观察真实 SQL 片段。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        MapperBuilderAssistant assistant = new MapperBuilderAssistant(new MybatisConfiguration(), "");
        TableInfoHelper.initTableInfo(assistant, JobLogDO.class);
        TableInfoHelper.initTableInfo(assistant, ApiErrorLogDO.class);
    }

    /** 为每个用例创建独立 API 与替身，避免用例之间共享调用记录。 */
    @BeforeEach
    void setUp() {
        statisticsApi = new InfraMonitorStatisticsApiImpl();
        storageStatisticsService = mock(InfraStorageStatisticsService.class);
        apiErrorLogMapper = mock(ApiErrorLogMapper.class);
        jobLogMapper = mock(JobLogMapper.class);
        ReflectionTestUtils.setField(statisticsApi, "storageStatisticsService", storageStatisticsService);
        ReflectionTestUtils.setField(statisticsApi, "apiErrorLogMapper", apiErrorLogMapper);
        ReflectionTestUtils.setField(statisticsApi, "jobLogMapper", jobLogMapper);
    }

    /** 容量统计必须原样返回存储统计服务的结论。 */
    @Test
    void storageStatisticsAreDelegated() {
        InfraStorageStatisticsDTO expected = new InfraStorageStatisticsDTO();
        when(storageStatisticsService.getStorageStatistics()).thenReturn(expected);

        assertThat(statisticsApi.getStorageStatistics()).isSameAs(expected);
    }

    /** 日志统计必须按三类口径查询，并把结果映射到对应字段。 */
    @Test
    void logStatisticsUseFailureAndRetryCriteria() {
        List<LambdaQueryWrapper<JobLogDO>> jobQueries = new ArrayList<>();
        when(apiErrorLogMapper.selectCount(any())).thenReturn(7L);
        when(jobLogMapper.selectCount(any())).thenAnswer(invocation -> {
            jobQueries.add(invocation.getArgument(0));
            return jobQueries.size() == 1 ? 3L : 5L;
        });

        InfraLogStatisticsDTO statistics = statisticsApi.getLogStatistics(SINCE);

        assertThat(jobQueries).as("失败任务与重试任务必须各查询一次").hasSize(2);
        assertThat(jobQueries.get(0).getSqlSegment())
                .as("失败任务按状态等于失败过滤").contains("status")
                .doesNotContain("execute_index");
        assertThat(jobQueries.get(0).getParamNameValuePairs())
                .as("失败状态取值为 2").containsValue(2)
                .containsValue(SINCE);
        assertThat(jobQueries.get(1).getSqlSegment())
                .as("重试任务按执行次数大于 1 过滤").contains("execute_index")
                .doesNotContain("status");
        assertThat(jobQueries.get(1).getParamNameValuePairs())
                .as("重试判定取值为 1").containsValue(1)
                .containsValue(SINCE);
        assertThat(statistics.getApiErrorLogs()).isEqualTo(7L);
        assertThat(statistics.getFailedJobLogs()).isEqualTo(3L);
        assertThat(statistics.getRetryJobLogs()).isEqualTo(5L);
    }

    /** 异常日志统计必须限定异常发生时间不早于统计起始时间。 */
    @Test
    void apiErrorLogsAreFilteredByExceptionTime() {
        List<LambdaQueryWrapper<ApiErrorLogDO>> errorQueries = new ArrayList<>();
        when(apiErrorLogMapper.selectCount(any())).thenAnswer(invocation -> {
            errorQueries.add(invocation.getArgument(0));
            return 0L;
        });
        when(jobLogMapper.selectCount(any())).thenReturn(0L);

        statisticsApi.getLogStatistics(SINCE);

        assertThat(errorQueries).hasSize(1);
        assertThat(errorQueries.get(0).getSqlSegment())
                .as("必须按异常发生时间过滤，而不是创建时间").contains("exception_time");
        assertThat(errorQueries.get(0).getParamNameValuePairs()).containsValue(SINCE);
    }

    /** 统计区间内没有任何数据时必须返回三个 0，而不是 null。 */
    @Test
    void emptyStatisticsReportZeroCounts() {
        when(apiErrorLogMapper.selectCount(any())).thenReturn(0L);
        when(jobLogMapper.selectCount(any())).thenReturn(0L);

        InfraLogStatisticsDTO statistics = statisticsApi.getLogStatistics(SINCE);

        assertThat(statistics.getApiErrorLogs()).isZero();
        assertThat(statistics.getFailedJobLogs()).isZero();
        assertThat(statistics.getRetryJobLogs()).isZero();
    }
}
