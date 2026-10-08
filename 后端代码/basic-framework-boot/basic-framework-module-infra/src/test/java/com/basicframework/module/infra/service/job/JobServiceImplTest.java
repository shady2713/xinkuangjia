package com.basicframework.module.infra.service.job;

import cn.hutool.extra.spring.SpringUtil;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.quartz.core.handler.JobHandler;
import com.basicframework.framework.quartz.core.scheduler.SchedulerManager;
import com.basicframework.module.infra.controller.admin.job.vo.job.JobPageReqVO;
import com.basicframework.module.infra.controller.admin.job.vo.job.JobSaveReqVO;
import com.basicframework.module.infra.dal.dataobject.job.JobDO;
import com.basicframework.module.infra.dal.mysql.job.JobMapper;
import com.basicframework.module.infra.enums.job.JobStatusEnum;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.MockedStatic;
import org.quartz.SchedulerException;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static com.basicframework.module.infra.enums.ErrorCodeConstants.JOB_CHANGE_STATUS_EQUALS;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.JOB_CHANGE_STATUS_INVALID;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.JOB_CRON_EXPRESSION_VALID;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.JOB_HANDLER_BEAN_NOT_EXISTS;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.JOB_HANDLER_BEAN_TYPE_ERROR;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.JOB_HANDLER_EXISTS;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.JOB_NOT_EXISTS;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.JOB_UPDATE_ONLY_NORMAL_STATUS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证定时任务服务与数据库配置、Quartz 调度器之间的一致性规则。
 *
 * <p>定时任务配置先落库、再同步调度器，两侧不一致会直接表现为"任务没跑"或"任务重复跑"：
 * 创建时处理器 Bean 不存在却先落库，会留下一条永远无法执行的任务；处理器类型不是任务处理器时，
 * Quartz 运行期才报错；只有开启状态的任务允许修改，暂停任务被改后会被调度器重新拉起；
 * 状态切换时"已经是该状态"必须被拒绝，否则会重复向调度器发送恢复指令。</p>
 *
 * <p>数据库与调度器都替换为进程外替身，Cron 合法性判定、处理器类型判定、状态流转规则与异常类型
 * 全部真实执行；断言核对真实业务错误码、写入对象的状态字段，以及调度器替身实际收到的处理器名称、
 * 参数与重试配置。</p>
 *
 * @author shady2713
 */
class JobServiceImplTest {

    /** 替换数据库自增的任务编号。 */
    private static final Long GENERATED_ID = 2048L;

    /** 合法且被 Quartz 接受的 Cron 表达式。 */
    private static final String VALID_CRON = "0/10 * * * * ? *";

    /** 被测服务。 */
    private JobServiceImpl jobService;
    /** 定时任务持久层替身。 */
    private JobMapper jobMapper;
    /** Quartz 调度器管理器替身。 */
    private SchedulerManager schedulerManager;

    /**
     * 装配服务与两个替身。
     */
    @BeforeEach
    void setUp() {
        jobService = new JobServiceImpl();
        jobMapper = mock(JobMapper.class);
        schedulerManager = mock(SchedulerManager.class);
        ReflectionTestUtils.setField(jobService, "jobMapper", jobMapper);
        ReflectionTestUtils.setField(jobService, "schedulerManager", schedulerManager);
    }

    /**
     * 构造一条定时任务配置。
     *
     * @param id 任务编号
     * @param handlerName 处理器名称
     * @param status 任务状态
     * @return 定时任务配置
     */
    private static JobDO jobDO(Long id, String handlerName, Integer status) {
        JobDO job = JobDO.builder().id(id).name("测试任务").handlerName(handlerName)
                .handlerParam("userId=1").cronExpression(VALID_CRON)
                .retryCount(3).retryInterval(1000).status(status).build();
        return job;
    }

    /**
     * 构造一条定时任务保存请求。
     *
     * @param handlerName 处理器名称
     * @return 保存请求
     */
    private static JobSaveReqVO saveReqVO(String handlerName) {
        JobSaveReqVO reqVO = new JobSaveReqVO();
        reqVO.setName("测试任务");
        reqVO.setHandlerName(handlerName);
        reqVO.setHandlerParam("userId=1");
        reqVO.setCronExpression(VALID_CRON);
        reqVO.setRetryCount(3);
        reqVO.setRetryInterval(1000);
        return reqVO;
    }

    /**
     * 让任务处理器查找返回指定的 Spring Bean。
     *
     * @param handlerName 处理器名称
     * @param bean Spring 容器中返回的 Bean
     * @return SpringUtil 静态替身，调用方负责关闭
     */
    private static MockedStatic<SpringUtil> mockHandlerBean(String handlerName, Object bean) {
        MockedStatic<SpringUtil> springUtil = mockStatic(SpringUtil.class);
        springUtil.when(() -> SpringUtil.getBean(handlerName)).thenReturn(bean);
        return springUtil;
    }

    /** 创建成功时先以初始化状态落库，补齐监控超时，再登记调度并把状态推进为开启。 */
    @Test
    void createJobRegistersSchedulerAndSwitchesToNormal() throws SchedulerException {
        try (MockedStatic<SpringUtil> springUtil = mockHandlerBean("testHandler", mock(JobHandler.class))) {
            when(jobMapper.selectByHandlerName("testHandler")).thenReturn(null);
            doAnswer(invocation -> {
                JobDO inserted = invocation.getArgument(0);
                inserted.setId(GENERATED_ID);
                return 1;
            }).when(jobMapper).insert(any(JobDO.class));

            Long id = jobService.createJob(saveReqVO("testHandler"));

            ArgumentCaptor<JobDO> insertCaptor = ArgumentCaptor.forClass(JobDO.class);
            verify(jobMapper).insert(insertCaptor.capture());
            assertThat(insertCaptor.getValue().getStatus()).isEqualTo(JobStatusEnum.INIT.getStatus());
            assertThat(insertCaptor.getValue().getMonitorTimeout()).isZero();
            verify(schedulerManager).addJob(GENERATED_ID, "testHandler", "userId=1", VALID_CRON, 3, 1000);
            ArgumentCaptor<JobDO> updateCaptor = ArgumentCaptor.forClass(JobDO.class);
            verify(jobMapper).updateById(updateCaptor.capture());
            assertThat(updateCaptor.getValue().getStatus()).isEqualTo(JobStatusEnum.NORMAL.getStatus());
            assertThat(updateCaptor.getValue().getId()).isEqualTo(GENERATED_ID);
            assertThat(id).isEqualTo(GENERATED_ID);
        }
    }

    /** 请求显式给出监控超时时按请求值保留，不被默认值覆盖。 */
    @Test
    void createJobKeepsProvidedMonitorTimeout() throws SchedulerException {
        try (MockedStatic<SpringUtil> springUtil = mockHandlerBean("testHandler", mock(JobHandler.class))) {
            when(jobMapper.selectByHandlerName("testHandler")).thenReturn(null);
            doAnswer(invocation -> {
                JobDO inserted = invocation.getArgument(0);
                inserted.setId(GENERATED_ID);
                return 1;
            }).when(jobMapper).insert(any(JobDO.class));
            JobSaveReqVO reqVO = saveReqVO("testHandler");
            reqVO.setMonitorTimeout(5000);

            jobService.createJob(reqVO);

            ArgumentCaptor<JobDO> captor = ArgumentCaptor.forClass(JobDO.class);
            verify(jobMapper).insert(captor.capture());
            assertThat(captor.getValue().getMonitorTimeout()).isEqualTo(5000);
        }
    }

    /** Cron 表达式非法时先拒绝，不允许进入处理器与写库流程。 */
    @Test
    void createJobRejectsInvalidCronExpression() {
        JobSaveReqVO reqVO = saveReqVO("testHandler");
        reqVO.setCronExpression("not-a-cron");

        assertThatThrownBy(() -> jobService.createJob(reqVO))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(JOB_CRON_EXPRESSION_VALID.getCode());
        verify(jobMapper, never()).selectByHandlerName(anyString());
        verify(jobMapper, never()).insert(any(JobDO.class));
    }

    /** 处理器名称已被其他任务占用时拒绝创建，不写入也不登记调度。 */
    @Test
    void createJobRejectsDuplicatedHandlerName() {
        when(jobMapper.selectByHandlerName("testHandler")).thenReturn(jobDO(1L, "testHandler", JobStatusEnum.NORMAL.getStatus()));

        assertThatThrownBy(() -> jobService.createJob(saveReqVO("testHandler")))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(JOB_HANDLER_EXISTS.getCode());
        verify(jobMapper, never()).insert(any(JobDO.class));
        verifyNoInteractions(schedulerManager);
    }

    /** 容器中找不到处理器 Bean 时拒绝创建，避免留下永远执行不了的任务。 */
    @Test
    void createJobRejectsMissingHandlerBean() {
        try (MockedStatic<SpringUtil> springUtil = mockStatic(SpringUtil.class)) {
            springUtil.when(() -> SpringUtil.getBean("testHandler"))
                    .thenThrow(new org.springframework.beans.factory.NoSuchBeanDefinitionException("testHandler"));

            assertThatThrownBy(() -> jobService.createJob(saveReqVO("testHandler")))
                    .isInstanceOf(ServiceException.class)
                    .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(JOB_HANDLER_BEAN_NOT_EXISTS.getCode());
            verify(jobMapper, never()).insert(any(JobDO.class));
            verifyNoInteractions(schedulerManager);
        }
    }

    /** 处理器 Bean 未实现任务处理器接口时拒绝创建。 */
    @Test
    void createJobRejectsHandlerBeanWithWrongType() {
        try (MockedStatic<SpringUtil> springUtil = mockHandlerBean("testHandler", new Object())) {
            assertThatThrownBy(() -> jobService.createJob(saveReqVO("testHandler")))
                    .isInstanceOf(ServiceException.class)
                    .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(JOB_HANDLER_BEAN_TYPE_ERROR.getCode());
            verify(jobMapper, never()).insert(any(JobDO.class));
            verifyNoInteractions(schedulerManager);
        }
    }

    /** 调度器登记失败时异常向上抛出，让事务回滚已经落库的配置。 */
    @Test
    void createJobPropagatesSchedulerFailure() throws SchedulerException {
        try (MockedStatic<SpringUtil> springUtil = mockHandlerBean("testHandler", mock(JobHandler.class))) {
            when(jobMapper.selectByHandlerName("testHandler")).thenReturn(null);
            doAnswer(invocation -> {
                JobDO inserted = invocation.getArgument(0);
                inserted.setId(GENERATED_ID);
                return 1;
            }).when(jobMapper).insert(any(JobDO.class));
            org.mockito.Mockito.doThrow(new SchedulerException("quartz down"))
                    .when(schedulerManager).addJob(anyLong(), anyString(), any(), anyString(), any(), any());

            assertThatThrownBy(() -> jobService.createJob(saveReqVO("testHandler")))
                    .isInstanceOf(SchedulerException.class)
                    .hasMessageContaining("quartz down");
            verify(jobMapper, never()).updateById(any(JobDO.class));
        }
    }

    /** 更新开启状态的任务时，调度器按库内既有处理器名称重排，不随请求改名。 */
    @Test
    void updateJobReschedulesWithPersistedHandlerName() throws SchedulerException {
        when(jobMapper.selectById(1L)).thenReturn(jobDO(1L, "oldHandler", JobStatusEnum.NORMAL.getStatus()));
        try (MockedStatic<SpringUtil> springUtil = mockHandlerBean("newHandler", mock(JobHandler.class))) {
            JobSaveReqVO reqVO = saveReqVO("newHandler");
            reqVO.setId(1L);
            reqVO.setCronExpression("0 0 2 * * ?");

            jobService.updateJob(reqVO);

            verify(schedulerManager).updateJob("oldHandler", "userId=1", "0 0 2 * * ?", 3, 1000);
            ArgumentCaptor<JobDO> captor = ArgumentCaptor.forClass(JobDO.class);
            verify(jobMapper).updateById(captor.capture());
            assertThat(captor.getValue().getHandlerName()).isEqualTo("newHandler");
            assertThat(captor.getValue().getCronExpression()).isEqualTo("0 0 2 * * ?");
        }
    }

    /** 更新不存在的任务时拒绝，不再改动调度器。 */
    @Test
    void updateJobRejectsMissingJob() {
        when(jobMapper.selectById(99L)).thenReturn(null);
        JobSaveReqVO reqVO = saveReqVO("testHandler");
        reqVO.setId(99L);

        assertThatThrownBy(() -> jobService.updateJob(reqVO))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(JOB_NOT_EXISTS.getCode());
        verifyNoInteractions(schedulerManager);
    }

    /** 暂停状态的任务禁止修改，避免改完被调度器重新拉起。 */
    @Test
    void updateJobRejectsStoppedJob() {
        when(jobMapper.selectById(1L)).thenReturn(jobDO(1L, "testHandler", JobStatusEnum.STOP.getStatus()));
        JobSaveReqVO reqVO = saveReqVO("testHandler");
        reqVO.setId(1L);

        assertThatThrownBy(() -> jobService.updateJob(reqVO))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(JOB_UPDATE_ONLY_NORMAL_STATUS.getCode());
        verify(jobMapper, never()).updateById(any(JobDO.class));
        verifyNoInteractions(schedulerManager);
    }

    /** 更新时处理器 Bean 同样要校验类型，避免把不可执行的处理器登记进去。 */
    @Test
    void updateJobRejectsHandlerBeanWithWrongType() {
        when(jobMapper.selectById(1L)).thenReturn(jobDO(1L, "testHandler", JobStatusEnum.NORMAL.getStatus()));
        try (MockedStatic<SpringUtil> springUtil = mockHandlerBean("testHandler", new Object())) {
            JobSaveReqVO reqVO = saveReqVO("testHandler");
            reqVO.setId(1L);

            assertThatThrownBy(() -> jobService.updateJob(reqVO))
                    .isInstanceOf(ServiceException.class)
                    .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(JOB_HANDLER_BEAN_TYPE_ERROR.getCode());
            verify(jobMapper, never()).updateById(any(JobDO.class));
        }
    }

    /** 状态值不在开启/暂停范围内时拒绝，不触碰数据库与调度器。 */
    @Test
    void updateJobStatusRejectsInvalidStatus() {
        assertThatThrownBy(() -> jobService.updateJobStatus(1L, 9))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(JOB_CHANGE_STATUS_INVALID.getCode());
        verify(jobMapper, never()).selectById(anyLong());
        verifyNoInteractions(schedulerManager);
    }

    /** 目标任务不存在时拒绝状态变更。 */
    @Test
    void updateJobStatusRejectsMissingJob() {
        when(jobMapper.selectById(99L)).thenReturn(null);

        assertThatThrownBy(() -> jobService.updateJobStatus(99L, JobStatusEnum.STOP.getStatus()))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(JOB_NOT_EXISTS.getCode());
        verifyNoInteractions(schedulerManager);
    }

    /** 目标状态与当前状态相同时拒绝，避免重复向调度器发送恢复或暂停指令。 */
    @Test
    void updateJobStatusRejectsSameStatus() {
        when(jobMapper.selectById(1L)).thenReturn(jobDO(1L, "testHandler", JobStatusEnum.NORMAL.getStatus()));

        assertThatThrownBy(() -> jobService.updateJobStatus(1L, JobStatusEnum.NORMAL.getStatus()))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(JOB_CHANGE_STATUS_EQUALS.getCode());
        verify(jobMapper, never()).updateById(any(JobDO.class));
        verifyNoInteractions(schedulerManager);
    }

    /** 切换为开启时走恢复调度，切换为暂停时走暂停调度。 */
    @Test
    void updateJobStatusResumesOrPausesScheduler() throws SchedulerException {
        when(jobMapper.selectById(1L)).thenReturn(jobDO(1L, "testHandler", JobStatusEnum.STOP.getStatus()));
        jobService.updateJobStatus(1L, JobStatusEnum.NORMAL.getStatus());
        ArgumentCaptor<JobDO> resumeCaptor = ArgumentCaptor.forClass(JobDO.class);
        verify(jobMapper).updateById(resumeCaptor.capture());
        assertThat(resumeCaptor.getValue().getStatus()).isEqualTo(JobStatusEnum.NORMAL.getStatus());
        verify(schedulerManager).resumeJob("testHandler");

        when(jobMapper.selectById(2L)).thenReturn(jobDO(2L, "otherHandler", JobStatusEnum.NORMAL.getStatus()));
        jobService.updateJobStatus(2L, JobStatusEnum.STOP.getStatus());
        ArgumentCaptor<JobDO> pauseCaptor = ArgumentCaptor.forClass(JobDO.class);
        verify(jobMapper, times(2)).updateById(pauseCaptor.capture());
        assertThat(pauseCaptor.getAllValues().get(1).getStatus()).isEqualTo(JobStatusEnum.STOP.getStatus());
        verify(schedulerManager).pauseJob("otherHandler");
    }

    /** 立即触发按库内配置把编号、处理器名称与参数一并交给调度器。 */
    @Test
    void triggerJobDelegatesToScheduler() throws SchedulerException {
        when(jobMapper.selectById(1L)).thenReturn(jobDO(1L, "testHandler", JobStatusEnum.NORMAL.getStatus()));

        jobService.triggerJob(1L);

        verify(schedulerManager).triggerJob(1L, "testHandler", "userId=1");
        verify(jobMapper, never()).updateById(any(JobDO.class));
    }

    /** 触发不存在的任务时拒绝，不向调度器发送空任务。 */
    @Test
    void triggerJobRejectsMissingJob() {
        when(jobMapper.selectById(99L)).thenReturn(null);

        assertThatThrownBy(() -> jobService.triggerJob(99L))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(JOB_NOT_EXISTS.getCode());
        verifyNoInteractions(schedulerManager);
    }

    /** 同步时暂停状态的任务先删除再重建，然后立即暂停。 */
    @Test
    void syncJobPausesStoppedJobAfterRebuild() throws SchedulerException {
        JobDO running = jobDO(1L, "runningHandler", JobStatusEnum.NORMAL.getStatus());
        JobDO stopped = jobDO(2L, "stoppedHandler", JobStatusEnum.STOP.getStatus());
        when(jobMapper.selectList()).thenReturn(Arrays.asList(running, stopped));

        jobService.syncJob();

        verify(schedulerManager).deleteJob("runningHandler");
        verify(schedulerManager).addJob(1L, "runningHandler", "userId=1", VALID_CRON, 3, 1000);
        verify(schedulerManager, never()).pauseJob("runningHandler");
        verify(schedulerManager).addJob(2L, "stoppedHandler", "userId=1", VALID_CRON, 3, 1000);
        verify(schedulerManager).pauseJob("stoppedHandler");
    }

    /** 库内没有任务时同步不产生任何调度器动作。 */
    @Test
    void syncJobDoesNothingWhenNoJobs() throws SchedulerException {
        when(jobMapper.selectList()).thenReturn(Collections.emptyList());

        jobService.syncJob();

        verifyNoInteractions(schedulerManager);
    }

    /** 删除任务时先落库删除，再按库内处理器名称通知调度器。 */
    @Test
    void deleteJobRemovesFromMapperAndScheduler() throws SchedulerException {
        when(jobMapper.selectById(1L)).thenReturn(jobDO(1L, "testHandler", JobStatusEnum.NORMAL.getStatus()));

        jobService.deleteJob(1L);

        verify(jobMapper).deleteById(1L);
        verify(schedulerManager).deleteJob("testHandler");
    }

    /** 批量删除按查询到的任务逐个通知调度器删除。 */
    @Test
    void deleteJobListRemovesEachHandlerFromScheduler() throws SchedulerException {
        List<Long> ids = Arrays.asList(1L, 2L);
        when(jobMapper.selectByIds(ids)).thenReturn(Arrays.asList(
                jobDO(1L, "firstHandler", JobStatusEnum.NORMAL.getStatus()),
                jobDO(2L, "secondHandler", JobStatusEnum.STOP.getStatus())));

        jobService.deleteJobList(ids);

        verify(jobMapper).deleteByIds(ids);
        verify(schedulerManager).deleteJob("firstHandler");
        verify(schedulerManager).deleteJob("secondHandler");
    }

    /** 批量删除为空列表时也不产生调度器动作。 */
    @Test
    void deleteJobListWithEmptyIdsSkipsScheduler() throws SchedulerException {
        List<Long> ids = Collections.emptyList();
        when(jobMapper.selectByIds(ids)).thenReturn(Collections.emptyList());

        jobService.deleteJobList(ids);

        verify(jobMapper).deleteByIds(ids);
        verifyNoInteractions(schedulerManager);
    }

    /** 批量删除不存在的任务时不报错，只删除已有调度项。 */
    @Test
    void deleteJobListRejectsNothingWhenLookupMisses() throws SchedulerException {
        List<Long> ids = Arrays.asList(7L, 8L);
        when(jobMapper.selectByIds(anyList())).thenReturn(List.of(jobDO(7L, "firstHandler", JobStatusEnum.NORMAL.getStatus())));

        jobService.deleteJobList(ids);

        verify(jobMapper).deleteByIds(ids);
        verify(schedulerManager).deleteJob("firstHandler");
        verify(schedulerManager, never()).deleteJob("secondHandler");
    }

    /** 按编号与分页读取都直接透传持久层结果。 */
    @Test
    void readQueriesDelegateToMapper() {
        JobDO job = jobDO(1L, "testHandler", JobStatusEnum.NORMAL.getStatus());
        when(jobMapper.selectById(1L)).thenReturn(job);
        JobPageReqVO pageReqVO = new JobPageReqVO();
        PageResult<JobDO> pageResult = new PageResult<>(List.of(job), 1L);
        when(jobMapper.selectPage(pageReqVO)).thenReturn(pageResult);

        assertThat(jobService.getJob(1L)).isSameAs(job);
        assertThat(jobService.getJobPage(pageReqVO)).isSameAs(pageResult);
        verify(jobMapper).selectById(1L);
        verify(jobMapper).selectPage(pageReqVO);
    }
}