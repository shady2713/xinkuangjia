package com.basicframework.module.infra.controller.admin.job;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.infra.controller.admin.job.vo.log.JobLogPageReqVO;
import com.basicframework.module.infra.dal.dataobject.job.JobLogDO;
import com.basicframework.module.infra.enums.job.JobLogStatusEnum;
import com.basicframework.module.infra.service.job.JobLogService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;
import java.util.List;

import static com.basicframework.module.infra.enums.ErrorCodeConstants.EXPORT_SIZE_EXCEEDED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证任务日志接口的对象转换与导出上限。
 *
 * <p>任务日志是本模块增长最快的表，导出的资源边界与任务、配置接口一致：
 * 必须先判总量再写出，且强制全量查询，否则导出结果会被调用方的分页参数静默截断。</p>
 *
 * @author shady2713
 */
class JobLogControllerTest {

    /** 单次导出上限，与生产接口保持一致。 */
    private static final int MAX_EXPORT_SIZE = 10_000;

    private JobLogService jobLogService;
    private JobLogController controller;

    /** 每例重建替身，避免调用记录跨用例累积。 */
    @BeforeEach
    void setUp() {
        jobLogService = mock(JobLogService.class);
        controller = new JobLogController();
        ReflectionTestUtils.setField(controller, "jobLogService", jobLogService);
    }

    /** 详情必须转换为响应对象，覆盖执行序号、耗时和终态等排查所需字段。 */
    @Test
    void detailConvertsLogToResponseObject() {
        when(jobLogService.getJobLog(7L)).thenReturn(log(7L, 2, JobLogStatusEnum.FAILURE.getStatus()));

        var detail = controller.getJobLog(7L).getData();

        assertThat(detail.getId()).isEqualTo(7L);
        assertThat(detail.getJobId()).isEqualTo(42L);
        assertThat(detail.getExecuteIndex()).isEqualTo(2);
        assertThat(detail.getDuration()).isEqualTo(120);
        assertThat(detail.getStatus()).isEqualTo(JobLogStatusEnum.FAILURE.getStatus());
        assertThat(detail.getResult()).isEqualTo("失败原因");
    }

    /** 任务不存在时详情返回空数据，调用方据此区分“无此日志”和“日志字段为空”。 */
    @Test
    void detailOfMissingLogIsNull() {
        when(jobLogService.getJobLog(999L)).thenReturn(null);

        assertThat(controller.getJobLog(999L).getData()).isNull();
    }

    /** 分页必须逐条转换并保留总数。 */
    @Test
    void pageConvertsEveryLogAndKeepsTotal() {
        when(jobLogService.getJobLogPage(any())).thenReturn(new PageResult<>(List.of(
                log(7L, 1, JobLogStatusEnum.SUCCESS.getStatus()),
                log(8L, 1, JobLogStatusEnum.FAILURE.getStatus())), 2L));

        var page = controller.getJobLogPage(new JobLogPageReqVO()).getData();

        assertThat(page.getTotal()).isEqualTo(2);
        assertThat(page.getList()).extracting(response -> response.getId()).containsExactly(7L, 8L);
    }

    /** 导出必须覆盖分页参数为全量查询，并对超限结果直接失败。 */
    @Test
    void exportForcesFullPageQueryAndRejectsOversizedResult() {
        JobLogPageReqVO request = new JobLogPageReqVO();
        request.setPageNo(3);
        request.setPageSize(20);
        when(jobLogService.getJobLogPage(any()))
                .thenReturn(new PageResult<>(List.of(), (long) MAX_EXPORT_SIZE + 1));

        assertThatThrownBy(() -> controller.exportJobLogExcel(request, new MockHttpServletResponse()))
                .isInstanceOfSatisfying(ServiceException.class,
                        failure -> assertThat(failure.getCode()).isEqualTo(EXPORT_SIZE_EXCEEDED.getCode()));

        ArgumentCaptor<JobLogPageReqVO> captor = ArgumentCaptor.forClass(JobLogPageReqVO.class);
        verify(jobLogService).getJobLogPage(captor.capture());
        assertThat(captor.getValue().getPageNo()).isEqualTo(1);
        assertThat(captor.getValue().getPageSize()).isEqualTo(MAX_EXPORT_SIZE);
    }

    /** 未超限时必须真正写出 Excel 并设置下载响应头。 */
    @Test
    void exportWritesExcelWhenResultFitsLimit() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        when(jobLogService.getJobLogPage(any()))
                .thenReturn(new PageResult<>(List.of(log(7L, 1, JobLogStatusEnum.SUCCESS.getStatus())), 1L));

        controller.exportJobLogExcel(new JobLogPageReqVO(), response);

        assertThat(response.getContentType()).isEqualTo("application/vnd.ms-excel;charset=UTF-8");
        assertThat(response.getHeader("Content-Disposition")).contains("attachment");
        assertThat(response.getContentAsByteArray()).isNotEmpty();
    }

    /** 构造带完整字段的日志对象，覆盖响应转换的每个字段。 */
    private JobLogDO log(Long id, Integer executeIndex, Integer status) {
        JobLogDO log = new JobLogDO();
        log.setId(id);
        log.setJobId(42L);
        log.setHandlerName("handler");
        log.setHandlerParam("param");
        log.setExecuteIndex(executeIndex);
        log.setBeginTime(LocalDateTime.now().minusMinutes(1));
        log.setEndTime(LocalDateTime.now());
        log.setDuration(120);
        log.setStatus(status);
        log.setResult("失败原因");
        return log;
    }
}
