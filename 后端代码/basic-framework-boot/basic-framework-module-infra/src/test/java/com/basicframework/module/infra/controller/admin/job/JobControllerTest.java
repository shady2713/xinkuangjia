package com.basicframework.module.infra.controller.admin.job;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.dict.core.DictFrameworkUtils;
import com.basicframework.module.infra.controller.admin.job.vo.job.JobPageReqVO;
import com.basicframework.module.infra.controller.admin.job.vo.job.JobRespVO;
import com.basicframework.module.infra.controller.admin.job.vo.job.JobSaveReqVO;
import com.basicframework.module.infra.dal.dataobject.job.JobDO;
import com.basicframework.module.infra.enums.job.JobStatusEnum;
import com.basicframework.module.infra.service.job.JobService;
import org.junit.jupiter.api.BeforeAll;
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
 * 验证定时任务管理接口的编排行为：参数透传、对象转换、执行时间预览和导出上限。
 *
 * <p>导出上限是这里唯一的资源边界：超过上限必须直接失败而不是先加载再报错，
 * 否则一次误操作就会把整张表读进内存。</p>
 *
 * @author shady2713
 */
class JobControllerTest {

    /** 合法 Cron，用于验证执行时间预览。 */
    private static final String VALID_CRON = "0 0 3 * * ?";
    /** 单次导出上限，与生产接口保持一致。 */
    private static final int MAX_EXPORT_SIZE = 10_000;

    private JobService jobService;
    private JobController controller;

    /**
     * 字典转换器在导出时需要字典公共 API；本测试用空字典替代，只关注导出编排。
     *
     * <p>不初始化时转换器会因缺少字典实现而失败，导致无法观察导出本身的行为。</p>
     */
    @BeforeAll
    static void initEmptyDictionary() {
        DictFrameworkUtils.init(dictType -> List.of());
    }

    /** 每例重建替身，避免调用记录跨用例累积。 */
    @BeforeEach
    void setUp() {
        jobService = mock(JobService.class);
        controller = new JobController();
        ReflectionTestUtils.setField(controller, "jobService", jobService);
    }

    /** 创建、修改、状态变更、删除、触发和同步都必须原样透传请求并返回成功。 */
    @Test
    void mutationsDelegateVerbatimAndReportSuccess() throws Exception {
        when(jobService.createJob(any())).thenReturn(42L);
        JobSaveReqVO create = request("任务");
        JobSaveReqVO update = request("改名任务");
        update.setId(42L);

        assertThat(controller.createJob(create).getData()).isEqualTo(42L);
        assertThat(controller.updateJob(update).getData()).isTrue();
        assertThat(controller.updateJobStatus(42L, JobStatusEnum.STOP.getStatus()).getData()).isTrue();
        assertThat(controller.deleteJob(42L).getData()).isTrue();
        assertThat(controller.deleteJobList(List.of(42L, 43L)).getData()).isTrue();
        assertThat(controller.triggerJob(42L).getData()).isTrue();
        assertThat(controller.syncJob().getData()).isTrue();

        verify(jobService).createJob(create);
        verify(jobService).updateJob(update);
        verify(jobService).updateJobStatus(42L, JobStatusEnum.STOP.getStatus());
        verify(jobService).deleteJob(42L);
        verify(jobService).deleteJobList(List.of(42L, 43L));
        verify(jobService).triggerJob(42L);
        verify(jobService).syncJob();
    }

    /** 详情和分页必须把任务对象转换为响应对象，不能把持久化对象直接暴露出去。 */
    @Test
    void readsConvertTaskToResponseObject() {
        when(jobService.getJob(42L)).thenReturn(job(42L, "任务"));
        when(jobService.getJobPage(any())).thenReturn(new PageResult<>(List.of(job(42L, "任务")), 1L));

        JobRespVO detail = controller.getJob(42L).getData();
        assertThat(detail.getId()).isEqualTo(42L);
        assertThat(detail.getName()).isEqualTo("任务");
        assertThat(detail.getStatus()).isEqualTo(JobStatusEnum.NORMAL.getStatus());

        var page = controller.getJobPage(new JobPageReqVO()).getData();
        assertThat(page.getTotal()).isEqualTo(1);
        assertThat(page.getList()).extracting(JobRespVO::getName).containsExactly("任务");
    }

    /** 任务不存在时预览返回空列表，让调用方能区分“没有任务”和“任务算不出时间”。 */
    @Test
    void nextTimesAreEmptyWhenTaskDoesNotExist() {
        when(jobService.getJob(999L)).thenReturn(null);

        assertThat(controller.getJobNextTimes(999L, 5).getData()).isEmpty();
    }

    /** 预览必须按请求数量返回递增的执行时间，并直接使用任务自身的 Cron。 */
    @Test
    void nextTimesComeFromPersistedCronInRequestedCount() {
        when(jobService.getJob(42L)).thenReturn(job(42L, "任务"));

        List<LocalDateTime> times = controller.getJobNextTimes(42L, 3).getData();

        assertThat(times).hasSize(3);
        assertThat(times).isSorted();
    }

    /**
     * 导出必须覆盖调用方的分页参数为全量查询，再对总量设上限。
     *
     * <p>不覆盖分页参数时，用户传入的 pageSize 会把导出静默截断成部分数据。</p>
     */
    @Test
    void exportForcesFullPageQueryAndRejectsOversizedResult() {
        JobPageReqVO request = new JobPageReqVO();
        request.setPageNo(3);
        request.setPageSize(20);
        when(jobService.getJobPage(any())).thenReturn(new PageResult<>(List.of(), (long) MAX_EXPORT_SIZE + 1));

        assertThatThrownBy(() -> controller.exportJobExcel(request, new MockHttpServletResponse()))
                .isInstanceOfSatisfying(ServiceException.class,
                        failure -> assertThat(failure.getCode()).isEqualTo(EXPORT_SIZE_EXCEEDED.getCode()));

        ArgumentCaptor<JobPageReqVO> captor = ArgumentCaptor.forClass(JobPageReqVO.class);
        verify(jobService).getJobPage(captor.capture());
        assertThat(captor.getValue().getPageNo()).isEqualTo(1);
        assertThat(captor.getValue().getPageSize()).isEqualTo(MAX_EXPORT_SIZE);
    }

    /** 未超限时必须真正写出 Excel 并设置下载响应头，而不是静默返回空响应。 */
    @Test
    void exportWritesExcelWhenResultFitsLimit() throws Exception {
        JobPageReqVO request = new JobPageReqVO();
        MockHttpServletResponse response = new MockHttpServletResponse();
        when(jobService.getJobPage(any())).thenReturn(new PageResult<>(List.of(job(42L, "任务")), 1L));

        controller.exportJobExcel(request, response);

        assertThat(response.getContentType()).isEqualTo("application/vnd.ms-excel;charset=UTF-8");
        assertThat(response.getHeader("Content-Disposition")).contains("attachment");
        assertThat(response.getContentAsByteArray()).isNotEmpty();
    }

    /** 空结果同样要写出带表头的 Excel，保证下载文件不是 0 字节而难以判断。 */
    @Test
    void exportWritesHeaderForEmptyResult() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        when(jobService.getJobPage(any())).thenReturn(new PageResult<>(List.of(), 0L));

        controller.exportJobExcel(new JobPageReqVO(), response);

        assertThat(response.getContentType()).isEqualTo("application/vnd.ms-excel;charset=UTF-8");
        assertThat(response.getContentAsByteArray()).isNotEmpty();
    }

    /** 构造带完整字段的任务对象，覆盖响应转换的每个字段。 */
    private JobDO job(Long id, String name) {
        JobDO job = new JobDO();
        job.setId(id);
        job.setName(name);
        job.setStatus(JobStatusEnum.NORMAL.getStatus());
        job.setHandlerName("handler");
        job.setHandlerParam("param");
        job.setCronExpression(VALID_CRON);
        job.setRetryCount(3);
        job.setRetryInterval(0);
        job.setMonitorTimeout(0);
        return job;
    }

    /** 构造合法保存请求。 */
    private JobSaveReqVO request(String name) {
        JobSaveReqVO request = new JobSaveReqVO();
        request.setName(name);
        request.setHandlerName("handler");
        request.setCronExpression(VALID_CRON);
        request.setRetryCount(0);
        request.setRetryInterval(0);
        return request;
    }
}
